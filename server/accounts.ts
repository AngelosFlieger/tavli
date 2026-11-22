import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';
import type { Store } from './store';

const sessionDays = 30;

const passwordScrypt = Object.freeze({
  N: 2 ** 17,
  r: 8,
  p: 1,
  maxmem: 256 * 1024 * 1024,
}) satisfies ScryptOptions;

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
    authenticate(token: string | null) {
      return store.userForSession(hashToken(token ?? ''), now());
    },
    async logout(token: string | null) {
      await store.deleteSession(hashToken(token ?? ''));
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

  if (!existing) return { ok: false, status: 401, error: 'Email, username, or password is wrong.' };

  const passwordStatus = await verifyPassword(password, existing.passwordHash);

  if (passwordStatus === 'INVALID')
    return { ok: false, status: 401, error: 'Email, username, or password is wrong.' };
  if (passwordStatus === 'LEGACY')
    await store.updatePasswordHash(existing.id, await hashPassword(password));

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
  const hash = await derivePassword(password, salt, passwordScrypt);

  return [
    'scrypt',
    passwordScrypt.N,
    passwordScrypt.r,
    passwordScrypt.p,
    salt.toString('base64url'),
    hash.toString('base64url'),
  ].join(':');
}

async function verifyPassword(password: string, stored: string) {
  const parts = stored.split(':');
  const legacy = parts.length === 3 && parts[0] === 'scrypt';
  const current =
    parts.length === 6 &&
    parts[0] === 'scrypt' &&
    parts[1] === String(passwordScrypt.N) &&
    parts[2] === String(passwordScrypt.r) &&
    parts[3] === String(passwordScrypt.p);

  if (!legacy && !current) return 'INVALID';

  const salt = legacy ? parts[1] : parts[4];
  const hash = legacy ? parts[2] : parts[5];

  if (!salt || !hash) return 'INVALID';

  const actual = await derivePassword(
    password,
    Buffer.from(salt, 'base64url'),
    current ? passwordScrypt : undefined,
  );
  const expected = Buffer.from(hash, 'base64url');

  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return 'INVALID';

  return legacy ? 'LEGACY' : 'CURRENT';
}

function derivePassword(password: string, salt: Buffer, options?: ScryptOptions) {
  return new Promise<Buffer>((resolve, reject) => {
    const complete = (error: Error | null, derivedKey: Buffer) => {
      if (error) reject(error);
      else resolve(derivedKey);
    };

    if (options) scrypt(password, salt, 32, options, complete);
    else scrypt(password, salt, 32, complete);
  });
}
