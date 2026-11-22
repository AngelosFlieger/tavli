import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, scrypt } from 'node:crypto';
import { createAccounts } from '../server/accounts';
import { openStore } from '../server/store';

test('registration creates a session and the same email cannot register twice', async () => {
  const store = await openStore({ name: `plakoto-test-${randomUUID()}` });

  try {
    const accounts = createAccounts(store);
    const created = await accounts.register('Ada@Example.com', 'Ada', 'password1');

    assert.equal(created.ok, true);

    if (!created.ok) return;

    assert.equal(created.username, 'Ada');
    assert.match(
      (await store.userByEmail('ada@example.com'))?.passwordHash ?? '',
      /^scrypt:131072:8:1:/,
    );

    const duplicateEmail = await accounts.register('ada@example.com', 'Ada2', 'password1');

    assert.equal(duplicateEmail.ok, false);

    if (duplicateEmail.ok) return;

    assert.equal(duplicateEmail.status, 409);

    const duplicateName = await accounts.register('other@example.com', 'ada', 'password1');

    assert.equal(duplicateName.ok, false);

    if (duplicateName.ok) return;

    assert.equal(duplicateName.status, 409);

    const wrong = await accounts.login('ada@example.com', 'nope-nope');

    assert.equal(wrong.ok, false);

    const signedIn = await accounts.login('ADA', 'password1');

    assert.equal(signedIn.ok, true);
    assert.equal(await accounts.authenticate('A'.repeat(43)), null);
    await accounts.logout('A'.repeat(43));
  } finally {
    await store.drop();
  }
});

test('a successful login upgrades a legacy password hash', async () => {
  const store = await openStore({ name: `plakoto-test-${randomUUID()}` });

  try {
    const salt = Buffer.from('legacy-password-salt');
    const hash = await legacyPasswordHash('password1', salt);

    await store.createUser({
      id: randomUUID(),
      email: 'ada@example.com',
      username: 'Ada',
      passwordHash: `scrypt:${salt.toString('base64url')}:${hash.toString('base64url')}`,
    });

    const signedIn = await createAccounts(store).login('ada@example.com', 'password1');

    assert.equal(signedIn.ok, true);
    assert.match(
      (await store.userByEmail('ada@example.com'))?.passwordHash ?? '',
      /^scrypt:131072:8:1:/,
    );
  } finally {
    await store.drop();
  }
});

function legacyPasswordHash(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 32, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}
