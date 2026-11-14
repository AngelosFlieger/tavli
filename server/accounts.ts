import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Store } from './store';

const scryptHash = promisify(scrypt);
const sessionDays = 30;

export type AuthSuccess = { ok: true; token: string; username: string };
export type AuthFailure = { ok: false; status: number; error: string };

export function createAccounts(store: Store, now = () => Date.now()) {
  return {
    register(email: string, username: string, password: string) {
      return createUser(store, now, email, username, password);
    },
    login(identifier: string, password: string) {
      return signIn(store, now, identifier, password);
    },
    authenticate(token: string) {
      return store.userForSession(hashToken(token), now());
    },
    async logout(token: string) {
      await store.deleteSession(hashToken(token));
    },
  };
}

async function createUser(
  store: Store,
  now: () => number,
  emailInput: string,
  usernameInput: string,
  password: string,
): Promise<AuthSuccess | AuthFailure> {
  const email = normalizeEmail(emailInput);
  const username = cleanUsername(usernameInput);
  const passwordError = checkPassword(password);
  if (!email) return { ok: false, status: 400, error: 'Enter a valid email.' };
  if (!username)
    return {
      ok: false,
      status: 400,
      error: 'Use a username of 3 to 20 letters, numbers, or underscores.',
    };
  if (passwordError) return { ok: false, status: 400, error: passwordError };
  if (await store.userByEmail(email))
    return { ok: false, status: 409, error: 'An account with that email already exists.' };
  if (await store.userByUsername(username))
    return { ok: false, status: 409, error: 'That username is taken.' };
  const id = randomUUID();
  await store.createUser({ id, email, username, passwordHash: await hashPassword(password) });
  return { ok: true, token: await issue(store, id, now), username };
}

async function signIn(
  store: Store,
  now: () => number,
  identifier: string,
  password: string,
): Promise<AuthSuccess | AuthFailure> {
  const passwordError = checkPassword(password);
  if (passwordError) return { ok: false, status: 400, error: passwordError };
  const trimmed = identifier.trim();
  const email = normalizeEmail(trimmed);
  const existing = email ? await store.userByEmail(email) : await store.userByUsername(trimmed);
  if (!existing || !(await verifyPassword(password, existing.passwordHash)))
    return { ok: false, status: 401, error: 'Email, username, or password is wrong.' };
  return { ok: true, token: await issue(store, existing.id, now), username: existing.username };
}

function checkPassword(password: string) {
  if (password.length < 8 || password.length > 72) return 'Use a password of 8 to 72 characters.';
  return null;
}

async function issue(store: Store, userId: string, now: () => number) {
  const token = randomBytes(32).toString('base64url');
  await store.createSession(hashToken(token), userId, now() + sessionDays * 24 * 60 * 60 * 1000);
  return token;
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function normalizeEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export function cleanUsername(value: string) {
  const username = value.trim();
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return null;
  return username;
}

async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = (await scryptHash(password, salt, 32)) as Buffer;
  return `scrypt:${salt.toString('base64url')}:${hash.toString('base64url')}`;
}

async function verifyPassword(password: string, stored: string) {
  const [kind, salt, hash] = stored.split(':');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const actual = (await scryptHash(password, Buffer.from(salt, 'base64url'), 32)) as Buffer;
  const expected = Buffer.from(hash, 'base64url');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
