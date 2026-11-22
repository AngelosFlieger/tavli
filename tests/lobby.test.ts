import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/engine';
import { initialPresentedSession } from '../src/game/session/messages';
import { createLobby } from '../src/net/lobby';
import { matchKey, rulesForSelection } from '../src/game/variant/rules-context';
import { powerupsRules } from '../src/game/variant/types';
import { FAST_BALANCE, POWERUPS_V1 } from '../src/game/variant/config/profiles';
import { legalMoves } from '../src/game/rules/moves';
import { isCommand, isMatchSelection } from '../src/net/messages';
import { resolvedOpeningSession } from './support/resolved-opening';

function seat(lobby: ReturnType<typeof createLobby>, first = 'ada', second = 'basil') {
  assert.equal(lobby.restore(first, second, resolvedOpeningSession(), `${first}:${second}`), true);
}

function seatPowerups(lobby: ReturnType<typeof createLobby>) {
  assert.equal(
    lobby.restore(
      'ada',
      'basil',
      resolvedOpeningSession(powerupsRules(POWERUPS_V1)),
      'ada:basil:powers',
    ),
    true,
  );
}

const die = (values: number[]) => {
  let index = 0;
  return () => values[index++] ?? 1;
};

test('registered balance profiles use their own authoritative matchmaking queues', () => {
  const fast = { ruleset: 'POWERUPS_V1', profileId: 'fast-balance' } as const;
  const standard = { ruleset: 'POWERUPS_V1', profileId: 'powerups-v1' } as const;
  assert.equal(isMatchSelection(fast), true);
  assert.equal(isMatchSelection({ ...fast, profileId: 'unknown' }), false);
  const fastRules = rulesForSelection(fast);
  const standardRules = rulesForSelection(standard);
  assert.equal(fastRules.variantConfig?.hash, FAST_BALANCE.hash);
  assert.equal(standardRules.variantConfig?.hash, POWERUPS_V1.hash);
  assert.notEqual(matchKey(fastRules), matchKey(standardRules));
});

test('the wire protocol accepts only non-empty public effect targets', () => {
  assert.equal(
    isCommand({
      type: 'playAbility',
      activation: {
        instanceId: 'clear-1',
        target: { type: 'EFFECT', instanceId: 'jinx-1' },
      },
    }),
    true,
  );
  assert.equal(
    isCommand({
      type: 'playAbility',
      activation: { instanceId: 'clear-1', target: { type: 'EFFECT', instanceId: '' } },
    }),
    false,
  );
});

test('the online authority rejects a player roll while automatic opening is pending', () => {
  const lobby = createLobby(() => 4);
  assert.equal(lobby.restore('ada', 'basil', initialPresentedSession(), 'pending'), true);
  const rejected = lobby.act('ada', { type: 'roll' });
  assert.deepEqual(rejected?.to, ['ada']);
  assert.deepEqual(rejected?.update.presentations, []);
  assert.equal(rejected?.update.state.phase, 'OPENING');
});

test('opening is automatic, and only the player to move can request movement dice', () => {
  const lobby = createLobby(die([4, 4]));
  seat(lobby);
  assert.equal(lobby.act('basil', { type: 'roll' })?.to.length, 1);
  const rolled = lobby.act('ada', { type: 'roll' });
  assert.deepEqual(rolled?.update.presentations, [
    { type: 'DICE', blocking: true, values: [4, 4] },
  ]);
  assert.deepEqual(
    rolled?.update.events?.map((event) => event.type),
    ['RollStarted', 'DiceRolled', 'MovesAvailable'],
  );
  assert.equal(rolled?.update.state.active, 0);
  assert.equal(rolled?.update.state.phase, 'WAITING_FOR_MOVE');
});

test('a move is checked on the server and undo restores it for the same player', () => {
  const lobby = createLobby(die([2, 1]));
  seat(lobby);
  const state = lobby.act('ada', { type: 'roll' })!.update.state;
  assert.equal(state.phase, 'WAITING_FOR_MOVE');
  const move = { from: 0, to: 2, die: 2 };
  assert.equal(lobby.act('basil', { type: 'move', sequence: [move] })?.to.length, 1);
  const played = lobby.act('ada', { type: 'move', sequence: [move] });
  assert.equal(played?.update.state.board[2].length, 1);
  assert.equal(played?.update.canUndo, true);
  const undone = lobby.act('ada', { type: 'undo' });
  assert.equal(undone?.update.state.board[0].length, 15);
  assert.equal(undone?.update.canUndo, false);
});

