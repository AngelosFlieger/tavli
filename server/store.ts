import { MongoClient, type Db } from 'mongodb';
import type { Session } from '../src/game/session/state';
import type { GameState } from '../src/game/session/state';
import { isPhase } from '../src/game/session/phase';
import type { Outcome, OutcomeKind } from '../src/game/rules/position';
import type { GameClock } from '../src/game/clock';
import { resolveVariantConfig } from '../src/game/variant/config/schema';
import type { EffectConstraint, ResolvedVariantConfig } from '../src/game/variant/types';
import {
  isNetworkGameState,
  isPresentationJob,
  type PresentationJob,
  type Update,
} from '../src/net/messages';

export type StoredUser = {
  id: string;
  email: string;
  username: string;
  passwordHash: string;
};

export type StoredMatch = {
  id: string;
  seats: [string, string];
  session: Session;
  /** Immutable rules snapshot used to restore this match after balance profiles change. */
  variantConfig: ResolvedVariantConfig | null;
  /** Presentation/event metadata for the accepted action that produced this revision. */
  lastUpdate: StoredRevisionUpdate | null;
  revision: number;
  away: [number | null, number | null];
  /** Whether each seat has connected at least once in this match. */
  connected: [boolean, boolean];
  /** Set when the match is finished. Null while it is still being played. */
  endedAt: number | null;
  /** Account id of the winner. Null for a draw, or while the match is still being played. */
  winner: string | null;
};

export type StoredRevisionUpdate = {
  revision: number;
  details: Omit<Update, 'state' | 'canUndo'>;
};

export type Store = {
  createUser(user: StoredUser): Promise<void>;
  userById(id: string): Promise<StoredUser | null>;
  userByEmail(email: string): Promise<StoredUser | null>;
  userByUsername(username: string): Promise<StoredUser | null>;
  createSession(tokenHash: string, userId: string, expiresAt: number): Promise<void>;
  userForSession(tokenHash: string, now: number): Promise<Omit<StoredUser, 'passwordHash'> | null>;
  deleteSession(tokenHash: string): Promise<void>;
  matchForUser(userId: string): Promise<StoredMatch | null>;
  match(id: string): Promise<StoredMatch | null>;
  insertMatch(match: StoredMatch): Promise<boolean>;
  saveMatch(match: StoredMatch): Promise<boolean>;
  markAway(match: StoredMatch): Promise<boolean>;
  setConnected(matchId: string, index: 0 | 1, connected: boolean): Promise<void>;
  /** Records the final session and winner. A later save cannot overwrite it. */
  endMatch(match: StoredMatch, winner: string | null): Promise<boolean>;
  /** Starts a new match for the same two accounts and leaves the finished one in place. */
  followOn(previousId: string, match: StoredMatch): Promise<boolean>;
  release(id: string): Promise<void>;
  claimOpponent(userId: string, matchKey: string): Promise<string | null>;
  leaveQueue(userId: string): Promise<void>;
  queued(userId: string): Promise<boolean>;
  wait(userId: string, matchKey: string): Promise<void>;
  clearQueue(): Promise<void>;
  liveMatches(): Promise<StoredMatch[]>;
  ping(): Promise<boolean>;
  staleMatches(
    graceBefore: number,
    noShowBefore: number,
  ): Promise<{ match: StoredMatch; expired: [boolean, boolean] }[]>;
  close(): Promise<void>;
  drop(): Promise<void>;
};

type StoreOptions = { url?: string; name?: string };

const schemaVersion = 4;
const usernameCollation = { locale: 'en', strength: 2 };

