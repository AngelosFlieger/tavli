import test from 'node:test';
import assert from 'node:assert/strict';
import { initialGameState, type Session } from '../src/game/session/state';
import { transitionSession } from '../src/game/session/transition';
import { sampleDraftOffer, validateDraftOffer } from '../src/game/variant/draft';
import { advancePendingDraft } from '../src/game/variant/authority';
import { resolveVariantConfig } from '../src/game/variant/config/schema';
import { POWERUPS_V1 } from '../src/game/variant/config/profiles';
import { createPowerupsV1Input } from '../src/game/variant/config/profiles/v1';
import { powerupsRules, type ActiveEffect } from '../src/game/variant/types';
import { moveAllowedByActiveEffects } from '../src/game/variant/move-policy';
import {
  generateMovementRoll,
  opportunistFocus,
  powerupCapacity,
  quartermasterCooldown,
  rebuildPassivePolicies,
} from '../src/game/variant/passives/policy';

function completeTurns(count: number): { session: Session; lastEvents: string[] } {
  const rules = powerupsRules(POWERUPS_V1);
  const state = initialGameState(rules);
  state.opening = { status: 'RESOLVED', attempts: [[6, 1]], winner: 0 };
  state.active = 0;
  state.phase = 'TURN_COMPLETE';
  let session: Session = { state, history: [] };
  let lastEvents: string[] = [];
  for (let turn = 0; turn < count; turn++) {
    const result = transitionSession(session, { type: 'endTurn' }, rules);
    assert.equal(result.ok, true);
    if (!result.ok) break;
    session = result.session;
    lastEvents = result.events.map((event) => event.type);
    if (turn + 1 < count) session.state.phase = 'TURN_COMPLETE';
  }
  return { session, lastEvents };
}

test('a configured draft becomes due after both players complete three rounds', () => {
  const afterFive = completeTurns(5);
  assert.equal(afterFive.session.state.powerups?.completedRounds, 2);
  assert.equal(afterFive.session.state.phase, 'WAITING_FOR_ROLL');
  const afterSix = completeTurns(6);
  assert.equal(afterSix.session.state.powerups?.completedRounds, 3);
  assert.equal(afterSix.session.state.phase, 'DRAFT_ORDER');
  assert.deepEqual(afterSix.session.state.powerups?.draft, {
    stage: 'AWAITING_OFFER',
    resumePlayer: 0,
  });
  assert.deepEqual(afterSix.lastEvents, ['TurnEnded', 'RoundCompleted', 'DraftDue']);
});

test('draft offers and tie rolls resolve into an enforced two-player pick order', () => {
  const rules = powerupsRules(POWERUPS_V1);
  let session = completeTurns(6).session;
  const before = structuredClone(session);
  const offer = ['frostSeal', 'bastion', 'loadedKnuckles'] as const;
  const opened = transitionSession(session, { type: 'openDraft', offer: [...offer] }, rules);
  assert.equal(opened.ok, true);
  if (!opened.ok) return;
  assert.deepEqual(session, before);
  session = opened.session;
  const tied = transitionSession(session, { type: 'resolveDraftOrder', rolls: [4, 4] }, rules);
  assert.equal(tied.ok, true);
  if (!tied.ok) return;
  assert.equal(tied.session.state.phase, 'DRAFT_ORDER');
  assert.equal(tied.session.state.powerups?.draft?.stage, 'ORDER_ROLL');
  const ordered = transitionSession(
    tied.session,
    { type: 'resolveDraftOrder', rolls: [2, 6] },
    rules,
  );
  assert.equal(ordered.ok, true);
  if (!ordered.ok) return;
  assert.equal(ordered.session.state.phase, 'DRAFT_PICK');
  assert.deepEqual(
    ordered.session.state.powerups?.draft?.stage === 'PICKING'
      ? ordered.session.state.powerups.draft.pickOrder
      : null,
    [1, 0],
  );
  assert.deepEqual(
    ordered.session.state.powerups?.draft?.stage === 'PICKING'
      ? ordered.session.state.powerups.draft.attempts
      : null,
    [
      [4, 4],
      [2, 6],
    ],
  );
  assert.deepEqual(
    transitionSession(
      ordered.session,
      { type: 'pickAbility', player: 0, abilityId: 'frostSeal' },
      rules,
    ),
    { ok: false, reason: 'invalid_pick' },
  );
  const first = transitionSession(
    ordered.session,
    { type: 'pickAbility', player: 1, abilityId: 'loadedKnuckles' },
    rules,
  );
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.deepEqual(first.session.state.powerups?.loadouts[1].passives, [
    { instanceId: 'ability-1', abilityId: 'loadedKnuckles' },
  ]);
  const second = transitionSession(
    first.session,
    { type: 'pickAbility', player: 0, abilityId: 'frostSeal' },
    rules,
  );
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.session.state.phase, 'WAITING_FOR_ROLL');
  assert.equal(second.session.state.active, 0);
  assert.equal(second.session.state.powerups?.draft, null);
  assert.deepEqual(second.session.state.powerups?.loadouts[0].powerups, [
    { instanceId: 'ability-2', abilityId: 'frostSeal' },
  ]);
});

test('full configured inventory requires a same-kind replacement', () => {
  const input = createPowerupsV1Input();
  input.id = 'one-slot-test';
  input.inventory.powerupSlots = 1;
  const config = resolveVariantConfig(input);
  const rules = powerupsRules(config);
  const state = initialGameState(rules);
  state.phase = 'DRAFT_PICK';
  state.active = 0;
  state.powerups!.loadouts[0].powerups = [
    { instanceId: 'ability-existing', abilityId: 'frostSeal' },
  ];
  state.powerups!.draft = {
    stage: 'PICKING',
    offer: ['bastion', 'loadedKnuckles'],
    resumePlayer: 0,
    attempts: [[6, 2]],
    pickOrder: [0],
    currentPick: 0,
    picks: [],
  };
  const session = { state, history: [] };
  assert.deepEqual(
    transitionSession(session, { type: 'pickAbility', player: 0, abilityId: 'bastion' }, rules),
    { ok: false, reason: 'invalid_pick' },
  );
  const picked = transitionSession(
    session,
    {
      type: 'pickAbility',
      player: 0,
      abilityId: 'bastion',
      replaceInstanceId: 'ability-existing',
    },
    rules,
  );
  assert.equal(picked.ok, true);
  if (!picked.ok) return;
  assert.deepEqual(picked.session.state.powerups?.loadouts[0].powerups, [
    { instanceId: 'ability-1', abilityId: 'bastion' },
  ]);
  assert.ok(picked.events.some((event) => event.type === 'AbilityReplaced'));
});

