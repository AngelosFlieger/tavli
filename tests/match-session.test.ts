import test from 'node:test';
import assert from 'node:assert/strict';
import { GameController } from '../src/app/game-controller';
import {
  createMatchSession,
  type MatchEvents,
  type MatchFlow,
  type MatchTransport,
} from '../src/app/match-session';
import type { Command } from '../src/net/messages';

test('match session cancels searches and rejects a late pairing', () => {
  const controller = new GameController();
  const calls: string[] = [];
  let events!: MatchEvents;
  const transport: MatchTransport = {
    find: () => calls.push('find'),
    cancel: () => calls.push('cancel'),
    send: () => {},
  };
  const flow: MatchFlow = {
    join: () => calls.push('join'),
    receive: () => {},
    leave: () => calls.push('leave'),
  };
  const match = createMatchSession(
    controller,
    flow,
    { startSetup: () => calls.push('setup') },
    {
      setSearching: (on) => calls.push(`search-${on}`),
      showNote: (note) => calls.push(`note-${note}`),
      enterTable: () => calls.push('enter'),
      showTitle: () => calls.push('title'),
    },
    (next) => {
      events = next;
      return transport;
    },
  );

  match.toggleSearch();
  assert.deepEqual(calls, ['search-true', 'note-null', 'find']);
  match.toggleSearch();
  assert.deepEqual(calls.slice(-3), ['search-false', 'cancel', 'note-null']);
  events.onMatched(0, controller.state);
  assert.equal(calls.at(-1), 'cancel');
  assert.equal(calls.includes('join'), false);

  match.toggleSearch();
  match.startLocal();
  assert.deepEqual(calls.slice(-3), ['setup', 'search-false', 'cancel']);
});

test('match session joins, forwards updates, and leaves after disconnect', () => {
  const controller = new GameController();
  const calls: string[] = [];
  const sent: Command[] = [];
  let events!: MatchEvents;
  const flow: MatchFlow = {
    join(you, send) {
      controller.join(you, send);
      calls.push(`join-${you}`);
    },
    receive: () => calls.push('update'),
    leave() {
      controller.leaveOnline();
      calls.push('leave');
    },
  };
  const match = createMatchSession(
    controller,
    flow,
    { startSetup: () => calls.push('setup') },
    {
      setSearching: (on) => calls.push(`search-${on}`),
      showNote: (note) => calls.push(`note-${note}`),
      enterTable: () => calls.push('enter'),
      showTitle: () => calls.push('title'),
    },
    (next) => {
      events = next;
      return {
        find: () => calls.push('find'),
        cancel: () => calls.push('cancel'),
        send: (command) => sent.push(command),
      };
    },
  );

  match.toggleSearch();
  events.onMatched(0, controller.state);
  assert.deepEqual(calls.slice(-5), ['search-false', 'note-null', 'join-0', 'enter', 'setup']);
  assert.equal(controller.beginRoll(), true);
  assert.deepEqual(sent, [{ type: 'roll' }]);
  events.onUpdate({ state: controller.state, canUndo: false });
  assert.equal(calls.at(-1), 'update');
  events.onClose();
  assert.deepEqual(calls.slice(-4), [
    'search-false',
    'leave',
    'title',
    'note-Can’t reach the game server.',
  ]);
  assert.equal(controller.scripted, false);
});