export async function openStore(options: StoreOptions = {}): Promise<Store> {
  const url = options.url ?? process.env.PLAKOTO_MONGO_URL ?? 'mongodb://127.0.0.1:27017';
  const name = options.name ?? process.env.PLAKOTO_DB_NAME ?? 'plakoto';
  const client = new MongoClient(url, {
    // One local mongod. Report a down database in 5s instead of the 30s default.
    serverSelectionTimeoutMS: 5_000,
  });
  try {
    await client.connect();
  } catch (error) {
    throw new Error(
      `Can’t reach MongoDB at ${url}. Start the local server, then connect Compass to that address.`,
      { cause: error },
    );
  }
  const db = client.db(name);
  await ensureSchema(db);
  const users = db.collection<UserDocument>('users');
  const sessions = db.collection<SessionDocument>('sessions');
  const matches = db.collection<MatchDocument>('matches');
  const playing = db.collection<PlayingDocument>('playing');
  const queue = db.collection<QueueDocument>('queue');
  const joinQueue = (userId: string, matchKey: string) =>
    queue.updateOne(
      { _id: userId },
      { $set: { matchKey }, $setOnInsert: { joinedAt: new Date() } },
      { upsert: true },
    );

  return {
    async createUser(user) {
      await users.insertOne({
        _id: user.id,
        email: user.email,
        username: user.username,
        passwordHash: user.passwordHash,
        createdAt: new Date(),
      });
    },
    async userById(id) {
      return readUser(await users.findOne({ _id: id }));
    },
    async userByEmail(email) {
      return readUser(await users.findOne({ email }));
    },
    async userByUsername(username) {
      return readUser(await users.findOne({ username }, { collation: usernameCollation }));
    },
    async createSession(tokenHash, userId, expiresAt) {
      await sessions.insertOne({ _id: tokenHash, userId, expiresAt: new Date(expiresAt) });
    },
    async userForSession(tokenHash, now) {
      const session = await sessions.findOne({ _id: tokenHash });
      if (!session || session.expiresAt.getTime() <= now) {
        if (session) await sessions.deleteOne({ _id: tokenHash });
        return null;
      }
      const user = await users.findOne(
        { _id: session.userId },
        { projection: { passwordHash: 0 } },
      );
      if (!user) return null;
      return { id: user._id, email: user.email, username: user.username };
    },
    async deleteSession(tokenHash) {
      await sessions.deleteOne({ _id: tokenHash });
    },
    async matchForUser(userId) {
      const seat = await playing.findOne({ _id: userId });
      if (!seat) return null;
      const match = await matches.findOne({ _id: seat.matchId });
      if (!match) {
        await playing.deleteOne({ _id: userId, matchId: seat.matchId });
        return null;
      }
      return readMatch(match);
    },
    async match(id) {
      const found = await matches.findOne({ _id: id });
      return found ? readMatch(found) : null;
    },
    async insertMatch(match) {
      try {
        await playing.insertMany([
          { _id: match.seats[0], matchId: match.id },
          { _id: match.seats[1], matchId: match.id },
        ]);
      } catch {
        await playing.deleteMany({ matchId: match.id });
        return false;
      }
      try {
        await matches.insertOne(matchDocument(match));
      } catch {
        await playing.deleteMany({ matchId: match.id });
        return false;
      }
      return true;
    },
    async saveMatch(match) {
      const result = await matches.updateOne(
        { _id: match.id, revision: match.revision, endedAt: null },
        { $set: liveFields(match) },
      );
      return result.matchedCount === 1;
    },
    async markAway(match) {
      const result = await matches.updateOne(
        { _id: match.id, revision: match.revision },
        {
          $set: {
            away: dates(match.away),
            session: structuredClone(match.session),
            revision: match.revision + 1,
          },
        },
      );
      return result.matchedCount === 1;
    },
    async setConnected(matchId, index, connected) {
      await matches.updateOne({ _id: matchId }, { $set: { [`connected.${index}`]: connected } });
    },
    async endMatch(match, winner) {
      const result = await matches.updateOne(
        { _id: match.id, revision: match.revision, endedAt: null },
        {
          $set: {
            ...liveFields(match),
            endedAt: new Date(),
            winner,
          },
        },
      );
      return result.matchedCount === 1;
    },
    async followOn(previousId, match) {
      const claimed = await playing.updateOne(
        { _id: match.seats[0], matchId: previousId },
        { $set: { matchId: match.id } },
      );
      if (claimed.modifiedCount !== 1) return false;
      const other = await playing.updateOne(
        { _id: match.seats[1], matchId: previousId },
        { $set: { matchId: match.id } },
      );
      if (other.modifiedCount !== 1) {
        await playing.updateOne(
          { _id: match.seats[0], matchId: match.id },
          { $set: { matchId: previousId } },
        );
        return false;
      }
      try {
        await matches.insertOne(matchDocument(match));
      } catch {
        await playing.updateOne(
          { _id: match.seats[0], matchId: match.id },
          { $set: { matchId: previousId } },
        );
        await playing.updateOne(
          { _id: match.seats[1], matchId: match.id },
          { $set: { matchId: previousId } },
        );
        return false;
      }
      return true;
    },
    async release(id) {
      await playing.deleteMany({ matchId: id });
    },
    async wait(userId, matchKey) {
      await joinQueue(userId, matchKey);
    },
    async clearQueue() {
      await queue.deleteMany({});
    },
    async liveMatches() {
      return (await matches.find({ endedAt: null }).toArray())
        .map(readMatch)
        .filter((match): match is StoredMatch => match !== null);
    },
    async ping() {
      try {
        await db.command({ ping: 1 });
        return true;
      } catch {
        return false;
      }
    },
    async claimOpponent(userId, matchKey) {
      await joinQueue(userId, matchKey);
      const me = await queue.findOne({ _id: userId });
      if (!me) return null;
      const claimed = await queue.findOneAndDelete(
        {
          _id: { $ne: userId },
          matchKey,
          $or: [
            { joinedAt: { $lt: me.joinedAt } },
            { joinedAt: me.joinedAt, _id: { $lt: userId } },
          ],
        },
        { sort: { joinedAt: 1, _id: 1 } },
      );
      if (!claimed) return null;
      await queue.deleteOne({ _id: userId });
      return claimed._id;
    },
    async leaveQueue(userId) {
      await queue.deleteOne({ _id: userId });
    },
    async queued(userId) {
      return (await queue.findOne({ _id: userId })) !== null;
    },
    async staleMatches(graceBefore, noShowBefore) {
      const staleCutoff = new Date(noShowBefore);
      const stale = await matches
        .find({
          endedAt: null,
          $or: [{ 'away.0': { $lte: staleCutoff } }, { 'away.1': { $lte: staleCutoff } }],
        })
        .toArray();
      const expired: { match: StoredMatch; expired: [boolean, boolean] }[] = [];
      for (const document of stale) {
        const match = readMatch(document);
        if (!match) continue;
        const gone: [boolean, boolean] = [0, 1].map((index) => {
          const left = match.away[index];
          const cutoff = match.connected[index] ? graceBefore : noShowBefore;
          return left !== null && left <= cutoff;
        }) as [boolean, boolean];
        if (gone[0] || gone[1]) expired.push({ match, expired: gone });
      }
      return expired;
    },
    async close() {
      await client.close();
    },
    async drop() {
      await db.dropDatabase();
      await client.close();
    },
  };
}