test('weighted offer sampling is deterministic with an injected random source', () => {
  const state = initialGameState(powerupsRules(POWERUPS_V1));
  const offer = sampleDraftOffer(state.powerups!, POWERUPS_V1, () => 0);
  assert.deepEqual(offer, ['frostSeal', 'bastion', 'loadedKnuckles']);
  assert.equal(validateDraftOffer(state.powerups!, offer, POWERUPS_V1), true);
  assert.throws(
    () => sampleDraftOffer(state.powerups!, POWERUPS_V1, (maximum) => maximum),
    /out-of-range/,
  );
});

test('authority opens an offer and rerolls ties until player input is needed', () => {
  const rules = powerupsRules(POWERUPS_V1);
  const session = completeTurns(6).session;
  const values = [0, 0, 0, 3, 3, 1, 5];
  let index = 0;
  const advanced = advancePendingDraft(session, rules, (maximum) => {
    const value = values[index++] ?? 0;
    assert.ok(value < maximum);
    return value;
  });
  assert.equal(advanced.session.state.phase, 'DRAFT_PICK');
  assert.deepEqual(advanced.orderRolls, [
    [4, 4],
    [2, 6],
  ]);
  const draft = advanced.session.state.powerups?.draft;
  assert.equal(draft?.stage, 'PICKING');
  if (draft?.stage !== 'PICKING') return;
  assert.deepEqual(draft.offer, ['frostSeal', 'bastion', 'loadedKnuckles']);
  assert.deepEqual(draft.pickOrder, [1, 0]);
  assert.deepEqual(draft.attempts, [
    [4, 4],
    [2, 6],
  ]);
});

test('invalid draft composition and order dice do not mutate the session', () => {
  const rules = powerupsRules(POWERUPS_V1);
  const session = completeTurns(6).session;
  const before = structuredClone(session);
  assert.deepEqual(
    transitionSession(
      session,
      { type: 'openDraft', offer: ['frostSeal', 'bastion', 'jinx'] },
      rules,
    ),
    { ok: false, reason: 'invalid_draft' },
  );
  const opened = transitionSession(
    session,
    { type: 'openDraft', offer: ['frostSeal', 'bastion', 'loadedKnuckles'] },
    rules,
  );
  assert.equal(opened.ok, true);
  if (!opened.ok) return;
  assert.deepEqual(
    transitionSession(opened.session, { type: 'resolveDraftOrder', rolls: [0, 7] }, rules),
    { ok: false, reason: 'invalid_roll' },
  );
  assert.deepEqual(session, before);
});

test('Frost Seal is consumed atomically, blocks its point, and expires at target turn end', () => {
  const rules = powerupsRules(POWERUPS_V1);
  const state = initialGameState(rules);
  state.opening = { status: 'RESOLVED', attempts: [[6, 1]], winner: 0 };
  state.active = 0;
  state.phase = 'TURN_COMPLETE';
  state.board[18].push(state.board[12].pop()!);
  state.powerups!.loadouts[0].powerups = [{ instanceId: 'frost-1', abilityId: 'frostSeal' }];
  const input: Session = { state, history: [] };
  const used = transitionSession(
    input,
    {
      type: 'endTurn',
      ability: { instanceId: 'frost-1', target: { type: 'POINT', point: 18 } },
    },
    rules,
  );
  assert.equal(used.ok, true);
  if (!used.ok) return;
  assert.deepEqual(input.state.powerups!.loadouts[0].powerups, [
    { instanceId: 'frost-1', abilityId: 'frostSeal' },
  ]);
  assert.deepEqual(used.session.state.powerups!.loadouts[0].powerups, []);
  assert.equal(used.session.state.powerups!.activeEffects[0].remaining, 1);
  assert.equal(
    moveAllowedByActiveEffects(used.session.state, 1, { from: 18, to: 19, die: 1 }),
    false,
  );
  assert.equal(
    moveAllowedByActiveEffects(used.session.state, 1, { from: 17, to: 18, die: 1 }),
    false,
  );

  used.session.state.phase = 'WAITING_FOR_MOVE';
  used.session.state.remaining = [1];
  assert.deepEqual(
    transitionSession(
      used.session,
      { type: 'move', sequence: [{ from: 18, to: 19, die: 1 }] },
      rules,
    ),
    { ok: false, reason: 'illegal_move' },
  );
  used.session.state.phase = 'TURN_COMPLETE';
  const expired = transitionSession(used.session, { type: 'endTurn' }, rules);
  assert.equal(expired.ok, true);
  if (!expired.ok) return;
  assert.deepEqual(expired.session.state.powerups!.activeEffects, []);
  assert.ok(expired.events.some((event) => event.type === 'EffectExpired'));
});

test('Frost Seal and Bastion reject excluded targets without consuming their cards', () => {
  const rules = powerupsRules(POWERUPS_V1);
  const state = initialGameState(rules);
  state.opening = { status: 'RESOLVED', attempts: [[6, 1]], winner: 0 };
  state.active = 0;
  state.phase = 'TURN_COMPLETE';
  state.powerups!.loadouts[0].powerups = [
    { instanceId: 'frost-1', abilityId: 'frostSeal' },
    { instanceId: 'bastion-1', abilityId: 'bastion' },
  ];
  const session: Session = { state, history: [] };
  const before = structuredClone(session);
  assert.deepEqual(
    transitionSession(
      session,
      {
        type: 'endTurn',
        ability: { instanceId: 'frost-1', target: { type: 'POINT', point: 12 } },
      },
      rules,
    ),
    { ok: false, reason: 'invalid_ability' },
  );
  assert.deepEqual(session, before);

  state.board[6].push(state.board[0].pop()!);
  const protectedTurn = transitionSession(
    session,
    {
      type: 'endTurn',
      ability: { instanceId: 'bastion-1', target: { type: 'POINT', point: 6 } },
    },
    rules,
  );
  assert.equal(protectedTurn.ok, true);
  if (!protectedTurn.ok) return;
  assert.equal(
    moveAllowedByActiveEffects(protectedTurn.session.state, 1, {
      from: 7,
      to: 6,
      die: 1,
    }),
    false,
  );
  assert.equal(
    moveAllowedByActiveEffects(protectedTurn.session.state, 0, {
      from: 6,
      to: 7,
      die: 1,
    }),
    true,
  );
});

test('configured effect duration counts target turns rather than global turns', () => {
  const input = createPowerupsV1Input();
  input.id = 'two-turn-frost';
  input.abilities.frostSeal.duration.count = 2;
  const config = resolveVariantConfig(input);
  const rules = powerupsRules(config);
  const state = initialGameState(rules);
  state.opening = { status: 'RESOLVED', attempts: [[6, 1]], winner: 0 };
  state.active = 0;
  state.phase = 'TURN_COMPLETE';
  state.board[18].push(state.board[12].pop()!);
  state.powerups!.loadouts[0].powerups = [{ instanceId: 'frost-1', abilityId: 'frostSeal' }];
  let result = transitionSession(
    { state, history: [] },
    {
      type: 'endTurn',
      ability: { instanceId: 'frost-1', target: { type: 'POINT', point: 18 } },
    },
    rules,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.session.state.powerups!.activeEffects[0].remaining, 2);

  for (const expected of [1, 1, 0]) {
    result.session.state.phase = 'TURN_COMPLETE';
    result = transitionSession(result.session, { type: 'endTurn' }, rules);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.session.state.powerups!.activeEffects[0]?.remaining ?? 0, expected);
  }
});

