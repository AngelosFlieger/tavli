import { randomUUID } from 'node:crypto';
import { initialPresentedSession, sessionMessage } from '../src/game/session/messages';
import { createLobby } from '../src/net/lobby';
import { matchKey, rulesForSelection, rulesForState } from '../src/game/variant/rules-context';
import {
  CLASSIC_SELECTION,
  type ClientErrorCode,
  type Command,
  type MatchSelection,
  type ServerMessage,
  type Update,
} from '../src/net/messages';
import type { RulesContext } from '../src/game/variant/types';
import type { Outcome } from '../src/game/rules/position';
import type { Store, StoredMatch, StoredRevisionUpdate } from './store';

const reconnectGraceMs = 45_000;
const noShowGraceMs = 20_000;

export type TableEvent = { userId: string; message: ServerMessage };

/** Runs the matches for people connected to this process. MongoDB is the shared queue and referee. */
export function createTables(
  store: Store,
  rollDie: () => number,
  now = () => Date.now(),
  randomInt: (maximum: number) => number = (maximum) =>
    Math.min(maximum - 1, Math.floor(((rollDie() - 1) / 6) * maximum)),
) {
  const lobby = createLobby(rollDie, randomInt);
  const revision = new Map<string, number>();
  const away = new Map<string, [number | null, number | null]>();
  const waiting = new Set<string>();
  const online = new Set<string>();
  const seen = new Map<string, string>();
  const rematchOffers = new Map<string, Set<string>>();

  function adopt(match: StoredMatch) {
    const loaded = lobby.snapshot(match.seats[0]) ?? lobby.snapshot(match.seats[1]);
    if (loaded?.id === match.id && revision.get(match.id) === match.revision) {
      away.set(match.id, match.away);
      return;
    }
    if (loaded) lobby.leave(loaded.ids[0]);
    lobby.restore(match.seats[0], match.seats[1], match.session, match.id, rulesForMatch(match));
    revision.set(match.id, match.revision);
    away.set(match.id, match.away);
  }

  function emit(userId: string, token: string, message: ServerMessage) {
    if (!online.has(userId) || seen.get(userId) === token) return [];
    seen.set(userId, token);
    return [{ userId, message }];
  }

  function fail(userId: string, code: ClientErrorCode) {
    return emit(userId, `error:${code}:${now()}`, { type: 'error', code });
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
    /** Clears volatile matchmaking state and starts a reconnect grace for every live match. */
    async start() {
      await store.clearQueue();
      for (const live of await store.liveMatches()) {
        let match = live;
        for (let attempt = 0; attempt < 3; attempt++) {
          const away: [number | null, number | null] = [now(), now()];
          if (await store.markAway({ ...match, away })) break;
          match = (await store.match(live.id)) ?? match;
          if (match.endedAt !== null) break;
        }
        if (match.endedAt === null) adopt({ ...match, away: [now(), now()] });
      }
    },
    async connect(userId: string) {
      online.add(userId);
      const found = await store.matchForUser(userId);
      if (!found) {
        if (lobby.seat(userId)) lobby.leave(userId);
        if (await store.queued(userId)) {
          waiting.add(userId);
          return emit(userId, `waiting:${userId}`, { type: 'waiting' });
        }
        return [];
      }
      waiting.delete(userId);
      const index = found.seats[0] === userId ? 0 : 1;
      let match = found;
      const connected: [boolean, boolean] = [...found.connected];
      connected[index] = true;
      await store.setConnected(found.id, index as 0 | 1, true);
      match = { ...found, connected };
      if (found.away[index] !== null) {
        const nextAway: [number | null, number | null] = [...found.away];
        nextAway[index] = null;
        if (await store.saveMatch({ ...match, away: nextAway }))
          match = { ...match, revision: found.revision + 1, away: nextAway };
        else match = (await store.matchForUser(userId)) ?? match;
      }
      adopt(match);
      const seat = lobby.seat(userId);
      if (!seat) return [];
      return emit(userId, `${match.id}:${match.revision}`, {
        type: 'resume',
        you: seat.you,
        state: seat.state,
        canUndo: seat.canUndo,
        variantConfig: rulesForMatch(match).variantConfig,
      });
    },
    async find(userId: string, selection: MatchSelection = CLASSIC_SELECTION) {
      if (await pull(userId)) return this.connect(userId);
      const rules = rulesForSelection(selection);
      const key = matchKey(rules);
      const opponent = await store.claimOpponent(userId, key);
      if (!opponent) {
        waiting.add(userId);
        return emit(userId, 'waiting', { type: 'waiting' });
      }
      const match: StoredMatch = {
        id: randomUUID(),
        seats: [opponent, userId],
        session: initialPresentedSession(rules),
        variantConfig: rules.variantConfig,
        lastUpdate: null,
        revision: 0,
        away: [online.has(opponent) ? null : now(), online.has(userId) ? null : now()],
        connected: [online.has(opponent), online.has(userId)],
        endedAt: null,
        winner: null,
      };
      if (!(await store.insertMatch(match))) {
        await store.wait(opponent, key);
        await store.wait(userId, key);
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
          ...emit(id, `${match.id}:0`, {
            type: 'matched',
            you: seat.you,
            state: seat.state,
            variantConfig: rules.variantConfig,
          }),
        );
      }
      return events;
    },
    async act(userId: string, command: Command) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const match = await pull(userId);
        if (!match) return fail(userId, 'NOT_FOUND');
        if (match.endedAt !== null || match.session.state.phase === 'GAME_OVER') {
          if (command.type !== 'restart') return fail(userId, 'MATCH_ENDED');
          const offers = rematchOffers.get(match.id) ?? new Set<string>();
          offers.add(userId);
          rematchOffers.set(match.id, offers);
          if (offers.size < 2) {
            const events: TableEvent[] = [];
            for (const id of match.seats) {
              events.push(
                ...emit(id, `rematch:${match.id}:offered`, {
                  type: 'rematch',
                  status: 'OFFERED',
                }),
              );
            }
            return events;
          }
          rematchOffers.delete(match.id);
          return rematch(match);
        }
        if (command.type === 'restart') return fail(userId, 'MATCH_NOT_FINISHED');
        if (command.type === 'forfeit') {
          const winner: 0 | 1 = match.seats[0] === userId ? 1 : 0;
          return finishMatch(match, {
            winner,
            points: 1,
            reason: 'Opponent resigned',
            kind: 'RESIGNATION',
          });
        }
        const before = JSON.stringify(lobby.snapshot(userId)?.session);
        const result = lobby.act(userId, command);
        const after = lobby.snapshot(userId);
        if (!result || !after) return fail(userId, 'INVALID_COMMAND');
        if (JSON.stringify(after.session) === before)
          return result.to
            .filter((id) => online.has(id))
            .map((id) => ({ userId: id, message: { type: 'update' as const, ...result.update } }));
        const stored = played(after, match, result.update);
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
      const events: TableEvent[] = [];
      if (match.endedAt === null) {
        const winner: 0 | 1 = match.seats[0] === userId ? 1 : 0;
        events.push(
          ...(await finishMatch(match, {
            winner,
            points: 1,
            reason: 'Opponent left',
            kind: 'ABANDONED',
          })),
        );
      }
      await store.release(match.id);
      lobby.leave(userId);
      rematchOffers.delete(match.id);
      seen.set(userId, `left:${match.id}`);
      const opponent = match.seats[match.seats[0] === userId ? 1 : 0];
      events.push(...emit(opponent, `left:${match.id}`, { type: 'left' }));
      return events;
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
        const index = match.seats[0] === userId ? 0 : 1;
        adopt(match);
        if (match.endedAt !== null) {
          await store.release(match.id);
          lobby.leave(userId);
          rematchOffers.delete(match.id);
          const opponent = match.seats[index === 0 ? 1 : 0];
          void emit(opponent, `left:${match.id}`, { type: 'left' });
          return;
        }
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
      const current = now();
      for (const { match, expired } of await store.staleMatches(
        current - reconnectGraceMs,
        current - noShowGraceMs,
      )) {
        if (match.endedAt !== null) continue;
        const both = expired[0] && expired[1];
        const winner: 0 | 1 | null = both ? null : expired[0] ? 1 : 0;
        const loser = both ? null : expired[0] ? 0 : 1;
        const noShow = loser !== null && !match.connected[loser] && match.away[loser] !== null;
        events.push(
          ...(await finishMatch(
            match,
            {
              winner,
              points: both ? 0 : 1,
              reason: both
                ? 'Both players left'
                : noShow
                  ? 'Opponent did not return'
                  : 'Opponent disconnected',
              kind: both ? 'ABANDONED' : noShow ? 'NO_SHOW' : 'DISCONNECT',
            },
            true,
          )),
        );
        if (both)
          for (const id of match.seats) {
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
    const known = seen.get(userId);
    adopt(match);
    const seat = lobby.seat(userId);
    if (!seat) return [];
    const token = `${match.id}:${match.revision}`;
    if (known === token) return [];
    if (known?.startsWith(`${match.id}:`)) {
      const knownRevision = Number(known.slice(known.lastIndexOf(':') + 1));
      const details =
        knownRevision === match.revision - 1 && match.lastUpdate?.revision === match.revision
          ? structuredClone(match.lastUpdate.details)
          : {};
      return emit(userId, token, {
        ...details,
        type: 'update',
        state: seat.state,
        canUndo: seat.canUndo,
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
    return emit(userId, token, {
      type: 'matched',
      you: seat.you,
      state: seat.state,
      variantConfig: rulesForMatch(match).variantConfig,
    });
  }

  function played(
    after: NonNullable<ReturnType<typeof lobby.snapshot>>,
    match: StoredMatch,
    update: Update,
  ): StoredMatch {
    const currentRevision = Math.max(revision.get(after.id) ?? 0, match.revision);
    return {
      id: after.id,
      seats: [after.ids[0], after.ids[1]],
      session: after.session,
      variantConfig: rulesForMatch(match).variantConfig,
      lastUpdate: revisionUpdate(currentRevision + 1, update),
      revision: currentRevision,
      away: away.get(after.id) ?? match.away,
      connected: match.connected,
      endedAt: match.endedAt,
      winner: match.winner,
    };
  }

  function winnerOf(match: StoredMatch): string | null {
    const winner = match.session.state.outcome?.winner;
    return winner == null ? null : match.seats[winner];
  }

  async function finishMatch(
    match: StoredMatch,
    outcome: Outcome,
    release = false,
  ): Promise<TableEvent[]> {
    const ended = lobby.end(match.seats[0], outcome) ?? lobby.end(match.seats[1], outcome);
    const fallbackEvents = [{ type: 'GameEnded' as const, outcome }];
    const fallbackState = {
      ...structuredClone(match.session.state),
      phase: 'GAME_OVER' as const,
      outcome: structuredClone(outcome),
      message: sessionMessage(match.session.state, fallbackEvents) ?? outcome.reason,
    };
    const update: Update = ended
      ? { ...ended, resetDice: true }
      : {
          state: fallbackState,
          canUndo: false,
          events: fallbackEvents,
          resetDice: true,
        };
    const session = ended
      ? (lobby.snapshot(match.seats[0])?.session ?? { state: fallbackState, history: [] })
      : { state: fallbackState, history: [] };
    const currentRevision = Math.max(revision.get(match.id) ?? 0, match.revision);
    const stored: StoredMatch = {
      ...match,
      session,
      lastUpdate: revisionUpdate(currentRevision + 1, update),
      revision: currentRevision,
    };
    if (
      !(await store.endMatch(stored, outcome.winner === null ? null : match.seats[outcome.winner]))
    )
      return fail(match.seats[0], 'INTERNAL');
    const next = currentRevision + 1;
    revision.set(match.id, next);
    rematchOffers.delete(match.id);
    if (release) await store.release(match.id);
    const token = `${match.id}:${next}`;
    const events: TableEvent[] = [];
    for (const id of match.seats) {
      if (!online.has(id) || seen.get(id) === token) continue;
      seen.set(id, token);
      events.push({ userId: id, message: { type: 'update', ...update } });
    }
    return events;
  }

  async function rematch(match: StoredMatch): Promise<TableEvent[]> {
    if (match.endedAt === null && !(await store.endMatch(match, winnerOf(match)))) {
      const live = await store.match(match.id);
      if (!live || live.endedAt === null) return fail(match.seats[0], 'INTERNAL');
      match = live;
    }
    const rules = rulesForMatch(match);
    const next: StoredMatch = {
      id: randomUUID(),
      seats: match.seats,
      session: initialPresentedSession(rules),
      variantConfig: rules.variantConfig,
      lastUpdate: null,
      revision: 0,
      away: [null, null],
      connected: [...match.connected],
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

  function rulesForMatch(match: StoredMatch): RulesContext {
    try {
      return rulesForState(match.session.state, match.variantConfig ?? undefined);
    } catch (error) {
      throw new Error(`Stored rules do not match session ${match.id}`, { cause: error });
    }
  }

  function revisionUpdate(revision: number, update: Update): StoredRevisionUpdate {
    const details: StoredRevisionUpdate['details'] = {
      ...(update.events ? { events: structuredClone(update.events) } : {}),
      ...(update.dice ? { dice: [...update.dice] as [number, number] } : {}),
      ...(update.rerolledDie === undefined ? {} : { rerolledDie: update.rerolledDie }),
      ...(update.sequence ? { sequence: update.sequence.map((move) => ({ ...move })) } : {}),
      ...(update.resetDice === undefined ? {} : { resetDice: update.resetDice }),
    };
    return { revision, details };
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
