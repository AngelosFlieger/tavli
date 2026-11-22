import test from 'node:test';
import assert from 'node:assert/strict';
import { connectTable, decodeServerMessage, type TableEvents } from '../src/net/client';
import { initialGameState } from '../src/game/session/state';
import { PROTOCOL_VERSION } from '../src/net/messages';

test('an unsent matchmaking request survives a temporary connection failure', () => {
  const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalWebSocket = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket');
  const sockets: FakeSocket[] = [];
  const retries: (() => void)[] = [];

  class FakeSocket {
    static readonly OPEN = 1;
    readyState = 0;
    sent: string[] = [];
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: (() => void) | null = null;

    constructor(readonly url: string) {
      sockets.push(this);
    }

    send(packet: string) {
      this.sent.push(packet);
    }

    close() {
      this.readyState = 3;
    }

    open() {
      this.readyState = FakeSocket.OPEN;
      this.onopen?.();
    }

    disconnect() {
      this.readyState = 3;
      this.onclose?.();
    }

    receive(message: unknown) {
      this.onmessage?.({ data: JSON.stringify(message) });
    }
  }

  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { protocol: 'http:', host: 'example.test' },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      setTimeout(callback: () => void) {
        retries.push(callback);

        return retries.length;
      },
      clearTimeout() {},
    },
  });
  Object.defineProperty(globalThis, 'WebSocket', {
    configurable: true,
    value: FakeSocket,
  });

  try {
    const noop = () => {};
    const events: TableEvents = {
      onReady: noop,
      onResume: noop,
      onRejected: noop,
      onReconnect: noop,
      onWaiting: noop,
      onRoom: noop,
      onMatched: noop,
      onUpdate: noop,
      onError: noop,
      onRematch: noop,
      onLeft: noop,
      onClose: noop,
    };
    const table = connectTable(events);

    table.find({ ruleset: 'CLASSIC' });
    assert.equal(sockets.length, 1);
    sockets[0]!.open();
    assert.deepEqual(JSON.parse(sockets[0]!.sent[0]!), {
      type: 'hello',
      protocol: PROTOCOL_VERSION,
    });

    sockets[0]!.disconnect();
    assert.equal(retries.length, 1);
    retries.shift()!();
    assert.equal(sockets.length, 2);
    sockets[1]!.open();
    sockets[1]!.receive({ type: 'ready', protocol: PROTOCOL_VERSION, name: 'Ada' });

    assert.deepEqual(
      sockets[1]!.sent.map((packet) => JSON.parse(packet)),
      [
        { type: 'hello', protocol: PROTOCOL_VERSION },
        { type: 'find', selection: { ruleset: 'CLASSIC' } },
      ],
    );
  } finally {
    restore('location', originalLocation);
    restore('window', originalWindow);
    restore('WebSocket', originalWebSocket);
  }
});

test('server messages are reconstructed only after complete validation', () => {
  const state = initialGameState();
  const update = {
    type: 'update',
    matchId: 'match-1',
    revision: 0,
    state,
    canUndo: false,
    presentations: [],
  };

  assert.deepEqual(decodeServerMessage(JSON.stringify(update)), update);
  assert.deepEqual(
    decodeServerMessage(JSON.stringify({ type: 'ready', protocol: PROTOCOL_VERSION, name: 'Ada' })),
    { type: 'ready', protocol: PROTOCOL_VERSION, name: 'Ada' },
  );
  assert.deepEqual(decodeServerMessage(JSON.stringify({ type: 'room', code: '12ABEF' })), {
    type: 'room',
    code: '12ABEF',
  });
  assert.deepEqual(decodeServerMessage(JSON.stringify({ type: 'error', code: 'AUTH' })), {
    type: 'error',
    code: 'AUTH',
  });

  const invalidMessages = [
    null,
    { type: 'ready', protocol: PROTOCOL_VERSION, name: 123 },
    { type: 'room', code: '../bad' },
    { type: 'error', code: 'USER_CONTROLLED' },
    { type: 'matched', you: 0 },
    { ...update, revision: -1 },
    { ...update, state: { ...state, phase: 'HACKED' } },
    { type: 'rematch', status: 'FORCED' },
    { type: 'unknown' },
  ];

  for (const message of invalidMessages)
    assert.equal(decodeServerMessage(JSON.stringify(message)), null);

  assert.equal(decodeServerMessage('{not json'), null);
  assert.equal(decodeServerMessage(new Uint8Array()), null);
});

function restore(name: 'location' | 'window' | 'WebSocket', descriptor?: PropertyDescriptor) {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else Reflect.deleteProperty(globalThis, name);
}
