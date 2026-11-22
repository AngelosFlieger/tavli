import test from 'node:test';
import assert from 'node:assert/strict';
import { OnlineAuthorityClient } from '../src/app/online-authority-client';
import type { CommandRequest } from '../src/net/messages';

test('online authority owns seat, command identity, acknowledgement, and reconnect lifetime', () => {
  const authority = new OnlineAuthorityClient();
  const sent: CommandRequest[] = [];
  authority.join(1, (request) => sent.push(request));

  assert.equal(authority.connected, true);
  assert.equal(authority.seat, 1);
  authority.send({ type: 'roll' });
  assert.deepEqual(sent, [{ commandId: 'command-1', command: { type: 'roll' } }]);
  assert.equal(authority.pendingCommandId, 'command-1');

  authority.sendUntracked({ type: 'restart' });
  assert.deepEqual(sent.at(-1), {
    commandId: 'command-2',
    command: { type: 'restart' },
  });
  assert.equal(authority.pendingCommandId, 'command-1');

  authority.acknowledge();
  assert.equal(authority.pendingCommandId, null);
  authority.leave();
  assert.equal(authority.connected, false);
  assert.equal(authority.seat, null);
  assert.throws(() => authority.send({ type: 'roll' }), /without an authority connection/);

  authority.join(0, (request) => sent.push(request));
  authority.send({ type: 'undo' });
  assert.equal(authority.pendingCommandId, 'command-3');
});
