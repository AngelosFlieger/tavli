import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionToken } from '../server/routes';

test('session cookies accept only the exact token shape issued by the server', () => {
  const token = 'A'.repeat(43);

  assert.equal(sessionToken(`other=value; plakoto_session=${token}`), token);
  assert.equal(sessionToken('plakoto_session='), null);
  assert.equal(sessionToken(`plakoto_session=${token}A`), null);
  assert.equal(sessionToken('plakoto_session=../../admin'), null);
  assert.equal(sessionToken('plakoto_session=%E0%A4%A'), null);
  assert.equal(sessionToken(undefined), null);
});