test('Jinx targets the opponent and modifies only the next effective movement token', () => {
  const rules = powerupsRules(POWERUPS_V1);
  const state = initialGameState(rules);
  state.opening = { status: 'RESOLVED', attempts: [[6, 1]], winner: 0 };
  state.active = 0;
  state.phase = 'TURN_COMPLETE';
  state.powerups!.loadouts[0].powerups = [{ instanceId: 'jinx-1', abilityId: 'jinx' }];

  assert.deepEqual(
    transitionSession(
      { state, history: [] },
      {
        type: 'endTurn',
        ability: { instanceId: 'jinx-1', target: { type: 'PLAYER', player: 0 } },
      },
      rules,
    ),
    { ok: false, reason: 'invalid_ability' },
  );

  const cast = transitionSession(
    { state, history: [] },
    {
      type: 'endTurn',
      ability: { instanceId: 'jinx-1', target: { type: 'PLAYER', player: 1 } },
    },
    rules,
  );
  assert.equal(cast.ok, true);
  if (!cast.ok) return;
  assert.deepEqual(cast.session.state.powerups!.loadouts[0].powerups, []);
  assert.deepEqual(
    cast.session.state.powerups!.activeEffects[0].constraints.find(
      (constraint) => constraint.kind === 'DICE_PENALTY',
    ),
    {
      kind: 'DICE_PENALTY',
      penalty: 1,
      minimumToken: 1,
      targetToken: 'HIGHEST',
      affectDoubles: false,
      unaffectedDoubleConsumes: true,
      doubleHandling: 'CHANGE_ONE_TOKEN',
    },
  );

  const rolled = transitionSession(cast.session, { type: 'receiveRoll', values: [2, 5] }, rules);
  assert.equal(rolled.ok, true);
  if (!rolled.ok) return;
  assert.deepEqual(rolled.session.state.roll, [2, 5]);
  assert.deepEqual(rolled.session.state.remaining, [2, 4]);
  assert.deepEqual(rolled.session.state.diceModifiers, [
    {
      instanceId: 'jinx-1',
      abilityId: 'jinx',
      source: 0,
      dieIndex: 1,
      before: 5,
      after: 4,
      randomResults: [],
      allowBearingOff: true,
    },
  ]);
  assert.deepEqual(rolled.session.state.powerups!.activeEffects, []);
  assert.ok(rolled.events.some((event) => event.type === 'DiceModified'));
});

test('the default Jinx is consumed without modifying an actual double', () => {
  const rules = powerupsRules(POWERUPS_V1);
  const state = initialGameState(rules);
  state.opening = { status: 'RESOLVED', attempts: [[6, 1]], winner: 0 };
  state.active = 0;
  state.phase = 'TURN_COMPLETE';
  state.powerups!.loadouts[0].powerups = [{ instanceId: 'jinx-1', abilityId: 'jinx' }];
  const cast = transitionSession(
    { state, history: [] },
    {
      type: 'endTurn',
      ability: { instanceId: 'jinx-1', target: { type: 'PLAYER', player: 1 } },
    },
    rules,
  );
  assert.equal(cast.ok, true);
  if (!cast.ok) return;
  const rolled = transitionSession(cast.session, { type: 'receiveRoll', values: [3, 3] }, rules);
  assert.equal(rolled.ok, true);
  if (!rolled.ok) return;
  assert.deepEqual(rolled.session.state.roll, [3, 3]);
  assert.deepEqual(rolled.session.state.remaining, [3, 3, 3, 3]);
  assert.deepEqual(rolled.session.state.diceModifiers, []);
  assert.deepEqual(rolled.session.state.powerups!.activeEffects, []);
});

test('Jinx double consumption and token handling follow the resolved profile', () => {
  const persistentInput = createPowerupsV1Input();
  persistentInput.id = 'persistent-jinx';
  persistentInput.abilities.jinx.unaffectedDoubleConsumes = false;
  const persistentRules = powerupsRules(resolveVariantConfig(persistentInput));
  const persistentState = initialGameState(persistentRules);
  persistentState.opening = { status: 'RESOLVED', attempts: [[6, 1]], winner: 0 };
  persistentState.active = 0;
  persistentState.phase = 'TURN_COMPLETE';
  persistentState.powerups!.loadouts[0].powerups = [{ instanceId: 'jinx-1', abilityId: 'jinx' }];
  const cast = transitionSession(
    { state: persistentState, history: [] },
    {
      type: 'endTurn',
      ability: { instanceId: 'jinx-1', target: { type: 'PLAYER', player: 1 } },
    },
    persistentRules,
  );
  assert.equal(cast.ok, true);
  if (!cast.ok) return;
  const ignored = transitionSession(
    cast.session,
    { type: 'receiveRoll', values: [4, 4] },
    persistentRules,
  );
  assert.equal(ignored.ok, true);
  if (!ignored.ok) return;
  assert.deepEqual(ignored.session.state.remaining, [4, 4, 4, 4]);
  assert.equal(ignored.session.state.powerups!.activeEffects.length, 1);
  assert.deepEqual(ignored.session.state.diceModifiers, []);

  ignored.session.state.phase = 'WAITING_FOR_ROLL';
  const later = transitionSession(
    ignored.session,
    { type: 'receiveRoll', values: [6, 2] },
    persistentRules,
  );
  assert.equal(later.ok, true);
  if (!later.ok) return;
  assert.deepEqual(later.session.state.remaining, [5, 2]);
  assert.deepEqual(later.session.state.powerups!.activeEffects, []);

  const matchingInput = createPowerupsV1Input();
  matchingInput.id = 'matching-double-jinx';
  matchingInput.abilities.jinx.penalty = 2;
  matchingInput.abilities.jinx.affectDoubles = true;
  matchingInput.abilities.jinx.doubleHandling = 'CHANGE_MATCHING_TOKENS';
  const matchingRules = powerupsRules(resolveVariantConfig(matchingInput));
  const matchingState = initialGameState(matchingRules);
  matchingState.opening = { status: 'RESOLVED', attempts: [[6, 1]], winner: 0 };
  matchingState.active = 0;
  matchingState.phase = 'TURN_COMPLETE';
  matchingState.powerups!.loadouts[0].powerups = [{ instanceId: 'jinx-2', abilityId: 'jinx' }];
  const matchingCast = transitionSession(
    { state: matchingState, history: [] },
    {
      type: 'endTurn',
      ability: { instanceId: 'jinx-2', target: { type: 'PLAYER', player: 1 } },
    },
    matchingRules,
  );
  assert.equal(matchingCast.ok, true);
  if (!matchingCast.ok) return;
  const matchingRoll = transitionSession(
    matchingCast.session,
    { type: 'receiveRoll', values: [4, 4] },
    matchingRules,
  );
  assert.equal(matchingRoll.ok, true);
  if (!matchingRoll.ok) return;
  assert.deepEqual(matchingRoll.session.state.roll, [4, 4]);
  assert.deepEqual(matchingRoll.session.state.remaining, [2, 2, 2, 2]);
});

