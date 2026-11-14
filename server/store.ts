import { MongoClient, type Db } from 'mongodb';
import type { Session } from '../src/game/session/state';

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
  revision: number;
  away: [number | null, number | null];
  /** Set when the match is finished. Null while it is still being played. */
  endedAt: number | null;
  /** Account id of the winner. Null for a draw, or while the match is still being played. */
  winner: string | null;
};

export type Store = {
  createUser(user: StoredUser): Promise<void>;
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
  /** Records the final session and winner. A later save cannot overwrite it. */
  endMatch(match: StoredMatch, winner: string | null): Promise<boolean>;
  /** Starts a new match for the same two accounts and leaves the finished one in place. */
  followOn(previousId: string, match: StoredMatch): Promise<boolean>;
  release(id: string): Promise<void>;
  claimOpponent(userId: string): Promise<string | null>;
  leaveQueue(userId: string): Promise<void>;
  queued(userId: string): Promise<boolean>;
  wait(userId: string): Promise<void>;
  expireAway(before: number): Promise<{ match: StoredMatch; released: string[] }[]>;
  close(): Promise<void>;
  drop(): Promise<void>;
};

type StoreOptions = { url?: string; name?: string };

const schemaVersion = 2;
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
  const joinQueue = (userId: string) =>
    queue.updateOne({ _id: userId }, { $setOnInsert: { joinedAt: new Date() } }, { upsert: true });

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
      await matches.insertOne(matchDocument(match));
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
        { $set: { away: dates(match.away), revision: match.revision + 1 } },
      );
      return result.matchedCount === 1;
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
    async wait(userId) {
      await joinQueue(userId);
    },
    async claimOpponent(userId) {
      await joinQueue(userId);
      const me = await queue.findOne({ _id: userId });
      if (!me) return null;
      const claimed = await queue.findOneAndDelete(
        {
          _id: { $ne: userId },
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
    async expireAway(before) {
      const cutoff = new Date(before);
      const stale = await matches
        .find({ $or: [{ 'away.0': { $lte: cutoff } }, { 'away.1': { $lte: cutoff } }] })
        .toArray();
      const expired: { match: StoredMatch; released: string[] }[] = [];
      for (const match of stale) {
        const stored = readMatch(match);
        if (!stored) continue;
        if (stored.endedAt === null) {
          const winner = forfeitWinner(stored, before);
          const won = await matches.updateOne(
            {
              _id: match._id,
              revision: stored.revision,
              endedAt: null,
              $or: [{ 'away.0': { $lte: cutoff } }, { 'away.1': { $lte: cutoff } }],
            },
            {
              $set: {
                endedAt: new Date(),
                winner,
                revision: stored.revision + 1,
                away: [null, null],
              },
            },
          );
          if (won.matchedCount === 1) {
            await playing.deleteMany({ matchId: match._id });
            expired.push({
              match: { ...stored, endedAt: before, winner, away: [null, null] },
              released: [...stored.seats],
            });
            continue;
          }
          const current = await matches.findOne({ _id: match._id });
          const again = current ? readMatch(current) : null;
          if (!again?.endedAt) continue;
          Object.assign(stored, again);
        }
        const released = stored.seats.filter((_, index) => {
          const left = stored.away[index];
          return left !== null && left <= before;
        });
        if (!released.length) continue;
        const away: [number | null, number | null] = [
          released.includes(stored.seats[0]) ? null : stored.away[0],
          released.includes(stored.seats[1]) ? null : stored.away[1],
        ];
        await playing.deleteMany({ _id: { $in: released }, matchId: match._id });
        await matches.updateOne({ _id: match._id }, { $set: { away: dates(away) } });
        expired.push({ match: { ...stored, away }, released });
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
  revision: number;
  away: [Date | null, Date | null];
  endedAt: Date | null;
  winner: string | null;
};

type PlayingDocument = { _id: string; matchId: string };
type QueueDocument = { _id: string; joinedAt: Date };

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
    properties: { _id: { bsonType: 'string' }, joinedAt: { bsonType: 'date' } },
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
    revision: match.revision + 1,
    away: dates(match.away),
  };
}

function matchDocument(match: StoredMatch): MatchDocument {
  return {
    _id: match.id,
    seats: match.seats,
    session: match.session,
    revision: 0,
    away: [null, null],
    endedAt: null,
    winner: null,
  };
}

function forfeitWinner(match: StoredMatch, before: number): string | null {
  const gone = match.away.map((left) => left !== null && left <= before);
  if (gone[0] === gone[1]) return null;
  return match.seats[gone[0] ? 1 : 0];
}

function readMatch(document: MatchDocument): StoredMatch | null {
  const session = readSession(document.session);
  if (!session || document.seats[0] === document.seats[1]) return null;
  return {
    id: document._id,
    seats: document.seats,
    session,
    revision: document.revision,
    away: [
      document.away?.[0] ? document.away[0].getTime() : null,
      document.away?.[1] ? document.away[1].getTime() : null,
    ],
    endedAt: document.endedAt ? document.endedAt.getTime() : null,
    winner: document.winner ?? null,
  };
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
  const session = value as Session;
  if (!session.state || typeof session.state !== 'object' || !Array.isArray(session.history))
    return null;
  if (typeof session.state.phase !== 'string') return null;
  return session;
}