type UserDocument = {
  _id: string;
  email: string;
  username: string;
  passwordHash: string;
  createdAt: Date;
};

type SessionDocument = { _id: string; userId: string; expiresAt: Date };

type MatchDocument = {
  _id: string;
  seats: [string, string];
  session: Session;
  variantConfig?: ResolvedVariantConfig | null;
  lastUpdate?: StoredRevisionUpdate | null;
  revision: number;
  away: [Date | null, Date | null];
  connected?: [boolean, boolean];
  endedAt: Date | null;
  winner: string | null;
};

type PlayingDocument = { _id: string; matchId: string };
type QueueDocument = { _id: string; joinedAt: Date; matchKey?: string };

async function ensureSchema(db: Db) {
  const meta = db.collection<{ _id: string; version: number }>('meta');
  const current = await meta.findOne({ _id: 'schema' });
  if (current?.version === schemaVersion) return;
  await createCollection(db, 'users', {
    bsonType: 'object',
    required: ['_id', 'email', 'username', 'passwordHash', 'createdAt'],
    properties: {
      _id: { bsonType: 'string' },
      email: { bsonType: 'string' },
      username: { bsonType: 'string' },
      passwordHash: { bsonType: 'string' },
      createdAt: { bsonType: 'date' },
    },
  });
  await createCollection(db, 'sessions', {
    bsonType: 'object',
    required: ['_id', 'userId', 'expiresAt'],
    properties: {
      _id: { bsonType: 'string' },
      userId: { bsonType: 'string' },
      expiresAt: { bsonType: 'date' },
    },
  });
  await createCollection(db, 'matches', {
    bsonType: 'object',
    required: ['_id', 'seats', 'session'],
    properties: {
      _id: { bsonType: 'string' },
      seats: { bsonType: 'array', minItems: 2, maxItems: 2, items: { bsonType: 'string' } },
      session: { bsonType: 'object' },
      variantConfig: { bsonType: ['object', 'null'] },
      lastUpdate: { bsonType: ['object', 'null'] },
      away: { bsonType: 'array', minItems: 2, maxItems: 2 },
      connected: { bsonType: 'array', minItems: 2, maxItems: 2 },
      endedAt: { bsonType: ['date', 'null'] },
      winner: { bsonType: ['string', 'null'] },
    },
  });
  const users = db.collection('users');
  await users.createIndex({ email: 1 }, { unique: true });
  await users.createIndex({ username: 1 }, { unique: true, collation: usernameCollation });
  await db.collection('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await createCollection(db, 'playing', {
    bsonType: 'object',
    required: ['_id', 'matchId'],
    properties: { _id: { bsonType: 'string' }, matchId: { bsonType: 'string' } },
  });
  await createCollection(db, 'queue', {
    bsonType: 'object',
    required: ['_id', 'joinedAt'],
    properties: {
      _id: { bsonType: 'string' },
      joinedAt: { bsonType: 'date' },
      matchKey: { bsonType: 'string' },
    },
  });
  await db.collection('queue').createIndex({ joinedAt: 1 });
  await meta.updateOne({ _id: 'schema' }, { $set: { version: schemaVersion } }, { upsert: true });
}

