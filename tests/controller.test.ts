import test from 'node:test';
import assert from 'node:assert/strict';
import { GameController } from '../src/app/game-controller';
import { Game } from '../src/game/engine';
import type { Command } from '../src/net/messages';
import { POWERUPS_V1 } from '../src/game/variant/config/profiles';
import { CLASSIC_RULES, powerupsRules } from '../src/game/variant/types';

test('local controller preserves facade state and status through a complete turn', () => {
  const controller = new GameController();
  const baseline = new Game();
  assert.deepEqual(controller.state, baseline.state);
  for (const values of [
    [6, 6],
    [1, 1],
    [2, 3],
  ]) {
    assert.equal(controller.beginRoll(), baseline.beginRoll());
    controller.receiveRoll(values);
    baseline.receiveRoll(values);
    assert.deepEqual(controller.state, baseline.state);
  }

  const first = baseline.moves()[0];
  assert.equal(controller.requestMove([first])?.type, 'local');
  assert.equal(baseline.move(first), true);
  assert.deepEqual(controller.state, baseline.state);
  controller.finishLocalMove();
  assert.equal(controller.undo(), baseline.undo());
  assert.deepEqual(controller.state, baseline.state);

  let moved = 0;
  while (baseline.state.phase === 'WAITING_FOR_MOVE') {
    const move = baseline.moves()[0];
    assert.equal(controller.requestMove([move])?.type, 'local');
    assert.equal(baseline.move(move), true);
    controller.finishLocalMove();
    assert.deepEqual(controller.state, baseline.state);
    assert.equal(controller.canUndo, baseline.history.length > 0);
    moved++;
    assert.ok(moved <= 4);
  }
  assert.equal(controller.endTurn(), baseline.endTurn());
  assert.deepEqual(controller.state, baseline.state);
  assert.equal(controller.restart(), 'local');
  baseline.reset();
  assert.deepEqual(controller.state, baseline.state);
});

test('local controller routes a move, animation completion, and undo through the game', () => {
  const controller = new GameController();
  assert.equal(controller.beginRoll(true), false);
  assert.equal(controller.beginRoll(), true);
  controller.receiveRoll([6, 6]);
  controller.beginRoll();
  controller.receiveRoll([1, 1]);
  controller.beginRoll();
  controller.receiveRoll([2, 3]);
  const before = structuredClone(controller.state);
  const move = controller.moves()[0];
  const request = controller.requestMove([move]);
  assert.equal(request?.type, 'local');
  if (request?.type !== 'local') return;
  assert.deepEqual(request.start.board, before.board);
  assert.deepEqual(request.stages.at(-1)!.board, controller.state.board);
  assert.equal(controller.state.phase, 'WAITING_FOR_MOVE');
  assert.equal(controller.busy, true);
  assert.equal(controller.undo(), false);
  controller.finishLocalMove();
  assert.equal(controller.canUndo, true);
  assert.equal(controller.undo(), true);
  assert.deepEqual(controller.state, before);
});

test('presentation locks input after the authoritative phase advances', () => {
  const controller = new GameController();
  assert.equal(controller.beginRoll(), true);
  assert.equal(controller.state.phase, 'OPENING_ROLL');
  assert.equal(controller.busy, true);
  assert.equal(controller.beginRoll(), false);
  controller.receiveRoll([6, 6]);
  controller.beginRoll();
  controller.receiveRoll([1, 1]);
  controller.beginRoll();
  controller.receiveRoll([2, 3]);
  while (controller.state.phase === 'WAITING_FOR_MOVE') {
    assert.equal(controller.requestMove([controller.moves()[0]])?.type, 'local');
    assert.equal(controller.busy, true);
    assert.equal(controller.undo(), false);
    assert.equal(controller.endTurn(), false);
    controller.finishLocalMove();
  }
  assert.equal(controller.state.phase, 'TURN_COMPLETE');
  assert.equal(controller.endTurn(), true);
});

