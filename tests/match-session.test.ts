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
import type { MatchSelection } from '../src/net/messages';

test('match session cancels searches and rejects a late pairing', () => {
  const controller = new GameController();
  const calls: string[] = [];
  let events!: MatchEvents;
  const transport: MatchTransport = {
    connect: () => {},
    find: () => calls.push('find'),
    cancel: () => calls.push('cancel'),
    send: () => {},
    abandon: () => {},
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
      signedOut: () => calls.push('signed-out'),
    },
    (next) => {
      events = next;
      return transport;
    },
  );

  match.toggleSearch();
  assert.deepEqual(calls, ['note-null', 'find']);
  events.onWaiting();
  assert.equal(calls.at(-1), 'search-true');
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
      signedOut: () => calls.push('signed-out'),
    },
    (next) => {
      events = next;
      return {
        connect: () => {},
        find: () => calls.push('find'),
        cancel: () => calls.push('cancel'),
        send: (command) => sent.push(command),
        abandon: () => {},
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

test('match session forwards an explicit powerup selection to matchmaking', () => {
  const controller = new GameController();
  let selection: MatchSelection | undefined;
  const match = createMatchSession(
    controller,
    { join() {}, receive() {}, leave() {} },
    { startSetup() {} },
    { setSearching() {}, showNote() {}, enterTable() {}, showTitle() {} },
    () => ({
      find: (next) => {
        selection = next;
      },
      cancel() {},
      send() {},
    }),
  );
  match.toggleSearch({ ruleset: 'POWERUPS_V1', profileId: 'powerups-v1' });
  assert.deepEqual(selection, { ruleset: 'POWERUPS_V1', profileId: 'powerups-v1' });
});

test('match session configures an explicit local powerup game', () => {
  const controller = new GameController();
  let setups = 0;
  const match = createMatchSession(
    controller,
    { join() {}, receive() {}, leave() {} },
    { startSetup: () => setups++ },
    { setSearching() {}, showNote() {}, enterTable() {}, showTitle() {} },
    () => ({ find() {}, cancel() {}, send() {} }),
  );

  match.startLocal({ ruleset: 'POWERUPS_V1', profileId: 'powerups-v1' });

  assert.equal(setups, 1);
  assert.equal(controller.state.ruleset, 'POWERUPS_V1');
  assert.equal(controller.variantConfig?.id, 'powerups-v1');
  assert.equal(controller.state.variantConfigHash, controller.variantConfig?.hash);
});

test('match session resolves alternate registered profiles for local play', () => {
  const controller = new GameController();
  const match = createMatchSession(
    controller,
    { join() {}, receive() {}, leave() {} },
    { startSetup() {} },
    { setSearching() {}, showNote() {}, enterTable() {}, showTitle() {} },
    () => ({ find() {}, cancel() {}, send() {} }),
  );

  match.startLocal({ ruleset: 'POWERUPS_V1', profileId: 'fast-balance' });

  assert.equal(controller.variantConfig?.id, 'fast-balance');
  assert.equal(controller.variantConfig?.draft.intervalRounds, 1);
});

test('match session restarts the local random stream from an explicit playtest seed', () => {
  const controller = new GameController();
  const match = createMatchSession(
    controller,
    { join() {}, receive() {}, leave() {} },
    { startSetup() {} },
    { setSearching() {}, showNote() {}, enterTable() {}, showTitle() {} },
    () => ({ find() {}, cancel() {}, send() {} }),
  );

  assert.equal(match.startLocal({ ruleset: 'CLASSIC' }, 12345), true);
  assert.equal(controller.beginRoll(), true);
  const first = controller.takeForcedLocalRoll();
  controller.receiveRoll(first!);

  assert.equal(match.startLocal({ ruleset: 'CLASSIC' }, 12345), true);
  assert.equal(controller.beginRoll(), true);
  assert.deepEqual(controller.takeForcedLocalRoll(), first);
});