test('an unused Jinx expires at its configured next-draft boundary', () => {
  const rules = powerupsRules(POWERUPS_V1);
  const state = initialGameState(rules);
  state.opening = { status: 'RESOLVED', attempts: [[6, 1]], winner: 0 };
  state.active = 0;
  state.phase = 'TURN_COMPLETE';
  state.powerups!.loadouts[0].powerups = [{ instanceId: 'jinx-1', abilityId: 'jinx' }];
  const cast = transitionSession(
    { state, history: [] },
    {
      type: 'endTurn',
      ability: { instanceId: 'jinx-1', target: { type: 'PLAYER', player: 1 } },
    },
    rules,
  );
  assert.equal(cast.ok, true);
  if (!cast.ok) return;
  cast.session.state.powerups!.completedRounds = 2;
  cast.session.state.powerups!.actedThisRound = [true, false];
  cast.session.state.phase = 'TURN_COMPLETE';

  const draft = transitionSession(cast.session, { type: 'endTurn' }, rules);
  assert.equal(draft.ok, true);
  if (!draft.ok) return;
  assert.equal(draft.session.state.phase, 'DRAFT_ORDER');
  assert.deepEqual(draft.session.state.powerups!.activeEffects, []);
  assert.ok(
    draft.events.some((event) => event.type === 'EffectExpired' && event.abilityId === 'jinx'),
  );
});

test('Clear Skies removes a selected hostile effect before rolling', () => {
  const rules = powerupsRules(POWERUPS_V1);
  const state = initialGameState(rules);
  state.opening = { status: 'RESOLVED', attempts: [[6, 1]], winner: 0 };
  state.active = 1;
  state.phase = 'TURN_COMPLETE';
  state.powerups!.loadouts[1].powerups = [{ instanceId: 'jinx-1', abilityId: 'jinx' }];
  state.powerups!.loadouts[0].powerups = [{ instanceId: 'clear-1', abilityId: 'clearSkies' }];
  const jinx = transitionSession(
    { state, history: [] },
    {
      type: 'endTurn',
      ability: { instanceId: 'jinx-1', target: { type: 'PLAYER', player: 0 } },
    },
    rules,
  );
  assert.equal(jinx.ok, true);
  if (!jinx.ok) return;
  const before = structuredClone(jinx.session);
  assert.deepEqual(
    transitionSession(
      jinx.session,
      {
        type: 'useBeforeRollAbility',
        player: 0,
        activation: {
          instanceId: 'clear-1',
          target: { type: 'EFFECT', instanceId: 'missing' },
        },
      },
      rules,
    ),
    { ok: false, reason: 'invalid_ability' },
  );
  assert.deepEqual(jinx.session, before);

  const cleared = transitionSession(
    jinx.session,
    {
      type: 'useBeforeRollAbility',
      player: 0,
      activation: {
        instanceId: 'clear-1',
        target: { type: 'EFFECT', instanceId: 'jinx-1' },
      },
    },
    rules,
  );
  assert.equal(cleared.ok, true);
  if (!cleared.ok) return;
  assert.deepEqual(cleared.session.state.powerups!.activeEffects, []);
  assert.deepEqual(cleared.session.state.powerups!.loadouts[0].powerups, []);
  assert.equal(cleared.session.state.powerups!.powerupsUsedThisTurn, 1);
  assert.deepEqual(cleared.events.at(-1), {
    type: 'EffectsRemoved',
    abilityId: 'clearSkies',
    removed: [{ instanceId: 'jinx-1', abilityId: 'jinx' }],
  });
  const rolled = transitionSession(cleared.session, { type: 'receiveRoll', values: [6, 2] }, rules);
  assert.equal(rolled.ok, true);
  if (!rolled.ok) return;
  assert.deepEqual(rolled.session.state.remaining, [6, 2]);
  assert.deepEqual(rolled.session.state.diceModifiers, []);
});

test('Clear Skies respects configured tags, removal count, and positive-effect targeting', () => {
  const input = createPowerupsV1Input();
  input.id = 'multi-clear-skies';
  input.abilities.clearSkies.maxEffects = 3;
  input.abilities.clearSkies.removableTags = ['CONTROL', 'DICE_PENALTY', 'PROTECTION'];
  const config = resolveVariantConfig(input);
  const rules = powerupsRules(config);
  const effects: ActiveEffect[] = [
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
    {
      instanceId: 'frost-1',
      abilityId: 'frostSeal',
      source: 1,
      affectedPlayer: 0,
      target: { type: 'POINT', point: 0 },
      tags: ['CONTROL'],
      constraints: [{ kind: 'BLOCK_LEAVING' }, { kind: 'BLOCK_LANDING' }],
      duration: { boundary: 'TARGET_TURN_END', count: 1 },
      remaining: 1,
    },
    {
      instanceId: 'bastion-1',
      abilityId: 'bastion',
      source: 1,
      affectedPlayer: 0,
      target: { type: 'POINT', point: 18 },
      tags: ['PROTECTION'],
      constraints: [{ kind: 'BLOCK_LANDING' }],
      duration: { boundary: 'TARGET_TURN_END', count: 1 },
      remaining: 1,
    },
  ];
  const state = initialGameState(rules);
  state.opening = { status: 'RESOLVED', attempts: [[6, 1]], winner: 0 };
  state.active = 0;
  state.phase = 'WAITING_FOR_ROLL';
  state.powerups!.loadouts[0].powerups = [{ instanceId: 'clear-1', abilityId: 'clearSkies' }];
  state.powerups!.activeEffects = structuredClone(effects);

  const cleared = transitionSession(
    { state, history: [] },
    {
      type: 'useBeforeRollAbility',
      player: 0,
      activation: {
        instanceId: 'clear-1',
        target: { type: 'EFFECT', instanceId: 'frost-1' },
      },
    },
    rules,
  );
  assert.equal(cleared.ok, true);
  if (!cleared.ok) return;
  assert.deepEqual(
    cleared.session.state.powerups!.activeEffects.map((effect) => effect.instanceId),
    ['bastion-1'],
  );
  assert.deepEqual(cleared.events.at(-1), {
    type: 'EffectsRemoved',
    abilityId: 'clearSkies',
    removed: [
      { instanceId: 'frost-1', abilityId: 'frostSeal' },
      { instanceId: 'jinx-1', abilityId: 'jinx' },
    ],
  });

  const positiveInput = createPowerupsV1Input();
  positiveInput.id = 'positive-clear-skies';
  positiveInput.abilities.clearSkies.removableTags = ['PROTECTION'];
  positiveInput.abilities.clearSkies.canTargetOpponentPositive = true;
  const positiveRules = powerupsRules(resolveVariantConfig(positiveInput));
  const positiveState = initialGameState(positiveRules);
  positiveState.opening = { status: 'RESOLVED', attempts: [[6, 1]], winner: 0 };
  positiveState.active = 0;
  positiveState.phase = 'WAITING_FOR_ROLL';
  positiveState.powerups!.loadouts[0].powerups = [
    { instanceId: 'clear-2', abilityId: 'clearSkies' },
  ];
  positiveState.powerups!.activeEffects = [structuredClone(effects[2])];
  const positive = transitionSession(
    { state: positiveState, history: [] },
    {
      type: 'useBeforeRollAbility',
      player: 0,
      activation: {
        instanceId: 'clear-2',
        target: { type: 'EFFECT', instanceId: 'bastion-1' },
      },
    },
    positiveRules,
  );
  assert.equal(positive.ok, true);
  if (positive.ok) assert.deepEqual(positive.session.state.powerups!.activeEffects, []);
});

