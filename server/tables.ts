import { randomUUID } from 'node:crypto';
import { initialPresentedSession } from '../src/game/session/messages';
import { createLobby } from '../src/net/lobby';
import type { Command, ServerMessage } from '../src/net/messages';
import type { Store, StoredMatch } from './store';

const reconnectGraceMs = 45_000;

export type TableEvent = { userId: string; message: ServerMessage };

/** Runs the matches for people connected to this process. MongoDB is the shared queue and referee. */
export function createTables(store: Store, rollDie: () => number, now = () => Date.now()) {
  const lobby = createLobby(rollDie);
  const revision = new Map<string, number>();
  const away = new Map<string, [number | null, number | null]>();
  const waiting = new Set<string>();
  const online = new Set<string>();
  const seen = new Map<string, string>();

  function adopt(match: StoredMatch) {
    const loaded = lobby.snapshot(match.seats[0]) ?? lobby.snapshot(match.seats[1]);
    if (loaded?.id === match.id && revision.get(match.id) === match.revision) {
      away.set(match.id, match.away);
      return;
    }
    if (loaded) lobby.leave(loaded.ids[0]);
    lobby.restore(match.seats[0], match.seats[1], match.session, match.id);
    revision.set(match.id, match.revision);
    away.set(match.id, match.away);
  }

  function emit(userId: string, token: string, message: ServerMessage) {
    if (!online.has(userId) || seen.get(userId) === token) return [];
    seen.set(userId, token);
    return [{ userId, message }];
  }

  async function pull(userId: string) {
    const match = await store.matchForUser(userId);
    if (!match) {
      if (lobby.seat(userId)) lobby.leave(userId);
      return null;
    }
    adopt(match);
    return match;
  }

  return {
    async connect(userId: string) {
      online.add(userId);
      const found = await store.matchForUser(userId);
      if (!found) return [];
      waiting.delete(userId);
      const index = found.seats[0] === userId ? 0 : 1;
      let match = found;
      if (found.away[index] !== null) {
        const nextAway: [number | null, number | null] = [...found.away];
        nextAway[index] = null;
        if (await store.saveMatch({ ...found, away: nextAway }))
          match = { ...found, revision: found.revision + 1, away: nextAway };
        else match = (await store.matchForUser(userId)) ?? found;
      }
      adopt(match);
      const seat = lobby.seat(userId);
      if (!seat) return [];
      return emit(userId, `${match.id}:${match.revision}`, {
        type: 'resume',
        you: seat.you,
        state: seat.state,
        canUndo: seat.canUndo,
      });
    },
    async find(userId: string) {
      if (await pull(userId)) return this.connect(userId);
      const opponent = await store.claimOpponent(userId);
      if (!opponent) {
        waiting.add(userId);
        return emit(userId, 'waiting', { type: 'waiting' });
      }
      const match: StoredMatch = {
        id: randomUUID(),
        seats: [opponent, userId],
        session: initialPresentedSession(),
        revision: 0,
        away: [null, null],
        endedAt: null,
        winner: null,
      };
      if (!(await store.insertMatch(match))) {
        await store.wait(opponent);
        await store.wait(userId);
        waiting.add(userId);
        return emit(userId, 'waiting', { type: 'waiting' });
      }
      waiting.delete(userId);
      waiting.delete(opponent);
      adopt(match);
      const events: TableEvent[] = [];
      for (const id of match.seats) {
        const seat = lobby.seat(id);
        if (!seat) continue;
        events.push(
          ...emit(id, `${match.id}:0`, { type: 'matched', you: seat.you, state: seat.state }),
        );
      }
      return events;
    },
    async act(userId: string, command: Command) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const match = await pull(userId);
        if (!match) return [];
        if (
          command.type === 'restart' &&
          (match.endedAt !== null || match.session.state.phase === 'GAME_OVER')
        ) {
          if (match.endedAt === null && !(await store.endMatch(match, winnerOf(match)))) continue;
          return rematch(match);
        }
        const before = JSON.stringify(lobby.snapshot(userId)?.session);
        const result = lobby.act(userId, command);
        const after = lobby.snapshot(userId);
        if (!result || !after) return [];
        if (JSON.stringify(after.session) === before)
          return result.to
            .filter((id) => online.has(id))
            .map((id) => ({ userId: id, message: { type: 'update' as const, ...result.update } }));
        const stored = played(after, match);
        const saved =
          after.session.state.phase === 'GAME_OVER'
            ? await store.endMatch(stored, winnerOf(stored))
            : await store.saveMatch(stored);
        if (!saved) continue;
        const next = stored.revision + 1;
        revision.set(after.id, next);
        const token = `${after.id}:${next}`;
        return result.to
          .filter((id) => online.has(id))
          .map((id) => {
            seen.set(id, token);
            return { userId: id, message: { type: 'update' as const, ...result.update } };
          });
      }
      await pull(userId);
      return [];
    },
    async cancel(userId: string) {
      waiting.delete(userId);
      await store.leaveQueue(userId);
      const match = await store.matchForUser(userId);
      if (!match) {
        if (lobby.seat(userId)) lobby.leave(userId);
        return [];
      }
      if (match.endedAt === null) {
        let current = match;
        for (let attempt = 0; attempt < 3 && current.endedAt === null; attempt++) {
          const winner =
            current.session.state.phase === 'GAME_OVER'
              ? winnerOf(current)
              : current.seats[current.seats[0] === userId ? 1 : 0];
          if (await store.endMatch(current, winner)) break;
          const again = await store.match(current.id);
          if (!again) break;
          current = again;
        }
      }
      await store.release(match.id);
      lobby.leave(userId);
      seen.set(userId, `left:${match.id}`);
      const opponent = match.seats[match.seats[0] === userId ? 1 : 0];
      return emit(opponent, `left:${match.id}`, { type: 'left' });
    },
    async disconnect(userId: string) {
      online.delete(userId);
      if (!lobby.seat(userId)) {
        waiting.delete(userId);
        await store.leaveQueue(userId);
        return;
      }
      for (let attempt = 0; attempt < 3; attempt++) {
        const match = await store.matchForUser(userId);
        if (!match) {
          if (lobby.seat(userId)) lobby.leave(userId);
          return;
        }
        adopt(match);
        const index = match.seats[0] === userId ? 0 : 1;
        const nextAway: [number | null, number | null] = [...match.away];
        nextAway[index] = now();
        if (!(await store.markAway({ ...match, away: nextAway }))) continue;
        revision.set(match.id, match.revision + 1);
        away.set(match.id, nextAway);
        return;
      }
    },
    async sync() {
      const events: TableEvent[] = [];
      for (const { match, released } of await store.expireAway(now() - reconnectGraceMs)) {
        for (const id of released) {
          if (lobby.snapshot(id)?.id === match.id) lobby.leave(id);
          events.push(...emit(id, `left:${match.id}`, { type: 'left' }));
        }
      }
      for (const userId of online) events.push(...(await watch(userId)));
      return events;
    },
  };

  async function watch(userId: string): Promise<TableEvent[]> {
    const match = await store.matchForUser(userId);
    if (!match) {
      const local = lobby.snapshot(userId);
      if (local) lobby.leave(userId);
      if (waiting.has(userId)) {
        if (!(await store.queued(userId))) waiting.delete(userId);
        else return emit(userId, 'waiting', { type: 'waiting' });
        return [];
      }
      return local ? emit(userId, `left:${local.id}`, { type: 'left' }) : [];
    }
    waiting.delete(userId);
    const previousRoll = lobby.snapshot(userId)?.session.state.roll ?? [];
    const known = seen.get(userId);
    adopt(match);
    const seat = lobby.seat(userId);
    if (!seat) return [];
    const token = `${match.id}:${match.revision}`;
    if (known === token) return [];
    if (known?.startsWith(`${match.id}:`)) {
      const roll = seat.state.roll;
      const dice =
        roll.length === 2 && roll.join() !== previousRoll.join()
          ? ([roll[0], roll[1]] as [number, number])
          : undefined;
      return emit(userId, token, {
        type: 'update',
        state: seat.state,
        canUndo: seat.canUndo,
        dice,
      });
    }
    const previous = known?.match(/^([^:]+):\d+$/)?.[1];
    if (previous && previous !== match.id)
      return emit(userId, token, {
        type: 'update',
        state: seat.state,
        canUndo: seat.canUndo,
        resetDice: true,
      });
    return emit(userId, token, { type: 'matched', you: seat.you, state: seat.state });
  }

  function played(
    after: NonNullable<ReturnType<typeof lobby.snapshot>>,
    match: StoredMatch,
  ): StoredMatch {
    return {
      id: after.id,
      seats: [after.ids[0], after.ids[1]],
      session: after.session,
      revision: revision.get(after.id) ?? match.revision,
      away: away.get(after.id) ?? match.away,
      endedAt: match.endedAt,
      winner: match.winner,
    };
  }

  function winnerOf(match: StoredMatch): string | null {
    const winner = match.session.state.outcome?.winner;
    return winner == null ? null : match.seats[winner];
  }

  async function rematch(match: StoredMatch): Promise<TableEvent[]> {
    const next: StoredMatch = {
      id: randomUUID(),
      seats: match.seats,
      session: initialPresentedSession(),
      revision: 0,
      away: [null, null],
      endedAt: null,
      winner: null,
    };
    if (!(await store.followOn(match.id, next))) {
      const live = await store.matchForUser(match.seats[0]);
      if (!live || live.id === match.id) return [];
      adopt(live);
      return broadcast(live);
    }
    adopt(next);
    return broadcast(next);
  }

  function broadcast(match: StoredMatch): TableEvent[] {
    const events: TableEvent[] = [];
    for (const id of match.seats) {
      const seat = lobby.seat(id);
      if (!seat) continue;
      events.push(
        ...emit(id, `${match.id}:${match.revision}`, {
          type: 'update',
          state: seat.state,
          canUndo: seat.canUndo,
          resetDice: true,
        }),
      );
    }
    return events;
  }
}