test('an out-of-range move is rejected without interrupting the online match', () => {
  const lobby = createLobby(die([2, 1]));
  seat(lobby);
  const before = lobby.act('ada', { type: 'roll' })!.update.state;
  const rejected = lobby.act('ada', {
    type: 'move',
    sequence: [{ from: 99, to: 2, die: 2 }],
  });
  assert.deepEqual(rejected?.to, ['ada']);
  assert.deepEqual(rejected?.update.state, before);
  const played = lobby.act('ada', {
    type: 'move',
    sequence: [{ from: 0, to: 2, die: 2 }],
  });
  assert.equal(played?.update.state.board[2].length, 1);
});

test('leaving a match tells the opponent, and a restart clears the dice', () => {
  const lobby = createLobby(() => 3);
  seat(lobby);
  assert.equal(lobby.leave('ada'), 'basil');
  assert.equal(lobby.act('basil', { type: 'roll' }), null);
  seat(lobby, 'ada', 'cleo');
  const restarted = lobby.act('cleo', { type: 'restart' });
  assert.deepEqual(restarted?.update.presentations, [{ type: 'RESET_DICE', blocking: false }]);
  assert.equal(restarted?.update.state.phase, 'OPENING');
  assert.equal(restarted?.to.includes('ada'), true);
});

test('authoritative session transitions match the local facade through a turn', () => {
  const rolls = [2, 1];
  const lobby = createLobby(die(rolls));
  const local = new Game();
  local.state = resolvedOpeningSession().state;
  seat(lobby);
  assert.equal(local.beginRoll(), true);
  local.receiveRoll([2, 1]);
  const rolled = lobby.act('ada', { type: 'roll' });
  assert.deepEqual(rolled?.update.state, local.state);
  assert.equal(rolled?.update.canUndo, local.history.length > 0);
  while (local.state.phase === 'WAITING_FOR_MOVE') {
    const move = local.moves()[0];
    assert.equal(local.move(move), true);
    const result = lobby.act('ada', { type: 'move', sequence: [move] });
    assert.deepEqual(result?.update.state, local.state);
    assert.equal(result?.update.canUndo, local.history.length > 0);
  }
  assert.equal(local.state.phase, 'TURN_COMPLETE');
  assert.equal(local.endTurn(), true);
  const ended = lobby.act('ada', { type: 'end' });
  assert.deepEqual(ended?.update.state, local.state);
  assert.equal(ended?.update.canUndo, false);
});

test('a rejected server die leaves the match unchanged', () => {
  const lobby = createLobby(() => 7);
  seat(lobby);
  const before = lobby.seat('ada')?.state;
  const rejected = lobby.act('ada', { type: 'roll' });
  assert.deepEqual(rejected?.to, ['ada']);
  assert.deepEqual(rejected?.update.state, before);
  assert.deepEqual(rejected?.update.presentations, []);
});

test('a saved match can be restored for the same two accounts', () => {
  const lobby = createLobby(() => 1);
  seat(lobby);
  const snap = lobby.snapshot('basil');
  assert.ok(snap);
  assert.equal(lobby.leave('ada'), 'basil');
  assert.equal(lobby.restore(snap.ids[0], snap.ids[1], snap.session, snap.id), true);
  assert.equal(lobby.seat('ada')?.you, 0);
  assert.equal(lobby.seat('basil')?.state.phase, 'WAITING_FOR_ROLL');
  assert.equal(lobby.restore(snap.ids[0], snap.ids[1], snap.session, snap.id), false);
});