test('a late local move completion cannot release a newer operation', () => {
  const controller = new GameController();
  const moving = structuredClone(controller.state);
  moving.opening = false;
  moving.phase = 'WAITING_FOR_MOVE';
  moving.roll = [2, 3];
  moving.remaining = [2, 3];
  controller.adopt(moving, false);
  assert.equal(controller.requestMove([controller.moves()[0]])?.type, 'local');

  const rolling = structuredClone(controller.state);
  rolling.phase = 'WAITING_FOR_ROLL';
  rolling.roll = [];
  rolling.remaining = [];
  controller.adopt(rolling, false);
  assert.equal(controller.beginRoll(), true);
  assert.equal(controller.busy, true);

  controller.finishLocalMove();
  assert.equal(controller.busy, true);
  controller.receiveRoll([2, 4]);
  assert.equal(controller.busy, false);
  assert.deepEqual(controller.state.roll, [2, 4]);
});

test('online controller waits for authority, then adopts presented dice and moves', () => {
  const controller = new GameController();
  const sent: Command[] = [];
  controller.join(0, (command) => sent.push(command));
  assert.equal(controller.beginRoll(), true);
  assert.deepEqual(sent, [{ type: 'roll' }]);
  assert.equal(controller.busy, true);
  assert.equal(controller.beginRoll(), false);
  const opening = structuredClone(controller.state);
  opening.active = 1;
  opening.phase = 'OPENING_ROLL';
  controller.queueRoll(opening, false);
  assert.equal(controller.state.active, 0);
  const presented = controller.presentedRoll();
  assert.ok(presented);
  controller.adopt(presented!.state, presented!.canUndo);
  assert.equal(controller.busy, false);
  assert.equal(controller.mine(), false);
  assert.equal(controller.beginRoll(), false);
  controller.queueRoll(opening, false);
  controller.adopt(opening, false);
  assert.equal(controller.presentedRoll(), null);

  const moving = structuredClone(opening);
  moving.active = 0;
  moving.opening = false;
  moving.phase = 'WAITING_FOR_MOVE';
  moving.remaining = [2];
  controller.adopt(moving, false);
  const sequence = [{ from: 0, to: 2, die: 2 }];
  assert.deepEqual(controller.requestMove(sequence), { type: 'sent' });
  assert.deepEqual(sent.at(-1), { type: 'move', sequence });
  assert.equal(controller.busy, true);
  const result = structuredClone(moving);
  result.board[2] = [result.board[0].pop()!];
  result.phase = 'WAITING_FOR_MOVE';
  assert.equal(controller.beginRemoteMove(sequence, result, true), 14);
  assert.equal(controller.busy, true);
  const completed = controller.finishRemoteMove();
  assert.ok(completed);
  assert.equal(controller.busy, false);
  assert.deepEqual(controller.state.board[2], []);
  controller.adopt(completed!.state, completed!.canUndo);
  assert.deepEqual(controller.state.board[2], [14]);
  assert.equal(controller.canUndo, true);
  assert.equal(controller.undo(), true);
  assert.deepEqual(sent.at(-1), { type: 'undo' });
  controller.leaveOnline();
  assert.equal(controller.scripted, false);
  assert.equal(controller.state.phase, 'OPENING_ROLL');
});

test('pickup queue keeps the next checker after a local placement and clears on undo', () => {
  const controller = new GameController();
  controller.beginRoll();
  controller.receiveRoll([6, 6]);
  controller.beginRoll();
  controller.receiveRoll([1, 1]);
  controller.beginRoll();
  controller.receiveRoll([3, 5]);
  const pickup = controller.pickup;
  assert.equal(pickup.refresh(controller.state, true, false).pickable[0], 14);
  assert.equal(controller.pickAt(0), 14);
  assert.equal(controller.pickAt(0), 13);
  assert.deepEqual(pickup.items, [14, 13]);
  const sequence = pickup.sequences(controller.state)[0];
  assert.ok(sequence);
  assert.equal(sequence.length, 1);
  assert.equal(controller.requestMove(sequence)?.type, 'local');
  assert.deepEqual(pickup.items, [13]);
  controller.finishLocalMove();
  assert.deepEqual(pickup.items, [13]);
  assert.ok(pickup.sequences(controller.state).length);
  assert.equal(controller.undo(), true);
  assert.deepEqual(pickup.items, []);
});