function dates(away: [number | null, number | null]): [Date | null, Date | null] {
  return [away[0] === null ? null : new Date(away[0]), away[1] === null ? null : new Date(away[1])];
}

function liveFields(match: StoredMatch) {
  return {
    seats: match.seats,
    session: match.session,
    variantConfig: match.variantConfig,
    lastUpdate: match.lastUpdate,
    revision: match.revision + 1,
    away: dates(match.away),
    connected: match.connected,
  };
}

function matchDocument(match: StoredMatch): MatchDocument {
  return {
    _id: match.id,
    seats: match.seats,
    session: match.session,
    variantConfig: match.variantConfig,
    lastUpdate: match.lastUpdate,
    revision: 0,
    away: dates(match.away),
    connected: [...match.connected] as [boolean, boolean],
    endedAt: null,
    winner: null,
  };
}

function readMatch(document: MatchDocument): StoredMatch | null {
  if (!Array.isArray(document.seats) || document.seats.length !== 2) return null;
  const [first, second] = document.seats;
  if (typeof first !== 'string' || typeof second !== 'string' || first === second) return null;
  const session = readSession(document.session);
  if (!session) return null;
  let variantConfig: ResolvedVariantConfig | null = null;
  try {
    if (document.variantConfig != null)
      variantConfig = resolveVariantConfig(document.variantConfig);
  } catch {
    return null;
  }
  if (
    variantConfig &&
    (session.state.ruleset !== 'POWERUPS_V1' ||
      session.state.variantConfigHash !== variantConfig.hash)
  )
    return null;
  const endedAt = document.endedAt instanceof Date ? document.endedAt.getTime() : null;
  const winner = typeof document.winner === 'string' ? document.winner : null;
  if (document.winner != null && document.winner !== null && typeof document.winner !== 'string')
    return null;
  if (endedAt !== null && winner !== null && !document.seats.includes(winner)) return null;
  const outcomeWinner = session.state.outcome?.winner;
  if (
    endedAt !== null &&
    winner !== null &&
    outcomeWinner !== null &&
    outcomeWinner !== undefined &&
    document.seats[outcomeWinner] !== winner
  )
    return null;
  return {
    id: document._id,
    seats: [first, second],
    session,
    variantConfig,
    lastUpdate: readRevisionUpdate(document.lastUpdate),
    revision: document.revision,
    away: [
      document.away?.[0] instanceof Date ? document.away[0].getTime() : null,
      document.away?.[1] instanceof Date ? document.away[1].getTime() : null,
    ],
    connected: [document.connected?.[0] === true, document.connected?.[1] === true],
    endedAt,
    winner,
  };
}

function readRevisionUpdate(value: unknown): StoredRevisionUpdate | null {
  if (!value || typeof value !== 'object') return null;
  const envelope = value as { revision?: unknown; details?: unknown };
  if (
    !Number.isSafeInteger(envelope.revision) ||
    Number(envelope.revision) < 1 ||
    !envelope.details ||
    typeof envelope.details !== 'object'
  )
    return null;
  const details = envelope.details as Record<string, unknown>;
  const presentations = readPresentations(details);
  if (!presentations) return null;
  const {
    dice: _dice,
    rerolledDie: _rerolledDie,
    sequence: _sequence,
    resetDice: _resetDice,
    presentations: _presentations,
    ...current
  } = structuredClone(details);
  return {
    revision: Number(envelope.revision),
    details: { ...current, presentations } as StoredRevisionUpdate['details'],
  };
}