test('powerup match authority supplies Recast randomness after an authoritative draft', () => {
  const forcedDice: number[] = [];
  const draftRandom = [38, 38, 0, 5, 0];
  const lobby = createLobby(
    () => forcedDice.shift() ?? 2,
    (maximum) => {
      const value = draftRandom.shift() ?? 0;
      assert.ok(value >= 0 && value < maximum);
      return value;
    },
  );
  seatPowerups(lobby);
  let state = lobby.seat('ada')!.state;

  const ids = ['ada', 'basil'] as const;
  for (let completedTurns = 0; completedTurns < 6; completedTurns++) {
    const player = state.active!;
    forcedDice.push(1, 2);
    state = lobby.act(ids[player], { type: 'roll' })!.update.state;
    let moves = 0;
    while (state.phase === 'WAITING_FOR_MOVE') {
      const move = legalMoves(state, player, state.remaining)[0];
      assert.ok(move);
      state = lobby.act(ids[player], { type: 'move', sequence: [move] })!.update.state;
      assert.ok(++moves <= 4);
    }
    assert.equal(state.phase, 'TURN_COMPLETE');
    state = lobby.act(ids[player], { type: 'end' })!.update.state;
  }

  assert.equal(state.phase, 'DRAFT_PICK');
  assert.deepEqual(state.powerups?.draft?.stage === 'PICKING' ? state.powerups.draft.offer : null, [
    'recast',
    'nudge',
    'loadedKnuckles',
  ]);
  assert.ok(lobby.act('ada', { type: 'pickAbility', abilityId: 'recast' }));
  state = lobby.act('basil', { type: 'pickAbility', abilityId: 'loadedKnuckles' })!.update.state;
  assert.equal(state.phase, 'WAITING_FOR_ROLL');
  assert.equal(state.active, 0);

  forcedDice.push(2, 5);
  state = lobby.act('ada', { type: 'roll' })!.update.state;
  assert.equal(state.phase, 'WAITING_FOR_MOVE');
  forcedDice.push(6);
  const recast = lobby.act('ada', {
    type: 'playAbility',
    activation: { instanceId: 'ability-1', target: { type: 'DIE', index: 0 } },
  });
  assert.deepEqual(recast?.to, ['ada', 'basil']);
  assert.deepEqual(recast?.update.presentations, [
    { type: 'DICE', blocking: true, values: recast.update.state.roll, rerolledDie: 0 },
  ]);
  assert.deepEqual(recast?.update.state.remaining, [6, 5]);
  assert.deepEqual(recast?.update.state.diceModifiers[0].randomResults, [6]);

  state = recast!.update.state;
  while (state.phase === 'WAITING_FOR_MOVE') {
    const move = legalMoves(state, 0, state.remaining)[0];
    assert.ok(move);
    state = lobby.act('ada', { type: 'move', sequence: [move] })!.update.state;
  }
  assert.ok(lobby.act('ada', { type: 'end' }));
  const loaded = lobby.act('basil', { type: 'roll' });
  assert.deepEqual(loaded?.update.presentations, [
    { type: 'DICE', blocking: true, values: [2, 2] },
  ]);
  assert.deepEqual(loaded?.update.state.remaining, [2, 2, 2]);
  assert.equal(loaded?.update.state.rollSource, 'loadedKnuckles');
});

test('online authority rejects Opportunist spending until public Focus is earned', () => {
  const forcedDice: number[] = [];
  const draftRandom = [38, 38, 30, 5, 0];
  const lobby = createLobby(
    () => forcedDice.shift() ?? 2,
    (maximum) => {
      const value = draftRandom.shift() ?? 0;
      assert.ok(value >= 0 && value < maximum);
      return value;
    },
  );
  seatPowerups(lobby);
  let state = lobby.seat('ada')!.state;
  const ids = ['ada', 'basil'] as const;

  for (let completedTurns = 0; completedTurns < 6; completedTurns++) {
    const player = state.active!;
    forcedDice.push(1, 2);
    state = lobby.act(ids[player], { type: 'roll' })!.update.state;
    while (state.phase === 'WAITING_FOR_MOVE') {
      const move = legalMoves(state, player, state.remaining)[0];
      assert.ok(move);
      state = lobby.act(ids[player], { type: 'move', sequence: [move] })!.update.state;
    }
    state = lobby.act(ids[player], { type: 'end' })!.update.state;
  }

  assert.deepEqual(state.powerups?.draft?.stage === 'PICKING' ? state.powerups.draft.offer : null, [
    'recast',
    'nudge',
    'opportunist',
  ]);
  assert.ok(lobby.act('ada', { type: 'pickAbility', abilityId: 'opportunist' }));
  assert.ok(lobby.act('basil', { type: 'pickAbility', abilityId: 'nudge' }));
  forcedDice.push(2, 5);
  state = lobby.act('ada', { type: 'roll' })!.update.state;
  const before = structuredClone(state);
  const rejected = lobby.act('ada', {
    type: 'playAbility',
    activation: {
      instanceId: 'ability-1',
      target: { type: 'DIE', index: 0 },
      option: 'INCREASE',
    },
  });
  assert.deepEqual(rejected?.to, ['ada']);
  assert.deepEqual(rejected?.update.state, before);
  assert.equal(rejected?.update.state.powerups?.passiveCounters[0].opportunistFocus, undefined);
});

