import { randomUUID, randomBytes } from 'node:crypto';
import { initialPresentedSession } from '../src/game/session/messages';
import { resolveAutomaticOpening } from '../src/game/session/opening-authority';
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
import type { Session } from '../src/game/session/state';
import {
  clockExpired,
  DISABLED_CLOCK,
  pauseClock,
  startClock,
  type ClockConfig,
} from '../src/game/clock';
import type { Store, StoredMatch, StoredRevisionUpdate } from './store';

const reconnectGraceMs = 45_000;
const noShowGraceMs = 20_000;
const roomTtlMs = 10 * 60_000;

export type TableEvent = { userId: string; message: ServerMessage };
export type AuthorityCommandContext = {
  commandId: string;
  matchId: string;
  expectedRevision: number;
};

/** Runs the matches for people connected to this process. MongoDB is the shared queue and referee. */
export function createTables(
  store: Store,
  rollDie: () => number,
  now = () => Date.now(),
  randomInt: (maximum: number) => number = (maximum) =>
    Math.min(maximum - 1, Math.floor(((rollDie() - 1) / 6) * maximum)),
  clockConfig: ClockConfig = DISABLED_CLOCK,
  openingRandomInt: (maximum: number) => number = randomInt,
) {
  const lobby = createLobby(rollDie, randomInt, clockConfig, now);
  const revision = new Map<string, number>();
  const away = new Map<string, [number | null, number | null]>();
  const waiting = new Set<string>();
  const online = new Set<string>();
  const seen = new Map<string, string>();
  const rematchOffers = new Map<string, Set<string>>();
  const rooms = new Map<string, { hostId: string; selection: MatchSelection; createdAt: number }>();
  const mutationTails = new Map<string, Promise<void>>();

  async function runExclusive<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = mutationTails.get(key) ?? Promise.resolve();
    let release = () => {};
    const completed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => completed);
    mutationTails.set(key, tail);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (mutationTails.get(key) === tail) mutationTails.delete(key);
    }
  }

  async function matchMutationKey(userId: string): Promise<string> {
    return (await store.matchForUser(userId))?.id ?? `user:${userId}`;
  }

  function freshSession(rules: RulesContext) {
    let session = initialPresentedSession(rules);
    const opening = resolveAutomaticOpening(session, rules, openingRandomInt);
    if (!opening) throw new Error('Could not resolve automatic opening');
    session = opening.session;
    session.state.clock = startClock(clockConfig, session.state.phase, now());
    return session;
  }

  function openingDetails(session: Session) {
    if (session.state.opening.status !== 'RESOLVED') return { presentations: [] };
    const { attempts, winner: player } = session.state.opening;
    return {
      events: [{ type: 'OpeningResolved' as const, attempts, player }],
      presentations: [{ type: 'OPENING' as const, blocking: true as const, attempts }],
    };
  }

  function newMatchDetails(session: Session) {
    const details = openingDetails(session);
    return details.presentations.length
      ? details
      : { presentations: [{ type: 'RESET_DICE' as const, blocking: false as const }] };
  }

  function resumableOpeningDetails(match: StoredMatch) {
    const stored = match.lastUpdate?.details;
    if (stored?.presentations.some((job) => job.type === 'OPENING')) return structuredClone(stored);
    return match.lastUpdate === null ? openingDetails(match.session) : { presentations: [] };
  }

  async function playerNames(match: StoredMatch): Promise<[string, string]> {
    const users = await Promise.all(match.seats.map((id) => store.userById(id)));
    return [users[0]?.username ?? 'Player 1', users[1]?.username ?? 'Player 2'];
  }

  async function migratePendingOpening(match: StoredMatch): Promise<StoredMatch> {
    if (
      match.endedAt !== null ||
      match.session.state.phase !== 'OPENING' ||
      match.session.state.opening.status !== 'PENDING'
    )
      return match;
    const rules = rulesForMatch(match);
    const opening = resolveAutomaticOpening(match.session, rules, openingRandomInt);
    if (!opening) throw new Error(`Could not migrate opening for session ${match.id}`);
    opening.session.state.clock = startClock(clockConfig, opening.session.state.phase, now());
    const update: Update = {
      state: opening.session.state,
      canUndo: false,
      events: opening.events,
      presentations: [{ type: 'OPENING', blocking: true, attempts: opening.attempts }],
    };
    const migrated: StoredMatch = {
      ...match,
      session: opening.session,
      lastUpdate: revisionUpdate(match.revision + 1, update),
    };
    if (!(await store.saveMatch(migrated)))
      return (await store.matchForUser(match.seats[0])) ?? match;
    return { ...migrated, revision: match.revision + 1 };
  }

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

  function commandResult(
    userId: string,
    match: StoredMatch,
    context: AuthorityCommandContext,
    status: 'ACCEPTED' | 'REJECTED',
    reason?: 'STALE_REVISION' | 'INVALID_COMMAND',
  ): TableEvent[] {
    const seat = lobby.seat(userId);
    if (!seat) return fail(userId, 'NOT_FOUND');
    return [
      {
        userId,
        message: {
          type: 'update',
          matchId: match.id,
          revision: match.revision,
          state: seat.state,
          canUndo: seat.canUndo,
          presentations: [],
          commandResult: { commandId: context.commandId, status, ...(reason ? { reason } : {}) },
        },
      },
    ];
  }

  async function pull(userId: string) {
    let match = await store.matchForUser(userId);
    if (!match) {
      if (lobby.seat(userId)) lobby.leave(userId);
      return null;
    }
    match = await migratePendingOpening(match);
    adopt(match);
    return match;
  }

  function roomCode(): string {
    return randomBytes(3).toString('hex').toUpperCase();
  }

  function pruneRooms() {
    const cutoff = now() - roomTtlMs;
    for (const [code, room] of rooms) if (room.createdAt < cutoff) rooms.delete(code);
  }

  function leaveRooms(userId: string) {
    for (const [code, room] of rooms) if (room.hostId === userId) rooms.delete(code);
  }

  async function pairRoom(hostId: string, joinerId: string, selection: MatchSelection) {
    await store.leaveQueue(hostId);
    await store.leaveQueue(joinerId);
    waiting.delete(hostId);
    waiting.delete(joinerId);
    const rules = rulesForSelection(selection);
    const match: StoredMatch = {
      id: randomUUID(),
      seats: [hostId, joinerId],
      session: freshSession(rules),
      variantConfig: rules.variantConfig,
      lastUpdate: null,
      revision: 0,
      away: [online.has(hostId) ? null : now(), online.has(joinerId) ? null : now()],
      connected: [online.has(hostId), online.has(joinerId)],
      endedAt: null,
      winner: null,
    };
    if (!(await store.insertMatch(match))) return fail(hostId, 'INTERNAL');
    adopt(match);
    const players = await playerNames(match);
    const events: TableEvent[] = [];
    for (const id of match.seats) {
      const seat = lobby.seat(id);
      if (!seat) continue;
      events.push(
        ...emit(id, `${match.id}:0`, {
          type: 'matched',
          matchId: match.id,
          revision: match.revision,
          you: seat.you,
          players,
          state: seat.state,
          variantConfig: rules.variantConfig,
          ...openingDetails(match.session),
        }),
      );
    }
    return events;
  }

  return {
    /** Clears volatile matchmaking state and starts a reconnect grace for every live match. */
    async start() {
      await store.clearQueue();
      for (const live of await store.liveMatches()) {
        let match = live;
        for (let attempt = 0; attempt < 3; attempt++) {
          const current = now();
          const away: [number | null, number | null] = [current, current];
          const paused: StoredMatch = {
            ...match,
            away,
            session: {
              ...match.session,
              state: {
                ...match.session.state,
                clock: pauseClock(match.session.state.clock, current),
              },
            },
          };
          if (await store.markAway(paused)) {
            match = { ...paused, revision: match.revision + 1 };
            break;
          }
          match = (await store.match(live.id)) ?? match;
          if (match.endedAt !== null) break;
        }
        if (match.endedAt === null) {
          adopt(match);
        }
      }
    },
    async connect(userId: string) {
      online.add(userId);
      const key = await matchMutationKey(userId);
      return runExclusive(key, async () => {
        const stored = await store.matchForUser(userId);
        const found = stored ? await migratePendingOpening(stored) : null;
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
        const connected: [boolean, boolean] = [...found.connected];
        connected[index] = true;
        await store.setConnected(found.id, index as 0 | 1, true);
        let match = { ...found, connected };
        if (found.away[index] !== null) {
          const nextAway: [number | null, number | null] = [...found.away];
          nextAway[index] = null;
          if (await store.saveMatch({ ...match, away: nextAway }))
            match = { ...match, revision: found.revision + 1, away: nextAway };
          else match = (await store.matchForUser(userId)) ?? match;
        }
        adopt(match);
        lobby.resume(userId);
        const seat = lobby.seat(userId);
        if (!seat) return [];
        const players = await playerNames(match);
        return emit(userId, `${match.id}:${match.revision}`, {
          type: 'resume',
          matchId: match.id,
          revision: match.revision,
          you: seat.you,
          players,
          state: seat.state,
          canUndo: seat.canUndo,
          variantConfig: rulesForMatch(match).variantConfig,
          ...resumableOpeningDetails(match),
        });
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
        session: freshSession(rules),
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
      const players = await playerNames(match);
      const events: TableEvent[] = [];
      for (const id of match.seats) {
        const seat = lobby.seat(id);
        if (!seat) continue;
        events.push(
          ...emit(id, `${match.id}:0`, {
            type: 'matched',
            matchId: match.id,
            revision: match.revision,
            you: seat.you,
            players,
            state: seat.state,
            variantConfig: rules.variantConfig,
            ...openingDetails(match.session),
          }),
        );
      }
      return events;
    },
    async createRoom(userId: string, selection: MatchSelection = CLASSIC_SELECTION) {
      if (await pull(userId)) return this.connect(userId);
      pruneRooms();
      leaveRooms(userId);
      const code = roomCode();
      rooms.set(code, { hostId: userId, selection, createdAt: now() });
      return emit(userId, `room:${code}`, { type: 'room', code });
    },
    async joinRoom(userId: string, code: string) {
      if (await pull(userId)) return this.connect(userId);
      pruneRooms();
      const room = rooms.get(code.toUpperCase());
      if (!room) return fail(userId, 'ROOM_NOT_FOUND');
      if (room.hostId === userId) return fail(userId, 'ROOM_OWNED');
      rooms.delete(code);
      return pairRoom(room.hostId, userId, room.selection);
    },
    async act(userId: string, command: Command, context?: AuthorityCommandContext) {
      const key = await matchMutationKey(userId);
      return runExclusive(key, async () => {
        for (let attempt = 0; attempt < 3; attempt++) {
          const match = await pull(userId);
          if (!match) return fail(userId, 'NOT_FOUND');
          if (
            context &&
            (context.matchId !== match.id || context.expectedRevision !== match.revision)
          )
            return commandResult(userId, match, context, 'REJECTED', 'STALE_REVISION');
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
            return finishMatch(
              match,
              {
                winner,
                points: 1,
                reason: 'Opponent resigned',
                kind: 'RESIGNATION',
              },
              false,
              userId,
              context,
            );
          }
          const before = JSON.stringify(lobby.snapshot(userId)?.session);
          const result = lobby.act(userId, command);
          const after = lobby.snapshot(userId);
          if (!result || !after) return fail(userId, 'INVALID_COMMAND');
          if (JSON.stringify(after.session) === before) {
            if (context)
              return commandResult(userId, match, context, 'REJECTED', 'INVALID_COMMAND');
            return result.to
              .filter((id) => online.has(id))
              .map((id) => ({
                userId: id,
                message: {
                  type: 'update' as const,
                  matchId: match.id,
                  revision: match.revision,
                  ...result.update,
                },
              }));
          }
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
              return {
                userId: id,
                message: {
                  type: 'update' as const,
                  matchId: after.id,
                  revision: next,
                  ...result.update,
                  ...(context && id === userId
                    ? {
                        commandResult: {
                          commandId: context.commandId,
                          status: 'ACCEPTED' as const,
                        },
                      }
                    : {}),
                },
              };
            });
        }
        await pull(userId);
        return [];
      });
    },
    async cancel(userId: string) {
      const key = await matchMutationKey(userId);
      return runExclusive(key, async () => {
        waiting.delete(userId);
        leaveRooms(userId);
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
      });
    },
    async disconnect(userId: string) {
      online.delete(userId);
      leaveRooms(userId);
      if (!lobby.seat(userId)) {
        waiting.delete(userId);
        await store.leaveQueue(userId);
        return [];
      }
      const key = await matchMutationKey(userId);
      return runExclusive(key, async () => {
        for (let attempt = 0; attempt < 3; attempt++) {
          const match = await store.matchForUser(userId);
          if (!match) {
            if (lobby.seat(userId)) lobby.leave(userId);
            return [];
          }
          const index = match.seats[0] === userId ? 0 : 1;
          adopt(match);
          lobby.pause(userId);
          if (match.endedAt !== null) {
            await store.release(match.id);
            lobby.leave(userId);
            rematchOffers.delete(match.id);
            const opponent = match.seats[index === 0 ? 1 : 0];
            return emit(opponent, `left:${match.id}`, { type: 'left' });
          }
          const nextAway: [number | null, number | null] = [...match.away];
          nextAway[index] = now();
          const paused = lobby.snapshot(userId);
          const pausedSession = paused?.id === match.id ? paused.session : match.session;
          if (!(await store.markAway({ ...match, session: pausedSession, away: nextAway })))
            continue;
          revision.set(match.id, match.revision + 1);
          away.set(match.id, nextAway);
          return [];
        }
        return [];
      });
    },
    async sync() {
      const events: TableEvent[] = [];
      const current = now();
      const timed = new Set<string>();
      for (const userId of online) {
        const seat = lobby.seat(userId);
        if (!seat || !clockExpired(seat.state.clock, current)) continue;
        const match = await store.matchForUser(userId);
        if (!match || timed.has(match.id) || match.endedAt !== null) continue;
        timed.add(match.id);
        if (seat.state.active !== seat.you) continue;
        const winner: 0 | 1 = seat.you === 0 ? 1 : 0;
        events.push(
          ...(await runExclusive(match.id, async () => {
            const currentMatch = await store.match(match.id);
            if (
              !currentMatch ||
              currentMatch.endedAt !== null ||
              !clockExpired(currentMatch.session.state.clock, current)
            )
              return [];
            adopt(currentMatch);
            return finishMatch(currentMatch, {
              winner,
              points: 1,
              reason: 'Turn time expired',
              kind: 'TIMEOUT',
            });
          })),
        );
      }
      for (const { match } of await store.staleMatches(
        current - reconnectGraceMs,
        current - noShowGraceMs,
      )) {
        if (match.endedAt !== null) continue;
        const result = await runExclusive(match.id, async () => {
          const currentMatch = await store.match(match.id);
          if (!currentMatch || currentMatch.endedAt !== null)
            return { events: [] as TableEvent[], both: false };
          const currentlyExpired = currentMatch.away.map(
            (leftAt, index) =>
              leftAt !== null &&
              leftAt <=
                (currentMatch.connected[index]
                  ? current - reconnectGraceMs
                  : current - noShowGraceMs),
          ) as [boolean, boolean];
          if (!currentlyExpired[0] && !currentlyExpired[1])
            return { events: [] as TableEvent[], both: false };
          const currentBoth = currentlyExpired[0] && currentlyExpired[1];
          const currentWinner: 0 | 1 | null = currentBoth ? null : currentlyExpired[0] ? 1 : 0;
          const currentLoser = currentBoth ? null : currentlyExpired[0] ? 0 : 1;
          const currentNoShow =
            currentLoser !== null &&
            !currentMatch.connected[currentLoser] &&
            currentMatch.away[currentLoser] !== null;
          adopt(currentMatch);
          return {
            events: await finishMatch(
              currentMatch,
              {
                winner: currentWinner,
                points: currentBoth ? 0 : 1,
                reason: currentBoth
                  ? 'Both players left'
                  : currentNoShow
                    ? 'Opponent did not return'
                    : 'Opponent disconnected',
                kind: currentBoth ? 'ABANDONED' : currentNoShow ? 'NO_SHOW' : 'DISCONNECT',
              },
              true,
            ),
            both: currentBoth,
          };
        });
        events.push(...result.events);
        if (result.both)
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
          : { presentations: [] };
      return emit(userId, token, {
        ...details,
        type: 'update',
        matchId: match.id,
        revision: match.revision,
        state: seat.state,
        canUndo: seat.canUndo,
      });
    }
    const previous = known?.match(/^([^:]+):\d+$/)?.[1];
    if (previous && previous !== match.id)
      return emit(userId, token, {
        type: 'update',
        matchId: match.id,
        revision: match.revision,
        state: seat.state,
        canUndo: seat.canUndo,
        ...newMatchDetails(match.session),
      });
    return emit(userId, token, {
      type: 'matched',
      matchId: match.id,
      revision: match.revision,
      you: seat.you,
      players: await playerNames(match),
      state: seat.state,
      variantConfig: rulesForMatch(match).variantConfig,
      ...openingDetails(match.session),
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
    commandUserId?: string,
    commandContext?: AuthorityCommandContext,
  ): Promise<TableEvent[]> {
    const ended = lobby.end(match.seats[0], outcome) ?? lobby.end(match.seats[1], outcome);
    const fallbackEvents = [{ type: 'GameEnded' as const, outcome }];
    const fallbackState = {
      ...structuredClone(match.session.state),
      phase: 'GAME_OVER' as const,
      outcome: structuredClone(outcome),
      clock: null,
    };
    const update: Update = ended
      ? { ...ended, presentations: [{ type: 'RESET_DICE', blocking: false }] }
      : {
          state: fallbackState,
          canUndo: false,
          events: fallbackEvents,
          presentations: [{ type: 'RESET_DICE', blocking: false }],
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
      events.push({
        userId: id,
        message: {
          type: 'update',
          matchId: match.id,
          revision: next,
          ...update,
          ...(commandContext && id === commandUserId
            ? {
                commandResult: {
                  commandId: commandContext.commandId,
                  status: 'ACCEPTED' as const,
                },
              }
            : {}),
        },
      });
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
      session: freshSession(rules),
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
      presentations: structuredClone(update.presentations),
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
          matchId: match.id,
          revision: match.revision,
          state: seat.state,
          canUndo: seat.canUndo,
          ...newMatchDetails(match.session),
        }),
      );
    }
    return events;
  }
}