function readPresentations(details: Record<string, unknown>): PresentationJob[] | null {
  if (Array.isArray(details.presentations))
    return details.presentations.every(isPresentationJob)
      ? structuredClone(details.presentations)
      : null;
  const legacy =
    details.resetDice === true
      ? { type: 'RESET_DICE' as const, blocking: false as const }
      : Array.isArray(details.dice)
        ? {
            type: 'DICE' as const,
            blocking: true as const,
            values: details.dice,
            ...(details.rerolledDie === undefined ? {} : { rerolledDie: details.rerolledDie }),
          }
        : Array.isArray(details.sequence)
          ? { type: 'MOVE' as const, blocking: true as const, sequence: details.sequence }
          : null;
  if (!legacy) return [];
  return isPresentationJob(legacy) ? [structuredClone(legacy)] : null;
}

async function createCollection(db: Db, name: string, validator: object) {
  const existing = await db.listCollections({ name }).hasNext();
  if (existing) return;
  await db.createCollection(name, { validator: { $jsonSchema: validator } });
}

function readUser(document: UserDocument | null): StoredUser | null {
  if (!document) return null;
  return {
    id: document._id,
    email: document.email,
    username: document.username,
    passwordHash: document.passwordHash,
  };
}

function readSession(value: unknown): Session | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as { state?: unknown; history?: unknown };
  const state = readState(candidate.state);
  if (!state || !Array.isArray(candidate.history)) return null;
  const history = candidate.history.map(readState);
  if (history.some((entry) => entry === null)) return null;
  return { state, history: history as GameState[] };
}

const outcomeKinds: readonly OutcomeKind[] = [
  'BEAR_OFF',
  'MARS',
  'MOTHER_VICTORY',
  'DRAW',
  'RESIGNATION',
  'DISCONNECT',
  'NO_SHOW',
  'ABANDONED',
  'TIMEOUT',
];

function readState(value: unknown): GameState | null {
  if (!value || typeof value !== 'object') return null;
  const state = structuredClone(value) as Partial<GameState> & Record<string, unknown>;
  migrateLegacyOpening(state);
  if (!Array.isArray(state.board) || state.board.length !== 24) return null;
  if (!Array.isArray(state.off) || state.off.length !== 2) return null;
  const checkers: number[] = [];
  for (const stack of [...state.board, ...state.off]) {
    if (!Array.isArray(stack)) return null;
    for (const checker of stack) {
      if (!Number.isInteger(checker) || checker < 0 || checker > 29) return null;
      checkers.push(checker);
    }
  }
  if (checkers.length !== 30 || new Set(checkers).size !== 30) return null;
  if (!isPhase(state.phase)) return null;
  if (state.active !== null && state.active !== 0 && state.active !== 1) return null;
  if (!isDice(state.remaining) || !isDice(state.roll)) return null;
  if (!isStoredOpening(state.opening)) return null;
  if (state.outcome !== null && !isOutcome(state.outcome)) return null;
  if (state.ruleset !== 'CLASSIC' && state.ruleset !== 'POWERUPS_V1') return null;
  if (state.variantConfigHash !== null && typeof state.variantConfigHash !== 'string') return null;
  if (state.powerups !== null && (!state.powerups || typeof state.powerups !== 'object'))
    return null;
  if (state.powerups && !readPowerups(state.powerups)) return null;
  if (!Array.isArray(state.diceModifiers)) return null;
  if (state.rollSource !== null && state.rollSource !== 'loadedKnuckles') return null;
  if (state.clock !== undefined && state.clock !== null && !isClock(state.clock)) return null;
  if (state.clock === undefined) state.clock = null;
  const decoded = state as GameState;
  return isNetworkGameState(decoded) ? decoded : null;
}

function migrateLegacyOpening(state: Record<string, unknown>) {
  delete state.message;
  delete state.messageKey;
  delete state.messageParams;
  if (state.phase === 'OPENING_ROLL') state.phase = 'OPENING';
  if (state.opening && typeof state.opening === 'object') {
    delete state.openingRolls;
    delete state.openingAttempts;
    return;
  }
  if (state.opening === true) {
    state.opening = { status: 'PENDING' };
  } else if (state.opening === false) {
    const attempts = Array.isArray(state.openingAttempts)
      ? state.openingAttempts.filter(
          (attempt): attempt is [number, number] =>
            Array.isArray(attempt) && attempt.length === 2 && attempt.every(isDie),
        )
      : [];
    const validAttempts =
      attempts.length > 0 &&
      attempts.slice(0, -1).every(([left, right]) => left === right) &&
      attempts.at(-1)![0] !== attempts.at(-1)![1]
        ? attempts
        : [];
    const winner = validAttempts.length
      ? validAttempts.at(-1)![0] > validAttempts.at(-1)![1]
        ? 0
        : 1
      : state.active === 1
        ? 1
        : 0;
    state.opening = {
      status: 'RESOLVED',
      attempts: validAttempts.length ? validAttempts : [winner === 0 ? [6, 1] : [1, 6]],
      winner,
    };
  }
  delete state.openingRolls;
  delete state.openingAttempts;
}

