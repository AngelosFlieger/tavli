import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openStore } from '../server/store';
import { createTables } from '../server/tables';

test('private rooms pair a host and joiner and reject bad codes', async () => {
  const store = await openStore({ name: `plakoto-test-${randomUUID()}` });
  const tables = createTables(store, () => 1);
  try {
    await tables.connect('ada');
    await tables.connect('basil');

    const created = await tables.createRoom('ada', { ruleset: 'CLASSIC' });
    assert.equal(created[0]?.message.type, 'room');
    if (created[0]?.message.type !== 'room') return;
    const code = created[0].message.code;
    assert.match(code, /^[A-Z0-9]{6}$/);

    const error = (await tables.joinRoom('basil', 'missing'))[0]?.message;
    assert.equal(error?.type, 'error');
    assert.equal((await tables.joinRoom('ada', code))[0]?.message.type, 'error');

    const joined = await tables.joinRoom('basil', code);
    assert.equal(joined.find((event) => event.userId === 'basil')?.message.type, 'matched');
    assert.equal(joined.find((event) => event.userId === 'ada')?.message.type, 'matched');
  } finally {
    await store.drop();
  }
});