test('authoritative adoption revalidates or clears the held queue', () => {
  const controller = new GameController();
  const state = structuredClone(controller.state);
  state.opening = false;
  state.phase = 'WAITING_FOR_MOVE';
  state.remaining = [3, 5];
  controller.adopt(state, false);
  const pickup = controller.pickup;
  controller.pickAt(0);
  controller.pickAt(0);
  assert.deepEqual(pickup.items, [14, 13]);
  const accepted = structuredClone(state);
  accepted.board[3] = [accepted.board[0].pop()!];
  accepted.remaining = [5];
  assert.equal(controller.beginRemoteMove([{ from: 0, to: 3, die: 3 }], accepted, true), 14);
  assert.deepEqual(pickup.items, [13]);
  const completed = controller.finishRemoteMove();
  assert.ok(completed);
  controller.adopt(completed!.state, completed!.canUndo, true);
  assert.deepEqual(pickup.items, [13]);
  assert.ok(pickup.sequences(controller.state).length);
  controller.adopt({ ...accepted, remaining: [] }, true, true);
  assert.deepEqual(pickup.items, []);
  pickup.pickAt(0, { ...accepted, remaining: [5] });
  assert.deepEqual(pickup.items, [13]);
  controller.adopt(accepted, true);
  assert.deepEqual(pickup.items, []);
});

test('online draft choice locks duplicate input until authority responds', () => {
  const rules = powerupsRules(POWERUPS_V1);
  const controller = new GameController(rules);
  const sent: Command[] = [];
  controller.join(0, (command) => sent.push(command), rules);
  const state = structuredClone(controller.state);
  state.phase = 'DRAFT_PICK';
  state.powerups!.draft = {
    stage: 'PICKING',
    offer: ['frostSeal', 'bastion', 'loadedKnuckles'],
    resumePlayer: 0,
    attempts: [[6, 2]],
    pickOrder: [0, 1],
    currentPick: 0,
    picks: [],
  };
  controller.adopt(state, false);

  assert.equal(controller.pickAbility('frostSeal'), true);
  assert.deepEqual(sent, [{ type: 'pickAbility', abilityId: 'frostSeal' }]);
  assert.equal(controller.busy, true);
  assert.equal(controller.pickAbility('bastion'), false);

  const accepted = structuredClone(state);
  accepted.powerups!.draft = {
    ...state.powerups!.draft,
    offer: ['bastion', 'loadedKnuckles'],
    currentPick: 1,
    picks: [{ player: 0, abilityId: 'frostSeal' }],
  };
  controller.adopt(accepted, false);
  assert.equal(controller.busy, false);
  assert.equal(controller.mine(), false);
});

test('controller sends an atomic targeted end-turn ability', () => {
  const rules = powerupsRules(POWERUPS_V1);
  const controller = new GameController(rules);
  const sent: Command[] = [];
  controller.join(0, (command) => sent.push(command), rules);
  const state = structuredClone(controller.state);
  state.opening = false;
  state.active = 0;
  state.phase = 'TURN_COMPLETE';
  state.board[18].push(state.board[12].pop()!);
  state.powerups!.loadouts[0].powerups = [{ instanceId: 'frost-1', abilityId: 'frostSeal' }];
  controller.adopt(state, false);

  assert.deepEqual(controller.abilityTargetPoints('frost-1'), [18]);
  assert.equal(controller.selectEndTurnAbility('frost-1'), true);
  assert.equal(controller.endTurn(), false);
  assert.equal(controller.targetSelectedAbility(18), true);
  assert.equal(controller.endTurn(), true);
  assert.deepEqual(sent, [
    {
      type: 'end',
      ability: { instanceId: 'frost-1', target: { type: 'POINT', point: 18 } },
    },
  ]);
});

test('controller auto-targets the opponent for Jinx', () => {
  const rules = powerupsRules(POWERUPS_V1);
  const controller = new GameController(rules);
  const sent: Command[] = [];
  controller.join(0, (command) => sent.push(command), rules);
  const state = structuredClone(controller.state);
  state.opening = false;
  state.active = 0;
  state.phase = 'TURN_COMPLETE';
  state.powerups!.loadouts[0].powerups = [{ instanceId: 'jinx-1', abilityId: 'jinx' }];
  controller.adopt(state, false);

  assert.deepEqual(controller.abilityTargets('jinx-1'), [{ type: 'PLAYER', player: 1 }]);
  assert.equal(controller.selectEndTurnAbility('jinx-1'), true);
  assert.deepEqual(controller.selectedAbilityTarget, { type: 'PLAYER', player: 1 });
  assert.equal(controller.endTurn(), true);
  assert.deepEqual(sent, [
    {
      type: 'end',
      ability: { instanceId: 'jinx-1', target: { type: 'PLAYER', player: 1 } },
    },
  ]);
});