function isStoredOpening(value: unknown): value is GameState['opening'] {
  if (!value || typeof value !== 'object') return false;
  const opening = value as Record<string, unknown>;
  if (opening.status === 'PENDING') return true;
  return (
    opening.status === 'RESOLVED' &&
    (opening.winner === 0 || opening.winner === 1) &&
    Array.isArray(opening.attempts) &&
    opening.attempts.length > 0 &&
    opening.attempts.every(
      (attempt) => Array.isArray(attempt) && attempt.length === 2 && attempt.every(isDie),
    )
  );
}

/**
 * Normalizes persisted effect snapshots. Matches written before public constraints replaced the
 * modifier bag are migrated on read so a deploy cannot strand a live match.
 */
function readPowerups(powerups: NonNullable<GameState['powerups']>): boolean {
  const effects = (powerups as unknown as { activeEffects?: unknown }).activeEffects;
  if (!Array.isArray(effects)) return false;
  const migrated: unknown[] = [];
  for (const effect of effects) {
    if (!effect || typeof effect !== 'object') return false;
    const entry = effect as Record<string, unknown>;
    const constraints = readConstraints(entry);
    if (!constraints) return false;
    migrated.push({ ...entry, constraints });
  }
  (powerups as unknown as { activeEffects: unknown[] }).activeEffects = migrated;
  return true;
}

type LegacyEffectModifiers = {
  blockLeaving?: boolean;
  blockLanding?: boolean;
  anchorChecker?: number;
  dicePenalty?: Omit<Extract<EffectConstraint, { kind: 'DICE_PENALTY' }>, 'kind'>;
};

function readConstraints(effect: Record<string, unknown>): EffectConstraint[] | null {
  if (Array.isArray(effect.constraints)) return effect.constraints as EffectConstraint[];
  const modifiers = effect.modifiers as LegacyEffectModifiers | undefined;
  if (!modifiers || typeof modifiers !== 'object') return null;
  const constraints: EffectConstraint[] = [];
  if (modifiers.blockLeaving) constraints.push({ kind: 'BLOCK_LEAVING' });
  if (modifiers.blockLanding) constraints.push({ kind: 'BLOCK_LANDING' });
  if (typeof modifiers.anchorChecker === 'number')
    constraints.push({ kind: 'ANCHOR_CHECKER', checker: modifiers.anchorChecker });
  if (modifiers.dicePenalty) constraints.push({ kind: 'DICE_PENALTY', ...modifiers.dicePenalty });
  return constraints;
}

function isClock(value: unknown): value is GameClock {
  if (!value || typeof value !== 'object') return false;
  const clock = value as Record<string, unknown>;
  return (
    Number.isFinite(clock.remainingMs) &&
    Number(clock.remainingMs) >= 0 &&
    typeof clock.running === 'boolean' &&
    (clock.deadline === null || Number.isFinite(clock.deadline))
  );
}

function isDice(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(isDie);
}

function isDie(value: unknown): boolean {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 6;
}

function isOutcome(value: unknown): value is Outcome {
  if (!value || typeof value !== 'object') return false;
  const outcome = value as Record<string, unknown>;
  if (outcome.winner !== null && outcome.winner !== 0 && outcome.winner !== 1) return false;
  if (!Number.isInteger(outcome.points) || Number(outcome.points) < 0) return false;
  if (typeof outcome.reason !== 'string') return false;
  if (outcome.kind !== undefined && !outcomeKinds.includes(outcome.kind as OutcomeKind))
    return false;
  if (outcome.kind === undefined) outcome.kind = inferredOutcomeKind(outcome.reason);
  return true;
}

function inferredOutcomeKind(reason: string): OutcomeKind {
  if (reason.includes('Mother')) return 'MOTHER_VICTORY';
  if (reason.includes('Mars')) return 'MARS';
  if (reason.includes('draw')) return 'DRAW';
  return 'BEAR_OFF';
}