test('online authority validates and broadcasts Clear Skies before the roll', () => {
  const forcedDice: number[] = [];
  const draftRandom = [20, 20, 0, 5, 0];
  const lobby = createLobby(
    () => forcedDice.shift() ?? 2,
    (maximum) => {
      const value = draftRandom.shift() ?? 0;
      assert.ok(value >= 0 && value < maximum);
      return value;
    },
  );
  seatPowerups(lobby);
  let state = lobby.seat('ada')!.state;
  const ids = ['ada', 'basil'] as const;

  for (let completedTurns = 0; completedTurns < 6; completedTurns++) {
    const player = state.active!;
    forcedDice.push(1, 2);
    state = lobby.act(ids[player], { type: 'roll' })!.update.state;
    while (state.phase === 'WAITING_FOR_MOVE') {
      const move = legalMoves(state, player, state.remaining)[0];
      assert.ok(move);
      state = lobby.act(ids[player], { type: 'move', sequence: [move] })!.update.state;
    }
    state = lobby.act(ids[player], { type: 'end' })!.update.state;
  }

  assert.deepEqual(state.powerups?.draft?.stage === 'PICKING' ? state.powerups.draft.offer : null, [
    'jinx',
    'clearSkies',
    'loadedKnuckles',
  ]);
  assert.ok(lobby.act('ada', { type: 'pickAbility', abilityId: 'jinx' }));
  assert.ok(lobby.act('basil', { type: 'pickAbility', abilityId: 'clearSkies' }));
  forcedDice.push(2, 3);
  state = lobby.act('ada', { type: 'roll' })!.update.state;
  while (state.phase === 'WAITING_FOR_MOVE') {
    const move = legalMoves(state, 0, state.remaining)[0];
    assert.ok(move);
    state = lobby.act('ada', { type: 'move', sequence: [move] })!.update.state;
  }
  state = lobby.act('ada', {
    type: 'end',
    ability: { instanceId: 'ability-1', target: { type: 'PLAYER', player: 1 } },
  })!.update.state;
  assert.equal(state.phase, 'WAITING_FOR_ROLL');
  assert.equal(state.powerups?.activeEffects[0].abilityId, 'jinx');

  const rejected = lobby.act('ada', {
    type: 'playAbility',
    activation: {
      instanceId: 'ability-2',
      target: { type: 'EFFECT', instanceId: 'ability-1' },
    },
  });
  assert.deepEqual(rejected?.to, ['ada']);
  assert.equal(rejected?.update.state.powerups?.activeEffects.length, 1);

  const cleared = lobby.act('basil', {
    type: 'playAbility',
    activation: {
      instanceId: 'ability-2',
      target: { type: 'EFFECT', instanceId: 'ability-1' },
    },
  });
  assert.deepEqual(cleared?.to, ['ada', 'basil']);
  assert.deepEqual(cleared?.update.state.powerups?.activeEffects, []);
  assert.deepEqual(cleared?.update.state.powerups?.loadouts[1].powerups, []);

  forcedDice.push(5, 2);
  const rolled = lobby.act('basil', { type: 'roll' });
  assert.deepEqual(rolled?.update.state.roll, [5, 2]);
  assert.deepEqual(rolled?.update.state.remaining, [5, 2]);
  assert.deepEqual(rolled?.update.state.diceModifiers, []);
});
