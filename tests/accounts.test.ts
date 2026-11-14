import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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
    assert.equal((await accounts.authenticate(created.token))?.email, 'ada@example.com');

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
    if (!signedIn.ok) return;
    await accounts.logout(created.token);
    assert.equal(await accounts.authenticate(created.token), null);
    assert.equal((await accounts.authenticate(signedIn.token))?.username, 'Ada');
  } finally {
    await store.drop();
  }
});