test('online controller sends a validated Clear Skies effect target', () => {
  const rules = powerupsRules(POWERUPS_V1);
  const controller = new GameController(rules);
  const sent: Command[] = [];
  controller.join(0, (command) => sent.push(command), rules);
  const state = structuredClone(controller.state);
  state.opening = false;
  state.active = 0;
  state.phase = 'WAITING_FOR_ROLL';
  state.powerups!.loadouts[0].powerups = [{ instanceId: 'clear-1', abilityId: 'clearSkies' }];
  state.powerups!.activeEffects = [
    {
      instanceId: 'jinx-1',
      abilityId: 'jinx',
      source: 1,
      affectedPlayer: 0,
      target: { type: 'PLAYER', player: 0 },
      tags: ['DICE_PENALTY'],
      constraints: [],
      duration: { boundary: 'NEXT_DRAFT', count: 1 },
      remaining: 1,
    },
  ];
  controller.adopt(state, false);

  const target = { type: 'EFFECT', instanceId: 'jinx-1' } as const;
  assert.deepEqual(controller.abilityTargets('clear-1'), [target]);
  assert.equal(controller.selectAbility('clear-1'), true);
  assert.equal(controller.beginRoll(), false);
  assert.deepEqual(controller.requestBeforeRollAbility(target), { type: 'sent' });
  assert.deepEqual(sent, [
    {
      type: 'playAbility',
      activation: { instanceId: 'clear-1', target },
    },
  ]);
  assert.equal(controller.busy, true);
});

test('local controller applies Clear Skies before allowing the roll', () => {
  const rules = powerupsRules(POWERUPS_V1);
  const controller = new GameController(rules);
  const state = structuredClone(controller.state);
  state.opening = false;
  state.active = 0;
  state.phase = 'WAITING_FOR_ROLL';
  state.powerups!.loadouts[0].powerups = [{ instanceId: 'clear-1', abilityId: 'clearSkies' }];
  state.powerups!.activeEffects = [
    {
      instanceId: 'frost-1',
      abilityId: 'frostSeal',
      source: 1,
      affectedPlayer: 0,
      target: { type: 'POINT', point: 18 },
      tags: ['CONTROL'],
      constraints: [{ kind: 'BLOCK_LEAVING' }, { kind: 'BLOCK_LANDING' }],
      duration: { boundary: 'TARGET_TURN_END', count: 1 },
      remaining: 1,
    },
  ];
  controller.adopt(state, false);

  assert.equal(controller.selectAbility('clear-1'), true);
  assert.deepEqual(controller.requestBeforeRollAbility({ type: 'EFFECT', instanceId: 'frost-1' }), {
    type: 'local',
  });
  assert.deepEqual(controller.state.powerups!.activeEffects, []);
  assert.deepEqual(controller.state.powerups!.loadouts[0].powerups, []);
  assert.equal(controller.beginRoll(), true);
});

test('local controller resolves Recast with injected randomness and locks its presentation', () => {
  const rules = powerupsRules(POWERUPS_V1);
  const controller = new GameController(rules, () => 5);
  const state = structuredClone(controller.state);
  state.opening = false;
  state.active = 0;
  state.phase = 'WAITING_FOR_MOVE';
  state.roll = [2, 4];
  state.remaining = [2, 4];
  state.powerups!.loadouts[0].powerups = [{ instanceId: 'recast-1', abilityId: 'recast' }];
  controller.adopt(state, false);

  assert.equal(controller.selectAbility('recast-1'), true);
  const request = controller.requestRollAbility({ target: { type: 'DIE', index: 0 } });
  assert.deepEqual(request, { type: 'local', dice: [6, 4], rerolledDie: 0 });
  assert.deepEqual(controller.state.remaining, [6, 4]);
  assert.equal(controller.busy, true);
  assert.equal(controller.requestMove([{ from: 0, to: 6, die: 6 }]), null);
  controller.receiveRoll([6, 4]);
  assert.equal(controller.busy, false);
});