test('Recast records authority randomness and preserves original-double token count', () => {
  const rules = powerupsRules(POWERUPS_V1);
  const state = initialGameState(rules);
  state.opening = { status: 'RESOLVED', attempts: [[6, 1]], winner: 0 };
  state.active = 0;
  state.phase = 'WAITING_FOR_MOVE';
  state.roll = [3, 3];
  state.remaining = [3, 3, 3, 3];
  state.powerups!.loadouts[0].powerups = [{ instanceId: 'recast-1', abilityId: 'recast' }];
  const session: Session = { state, history: [] };
  const before = structuredClone(session);
  const result = transitionSession(
    session,
    {
      type: 'useRollAbility',
      player: 0,
      activation: { instanceId: 'recast-1', target: { type: 'DIE', index: 0 } },
      randomValues: [5],
    },
    rules,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(session, before);
  assert.deepEqual(result.session.state.roll, [5, 3]);
  assert.deepEqual(result.session.state.remaining.slice().sort(), [3, 3, 3, 5]);
  assert.deepEqual(result.session.state.powerups!.loadouts[0].powerups, []);
  assert.deepEqual(result.session.state.diceModifiers, [
    {
      instanceId: 'recast-1',
      abilityId: 'recast',
      source: 0,
      dieIndex: 0,
      before: 3,
      after: 5,
      randomResults: [5],
      allowBearingOff: true,
    },
  ]);
});

test('Nudge changes movement tokens without changing the physical roll', () => {
  const rules = powerupsRules(POWERUPS_V1);
  const state = initialGameState(rules);
  state.opening = { status: 'RESOLVED', attempts: [[6, 1]], winner: 0 };
  state.active = 0;
  state.phase = 'WAITING_FOR_MOVE';
  state.roll = [4, 5];
  state.remaining = [4, 5];
  state.powerups!.loadouts[0].powerups = [{ instanceId: 'nudge-1', abilityId: 'nudge' }];
  const result = transitionSession(
    { state, history: [] },
    {
      type: 'useRollAbility',
      player: 0,
      activation: {
        instanceId: 'nudge-1',
        target: { type: 'DIE', index: 0 },
        option: 'INCREASE',
      },
      randomValues: [],
    },
    rules,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.session.state.roll, [4, 5]);
  assert.deepEqual(result.session.state.remaining, [5, 5]);
  assert.equal(result.session.state.remaining.length, 2);
  assert.equal(result.session.state.diceModifiers[0].after, 5);
});

test('roll abilities reject stale, late, and authority-invalid activation data', () => {
  const rules = powerupsRules(POWERUPS_V1);
  const state = initialGameState(rules);
  state.opening = { status: 'RESOLVED', attempts: [[6, 1]], winner: 0 };
  state.active = 0;
  state.phase = 'WAITING_FOR_MOVE';
  state.roll = [2, 5];
  state.remaining = [2, 5];
  state.powerups!.loadouts[0].powerups = [{ instanceId: 'recast-1', abilityId: 'recast' }];
  const session: Session = { state, history: [] };
  const before = structuredClone(session);
  for (const command of [
    {
      type: 'useRollAbility' as const,
      player: 1 as const,
      activation: { instanceId: 'recast-1', target: { type: 'DIE' as const, index: 0 as const } },
      randomValues: [6],
    },
    {
      type: 'useRollAbility' as const,
      player: 0 as const,
      activation: { instanceId: 'missing', target: { type: 'DIE' as const, index: 0 as const } },
      randomValues: [6],
    },
    {
      type: 'useRollAbility' as const,
      player: 0 as const,
      activation: { instanceId: 'recast-1', target: { type: 'DIE' as const, index: 0 as const } },
      randomValues: [7],
    },
  ])
    assert.deepEqual(transitionSession(session, command, rules), {
      ok: false,
      reason: 'invalid_ability',
    });
  state.powerups!.checkerMovedThisTurn = true;
  assert.deepEqual(
    transitionSession(
      session,
      {
        type: 'useRollAbility',
        player: 0,
        activation: { instanceId: 'recast-1', target: { type: 'DIE', index: 0 } },
        randomValues: [6],
      },
      rules,
    ),
    { ok: false, reason: 'invalid_ability' },
  );
  state.powerups!.checkerMovedThisTurn = false;
  assert.deepEqual(session, before);
});

test('non-default dice knobs control reroll count, double creation, and bearing off', () => {
  const input = createPowerupsV1Input();
  input.id = 'configured-dice-powers';
  input.abilities.recast.rerollCount = 2;
  input.abilities.recast.originalDoubleHandling = 'CHANGE_MATCHING_TOKENS';
  input.abilities.nudge.createdMatchBecomesDouble = true;
  input.abilities.nudge.allowBearingOff = false;
  const config = resolveVariantConfig(input);
  const rules = powerupsRules(config);

  const recastState = initialGameState(rules);
  recastState.opening = { status: 'RESOLVED', attempts: [[6, 1]], winner: 0 };
  recastState.active = 0;
  recastState.phase = 'WAITING_FOR_MOVE';
  recastState.roll = [2, 2];
  recastState.remaining = [2, 2, 2, 2];
  recastState.powerups!.loadouts[0].powerups = [{ instanceId: 'recast-1', abilityId: 'recast' }];
  const recast = transitionSession(
    { state: recastState, history: [] },
    {
      type: 'useRollAbility',
      player: 0,
      activation: { instanceId: 'recast-1', target: { type: 'DIE', index: 1 } },
      randomValues: [3, 6],
    },
    rules,
  );
  assert.equal(recast.ok, true);
  if (!recast.ok) return;
  assert.deepEqual(recast.session.state.roll, [2, 6]);
  assert.deepEqual(recast.session.state.remaining, [6, 6, 6, 6]);
  assert.deepEqual(recast.session.state.diceModifiers[0].randomResults, [3, 6]);

  const nudgeState = initialGameState(rules);
  nudgeState.opening = { status: 'RESOLVED', attempts: [[6, 1]], winner: 0 };
  nudgeState.active = 0;
  nudgeState.phase = 'WAITING_FOR_MOVE';
  nudgeState.roll = [2, 3];
  nudgeState.remaining = [2, 3];
  nudgeState.powerups!.loadouts[0].powerups = [{ instanceId: 'nudge-1', abilityId: 'nudge' }];
  const nudge = transitionSession(
    { state: nudgeState, history: [] },
    {
      type: 'useRollAbility',
      player: 0,
      activation: {
        instanceId: 'nudge-1',
        target: { type: 'DIE', index: 0 },
        option: 'INCREASE',
      },
      randomValues: [],
    },
    rules,
  );
  assert.equal(nudge.ok, true);
  if (!nudge.ok) return;
  assert.deepEqual(nudge.session.state.remaining, [3, 3, 3, 3]);

  const restrictedState = initialGameState(rules);
  restrictedState.opening = { status: 'RESOLVED', attempts: [[6, 1]], winner: 0 };
  restrictedState.active = 0;
  restrictedState.phase = 'WAITING_FOR_MOVE';
  restrictedState.roll = [2, 5];
  restrictedState.remaining = [2, 5];
  restrictedState.powerups!.loadouts[0].powerups = [{ instanceId: 'nudge-2', abilityId: 'nudge' }];
  const restricted = transitionSession(
    { state: restrictedState, history: [] },
    {
      type: 'useRollAbility',
      player: 0,
      activation: {
        instanceId: 'nudge-2',
        target: { type: 'DIE', index: 0 },
        option: 'INCREASE',
      },
      randomValues: [],
    },
    rules,
  );
  assert.equal(restricted.ok, true);
  if (!restricted.ok) return;
  assert.equal(
    moveAllowedByActiveEffects(restricted.session.state, 0, { from: 12, to: -1, die: 3 }),
    false,
  );
});

test('Loaded Knuckles uses its exact configured chance and double token drawback', () => {
  const input = createPowerupsV1Input();
  input.id = 'loaded-knuckles-test';
  input.abilities.loadedKnuckles.matchChance = { numerator: 2, denominator: 5 };
  input.abilities.loadedKnuckles.doubleMoveTokens = 2;
  input.abilities.nudge.createdMatchBecomesDouble = true;
  const config = resolveVariantConfig(input);
  const rules = powerupsRules(config);
  const state = initialGameState(rules);
  state.opening = { status: 'RESOLVED', attempts: [[6, 1]], winner: 0 };
  state.active = 0;
  state.phase = 'WAITING_FOR_ROLL';
  state.powerups!.loadouts[0].passives = [{ instanceId: 'loaded-1', abilityId: 'loadedKnuckles' }];

  assert.deepEqual(
    generateMovementRoll(
      state,
      0,
      config,
      () => 4,
      () => 1,
    ),
    [4, 4],
  );
  const misses = [2, 4];
  assert.deepEqual(
    generateMovementRoll(
      state,
      0,
      config,
      () => 4,
      () => misses.shift()!,
    ),
    [4, 6],
  );

  const rolled = transitionSession(
    { state, history: [] },
    { type: 'receiveRoll', values: [4, 4] },
    rules,
  );
  assert.equal(rolled.ok, true);
  if (!rolled.ok) return;
  assert.deepEqual(rolled.session.state.remaining, [4, 4]);
  assert.equal(rolled.session.state.rollSource, 'loadedKnuckles');

  const modified = initialGameState(rules);
  modified.opening = { status: 'RESOLVED', attempts: [[6, 1]], winner: 0 };
  modified.active = 0;
  modified.phase = 'WAITING_FOR_MOVE';
  modified.roll = [2, 3];
  modified.remaining = [2, 3];
  modified.powerups!.loadouts[0] = {
    powerups: [{ instanceId: 'nudge-1', abilityId: 'nudge' }],
    passives: [{ instanceId: 'loaded-1', abilityId: 'loadedKnuckles' }],
  };
  const nudged = transitionSession(
    { state: modified, history: [] },
    {
      type: 'useRollAbility',
      player: 0,
      activation: {
        instanceId: 'nudge-1',
        target: { type: 'DIE', index: 0 },
        option: 'INCREASE',
      },
      randomValues: [],
    },
    rules,
  );
  assert.equal(nudged.ok, true);
  if (nudged.ok) assert.deepEqual(nudged.session.state.remaining, [3, 3]);
});

test('Quartermaster expands capacity and blocks powerups for configured own turns', () => {
  const input = createPowerupsV1Input();
  input.id = 'quartermaster-test';
  input.inventory.powerupSlots = 1;
  input.draft.intervalRounds = 100;
  input.abilities.quartermaster.extraPowerupSlots = 2;
  input.abilities.quartermaster.cooldownOwnTurns = 2;
  const config = resolveVariantConfig(input);
  const rules = powerupsRules(config);
  const state = initialGameState(rules);
  state.opening = { status: 'RESOLVED', attempts: [[6, 1]], winner: 0 };
  state.active = 0;
  state.phase = 'DRAFT_PICK';
  state.powerups!.loadouts[0] = {
    powerups: [{ instanceId: 'frost-1', abilityId: 'frostSeal' }],
    passives: [{ instanceId: 'quartermaster-1', abilityId: 'quartermaster' }],
  };
  state.powerups!.draft = {
    stage: 'PICKING',
    offer: ['recast'],
    resumePlayer: 0,
    attempts: [[6, 1]],
    pickOrder: [0],
    currentPick: 0,
    picks: [],
  };
  assert.equal(powerupCapacity(state.powerups!, 0, config), 3);
  const picked = transitionSession(
    { state, history: [] },
    { type: 'pickAbility', player: 0, abilityId: 'recast' },
    rules,
  );
  assert.equal(picked.ok, true);
  if (!picked.ok) return;
  assert.equal(picked.session.state.powerups!.loadouts[0].powerups.length, 2);

  let session = picked.session;
  session.state.phase = 'WAITING_FOR_MOVE';
  session.state.roll = [2, 5];
  session.state.remaining = [2, 5];
  const used = transitionSession(
    session,
    {
      type: 'useRollAbility',
      player: 0,
      activation: { instanceId: 'ability-1', target: { type: 'DIE', index: 0 } },
      randomValues: [6],
    },
    rules,
  );
  assert.equal(used.ok, true);
  if (!used.ok) return;
  assert.equal(quartermasterCooldown(used.session.state.powerups!, 0), 2);
  session = used.session;

  const finishTurn = () => {
    session.state.phase = 'TURN_COMPLETE';
    const ended = transitionSession(session, { type: 'endTurn' }, rules);
    assert.equal(ended.ok, true);
    if (ended.ok) session = ended.session;
  };
  const tryNudge = () => {
    session.state.phase = 'WAITING_FOR_MOVE';
    session.state.roll = [2, 5];
    session.state.remaining = [2, 5];
    session.state.powerups!.loadouts[0].powerups.push({
      instanceId: `nudge-${quartermasterCooldown(session.state.powerups!, 0)}`,
      abilityId: 'nudge',
    });
    return transitionSession(
      session,
      {
        type: 'useRollAbility',
        player: 0,
        activation: {
          instanceId: `nudge-${quartermasterCooldown(session.state.powerups!, 0)}`,
          target: { type: 'DIE', index: 0 },
          option: 'INCREASE',
        },
        randomValues: [],
      },
      rules,
    );
  };

  finishTurn();
  assert.equal(quartermasterCooldown(session.state.powerups!, 0), 2);
  finishTurn();
  assert.deepEqual(tryNudge(), { ok: false, reason: 'invalid_ability' });
  finishTurn();
  assert.equal(quartermasterCooldown(session.state.powerups!, 0), 1);
  finishTurn();
  assert.deepEqual(tryNudge(), { ok: false, reason: 'invalid_ability' });
  finishTurn();
  assert.equal(quartermasterCooldown(session.state.powerups!, 0), 0);
  finishTurn();
  assert.equal(tryNudge().ok, true);
});

test('a replacement capacity passive takes precedence over additive passive capacity', () => {
  const input = createPowerupsV1Input();
  input.id = 'combined-passive-capacity';
  input.inventory.passiveSlots = 2;
  input.inventory.powerupSlots = 2;
  input.abilities.quartermaster.extraPowerupSlots = 3;
  input.abilities.opportunist.equippedPowerupSlots = 1;
  const config = resolveVariantConfig(input);
  const state = initialGameState(powerupsRules(config));
  state.powerups!.loadouts[0].passives = [
    { instanceId: 'quartermaster-1', abilityId: 'quartermaster' },
    { instanceId: 'opportunist-1', abilityId: 'opportunist' },
  ];

  assert.equal(powerupCapacity(state.powerups!, 0, config), 1);
});

test('replacing Quartermaster clears its cooldown and grandfathers occupied extra slots', () => {
  const input = createPowerupsV1Input();
  input.id = 'quartermaster-replacement-test';
  input.inventory.powerupSlots = 1;
  const config = resolveVariantConfig(input);
  const rules = powerupsRules(config);
  const state = initialGameState(rules);
  state.phase = 'DRAFT_PICK';
  state.powerups!.loadouts[0] = {
    powerups: [
      { instanceId: 'frost-1', abilityId: 'frostSeal' },
      { instanceId: 'recast-1', abilityId: 'recast' },
    ],
    passives: [{ instanceId: 'quartermaster-1', abilityId: 'quartermaster' }],
  };
  state.powerups!.passiveCounters[0].quartermasterCooldown = 1;
  state.powerups!.draft = {
    stage: 'PICKING',
    offer: ['loadedKnuckles'],
    resumePlayer: 0,
    attempts: [[6, 1]],
    pickOrder: [0],
    currentPick: 0,
    picks: [],
  };
  const result = transitionSession(
    { state, history: [] },
    {
      type: 'pickAbility',
      player: 0,
      abilityId: 'loadedKnuckles',
      replaceInstanceId: 'quartermaster-1',
    },
    rules,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.session.state.powerups!.loadouts[0].powerups.length, 2);
  assert.equal(result.session.state.powerups!.passiveCounters[0].quartermasterCooldown, undefined);
  assert.deepEqual(result.session.state.powerups!.loadouts[0].passives, [
    { instanceId: 'ability-1', abilityId: 'loadedKnuckles' },
  ]);
});

test('Home Guard derives public policy and blocks configured home-board pins', () => {
  const rules = powerupsRules(POWERUPS_V1);
  const state = initialGameState(rules);
  state.opening = { status: 'RESOLVED', attempts: [[6, 1]], winner: 0 };
  state.active = 0;
  state.phase = 'DRAFT_PICK';
  state.powerups!.draft = {
    stage: 'PICKING',
    offer: ['homeGuard'],
    resumePlayer: 1,
    attempts: [[6, 1]],
    pickOrder: [0],
    currentPick: 0,
    picks: [],
  };
  const picked = transitionSession(
    { state, history: [] },
    { type: 'pickAbility', player: 0, abilityId: 'homeGuard' },
    rules,
  );
  assert.equal(picked.ok, true);
  if (!picked.ok) return;
  assert.deepEqual(picked.session.state.powerups!.passivePolicies[0], {
    homeGuard: {
      protectOwnHome: true,
      restrictOpponentHome: true,
      excludeStartPoints: true,
    },
  });

  const guarded = picked.session.state;
  guarded.board = Array.from({ length: 24 }, () => []);
  guarded.board[17] = [0];
  guarded.board[16] = [15];
  guarded.off = [
    Array.from({ length: 14 }, (_, index) => index + 1),
    Array.from({ length: 14 }, (_, index) => index + 16),
  ];
  guarded.active = 1;
  guarded.phase = 'WAITING_FOR_MOVE';
  guarded.roll = [1, 2];
  guarded.remaining = [1];
  assert.equal(moveAllowedByActiveEffects(guarded, 1, { from: 16, to: 17, die: 1 }), false);
  assert.deepEqual(
    transitionSession(
      { state: guarded, history: [] },
      { type: 'move', sequence: [{ from: 16, to: 17, die: 1 }] },
      rules,
    ),
    { ok: false, reason: 'illegal_move' },
  );

  guarded.board[17] = [];
  guarded.board[16] = [];
  guarded.board[4] = [0];
  guarded.board[5] = [15];
  assert.equal(moveAllowedByActiveEffects(guarded, 0, { from: 4, to: 5, die: 1 }), false);

  guarded.board[5] = [];
  guarded.board[12] = [0];
  guarded.board[13] = [15];
  assert.equal(moveAllowedByActiveEffects(guarded, 1, { from: 13, to: 12, die: 1 }), true);
});

test('Home Guard protection and offensive restriction are independently configurable', () => {
  const input = createPowerupsV1Input();
  input.id = 'home-guard-offense-only';
  input.abilities.homeGuard.protectOwnHome = false;
  const config = resolveVariantConfig(input);
  const state = initialGameState(powerupsRules(config));
  state.powerups!.loadouts[0].passives = [{ instanceId: 'home-guard-1', abilityId: 'homeGuard' }];
  rebuildPassivePolicies(state.powerups!, 0, config);

  state.board = Array.from({ length: 24 }, () => []);
  state.board[17] = [0];
  state.board[16] = [15];
  assert.equal(moveAllowedByActiveEffects(state, 1, { from: 16, to: 17, die: 1 }), true);

  state.board[17] = [];
  state.board[16] = [];
  state.board[4] = [0];
  state.board[5] = [15];
  assert.equal(moveAllowedByActiveEffects(state, 0, { from: 4, to: 5, die: 1 }), false);

  const startsInput = createPowerupsV1Input();
  startsInput.id = 'home-guard-includes-starts';
  startsInput.abilities.homeGuard.restrictOpponentHome = false;
  startsInput.abilities.homeGuard.excludeStartPoints = false;
  const startsConfig = resolveVariantConfig(startsInput);
  const startsState = initialGameState(powerupsRules(startsConfig));
  startsState.powerups!.loadouts[0].passives = [
    { instanceId: 'home-guard-1', abilityId: 'homeGuard' },
  ];
  rebuildPassivePolicies(startsState.powerups!, 0, startsConfig);
  startsState.board = Array.from({ length: 24 }, () => []);
  startsState.board[12] = [0];
  startsState.board[13] = [15];
  assert.equal(moveAllowedByActiveEffects(startsState, 1, { from: 13, to: 12, die: 1 }), false);
});

test('Opportunist gains public Focus from an opponent stalled on their initial roll', () => {
  const input = createPowerupsV1Input();
  input.id = 'opportunist-focus-cap';
  input.abilities.opportunist.focusCap = 2;
  const config = resolveVariantConfig(input);
  const rules = powerupsRules(config);
  const state = initialGameState(rules);
  state.opening = { status: 'RESOLVED', attempts: [[6, 1]], winner: 0 };
  state.active = 0;
  state.phase = 'WAITING_FOR_ROLL';
  state.board = Array.from({ length: 24 }, () => []);
  state.board[0] = [0];
  state.board[1] = [15, 16];
  state.board[2] = [17, 18];
  state.off = [
    Array.from({ length: 14 }, (_, index) => index + 1),
    Array.from({ length: 11 }, (_, index) => index + 19),
  ];
  state.powerups!.loadouts[1].passives = [
    { instanceId: 'opportunist-1', abilityId: 'opportunist' },
  ];
  let session: Session = { state, history: [] };

  for (const [expected, gains] of [
    [1, true],
    [2, true],
    [2, false],
  ] as const) {
    session.state.phase = 'WAITING_FOR_ROLL';
    session.state.active = 0;
    const rolled = transitionSession(session, { type: 'receiveRoll', values: [1, 2] }, rules);
    assert.equal(rolled.ok, true);
    if (!rolled.ok) return;
    session = rolled.session;
    assert.equal(session.state.phase, 'TURN_COMPLETE');
    assert.equal(opportunistFocus(session.state.powerups!, 1), expected);
    assert.equal(
      rolled.events.some(
        (event) => event.type === 'FocusGained' && event.player === 1 && event.focus === expected,
      ),
      gains,
    );
  }
});

test('Opportunist spends Focus through configured dice rules without consuming a card', () => {
  const input = createPowerupsV1Input();
  input.id = 'configured-opportunist';
  input.abilities.opportunist.focusAdjustment = 2;
  input.abilities.opportunist.focusUsesPerRoll = 2;
  input.abilities.opportunist.focusDirections = ['DECREASE'];
  input.abilities.opportunist.allowedRolls = 'ANY';
  input.abilities.opportunist.allowBearingOff = false;
  input.abilities.opportunist.createdMatchBecomesDouble = true;
  input.abilities.opportunist.equippedPowerupSlots = 0;
  const config = resolveVariantConfig(input);
  const rules = powerupsRules(config);
  const state = initialGameState(rules);
  state.opening = { status: 'RESOLVED', attempts: [[6, 1]], winner: 0 };
  state.active = 0;
  state.phase = 'WAITING_FOR_MOVE';
  state.roll = [5, 3];
  state.remaining = [5, 3];
  state.powerups!.loadouts[0].passives = [
    { instanceId: 'opportunist-1', abilityId: 'opportunist' },
  ];
  state.powerups!.passiveCounters[0].opportunistFocus = 2;
  assert.equal(powerupCapacity(state.powerups!, 0, config), 0);
  const session: Session = { state, history: [] };
  assert.deepEqual(
    transitionSession(
      session,
      {
        type: 'useRollAbility',
        player: 0,
        activation: {
          instanceId: 'opportunist-1',
          target: { type: 'DIE', index: 1 },
          option: 'INCREASE',
        },
        randomValues: [],
      },
      rules,
    ),
    { ok: false, reason: 'invalid_ability' },
  );
  const used = transitionSession(
    session,
    {
      type: 'useRollAbility',
      player: 0,
      activation: {
        instanceId: 'opportunist-1',
        target: { type: 'DIE', index: 0 },
        option: 'DECREASE',
      },
      randomValues: [],
    },
    rules,
  );
  assert.equal(used.ok, true);
  if (!used.ok) return;
  assert.deepEqual(used.session.state.remaining, [3, 3, 3, 3]);
  assert.equal(opportunistFocus(used.session.state.powerups!, 0), 1);
  assert.deepEqual(used.session.state.powerups!.loadouts[0].passives, [
    { instanceId: 'opportunist-1', abilityId: 'opportunist' },
  ]);
  assert.equal(used.session.state.powerups!.powerupsUsedThisTurn, 0);
  assert.equal(used.session.state.diceModifiers[0].abilityId, 'opportunist');
  assert.equal(used.session.state.diceModifiers[0].allowBearingOff, false);

  const usedAgain = transitionSession(
    used.session,
    {
      type: 'useRollAbility',
      player: 0,
      activation: {
        instanceId: 'opportunist-1',
        target: { type: 'DIE', index: 1 },
        option: 'DECREASE',
      },
      randomValues: [],
    },
    rules,
  );
  assert.equal(usedAgain.ok, true);
  if (!usedAgain.ok) return;
  assert.deepEqual(usedAgain.session.state.remaining.slice().sort(), [1, 3, 3, 3]);
  assert.equal(opportunistFocus(usedAgain.session.state.powerups!, 0), 0);
  assert.equal(usedAgain.session.state.diceModifiers.length, 2);
});

test('replacing Opportunist clears stored Focus', () => {
  const rules = powerupsRules(POWERUPS_V1);
  const state = initialGameState(rules);
  state.phase = 'DRAFT_PICK';
  state.powerups!.loadouts[0].passives = [
    { instanceId: 'opportunist-1', abilityId: 'opportunist' },
  ];
  state.powerups!.passiveCounters[0].opportunistFocus = 1;
  state.powerups!.draft = {
    stage: 'PICKING',
    offer: ['loadedKnuckles'],
    resumePlayer: 0,
    attempts: [[6, 1]],
    pickOrder: [0],
    currentPick: 0,
    picks: [],
  };
  const replaced = transitionSession(
    { state, history: [] },
    {
      type: 'pickAbility',
      player: 0,
      abilityId: 'loadedKnuckles',
      replaceInstanceId: 'opportunist-1',
    },
    rules,
  );
  assert.equal(replaced.ok, true);
  if (!replaced.ok) return;
  assert.equal(replaced.session.state.powerups!.passiveCounters[0].opportunistFocus, undefined);
});