test('online controller sends Nudge intent without supplying the result', () => {
  const rules = powerupsRules(POWERUPS_V1);
  const controller = new GameController(rules);
  const sent: Command[] = [];
  controller.join(0, (command) => sent.push(command), rules);
  const state = structuredClone(controller.state);
  state.opening = false;
  state.active = 0;
  state.phase = 'WAITING_FOR_MOVE';
  state.roll = [2, 5];
  state.remaining = [2, 5];
  state.powerups!.loadouts[0].powerups = [{ instanceId: 'nudge-1', abilityId: 'nudge' }];
  controller.adopt(state, false);

  assert.equal(controller.selectAbility('nudge-1'), true);
  assert.deepEqual(
    controller.requestRollAbility({ target: { type: 'DIE', index: 0 }, option: 'INCREASE' }),
    { type: 'sent' },
  );
  assert.deepEqual(sent, [
    {
      type: 'playAbility',
      activation: {
        instanceId: 'nudge-1',
        target: { type: 'DIE', index: 0 },
        option: 'INCREASE',
      },
    },
  ]);
  assert.equal(controller.busy, true);
});

test('local controller forces Loaded Knuckles rolls through its configured authority policy', () => {
  const values = [3, 0];
  const controller = new GameController(powerupsRules(POWERUPS_V1), (maximum) => {
    const value = values.shift() ?? 0;
    assert.ok(value >= 0 && value < maximum);
    return value;
  });
  const state = structuredClone(controller.state);
  state.opening = false;
  state.active = 0;
  state.phase = 'WAITING_FOR_ROLL';
  state.powerups!.loadouts[0].passives = [{ instanceId: 'loaded-1', abilityId: 'loadedKnuckles' }];
  controller.adopt(state, false);

  assert.equal(controller.beginRoll(), true);
  const forced = controller.takeForcedLocalRoll();
  assert.deepEqual(forced, [4, 4]);
  controller.receiveRoll(forced!);
  assert.deepEqual(controller.state.roll, [4, 4]);
  assert.deepEqual(controller.state.remaining, [4, 4, 4]);
});

test('local controller spends Opportunist Focus as a reusable passive action', () => {
  const rules = powerupsRules(POWERUPS_V1);
  const controller = new GameController(rules);
  const state = structuredClone(controller.state);
  state.opening = false;
  state.active = 0;
  state.phase = 'WAITING_FOR_MOVE';
  state.roll = [2, 5];
  state.remaining = [2, 5];
  state.powerups!.loadouts[0].passives = [
    { instanceId: 'opportunist-1', abilityId: 'opportunist' },
  ];
  state.powerups!.passiveCounters[0].opportunistFocus = 1;
  controller.adopt(state, false);

  assert.equal(controller.selectAbility('opportunist-1'), true);
  assert.deepEqual(
    controller.requestRollAbility({ target: { type: 'DIE', index: 0 }, option: 'INCREASE' }),
    { type: 'local' },
  );
  assert.deepEqual(controller.state.remaining, [3, 5]);
  assert.equal(controller.state.powerups!.passiveCounters[0].opportunistFocus, 0);
  assert.deepEqual(controller.state.powerups!.loadouts[0].passives, [
    { instanceId: 'opportunist-1', abilityId: 'opportunist' },
  ]);
});

test('local controller routes ordinary dice and semantic events through its authority ports', () => {
  const values = [0, 5];
  const eventTypes: string[] = [];
  const controller = new GameController(CLASSIC_RULES, (maximum) => {
    const value = values.shift() ?? 0;
    assert.ok(value >= 0 && value < maximum);
    return value;
  });
  controller.setEventSink((events) => eventTypes.push(...events.map((event) => event.type)));

  assert.equal(controller.beginRoll(), true);
  assert.deepEqual(controller.takeForcedLocalRoll(), [1, 6]);
  controller.receiveRoll([1, 6]);

  assert.deepEqual(eventTypes, ['RollStarted', 'OpeningRollPassed']);
});
