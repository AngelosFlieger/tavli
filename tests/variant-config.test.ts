import test from 'node:test';
import assert from 'node:assert/strict';
import { initialGameState } from '../src/game/session/state';
import { transitionSession } from '../src/game/session/transition';
import { abilityRegistry, describeAbility } from '../src/game/variant/abilities/registry';
import { resolveVariantConfig } from '../src/game/variant/config/schema';
import { FAST_BALANCE, POWERUPS_V1 } from '../src/game/variant/config/profiles';
import { createPowerupsV1Input } from '../src/game/variant/config/profiles/v1';
import { ABILITY_IDS, powerupsRules, type AbilityConfigMap } from '../src/game/variant/types';

test('version-one balance values resolve once and are deeply immutable', () => {
  assert.equal(POWERUPS_V1.id, 'powerups-v1');
  assert.equal(POWERUPS_V1.inventory.powerupSlots, 2);
  assert.equal(POWERUPS_V1.inventory.passiveSlots, 1);
  assert.equal(POWERUPS_V1.draft.intervalRounds, 3);
  assert.deepEqual(POWERUPS_V1.draft.offer, { powerups: 2, passives: 1 });
  assert.match(POWERUPS_V1.hash, /^v1-[0-9a-f]{8}$/);
  assert.equal(Object.isFrozen(POWERUPS_V1), true);
  assert.equal(Object.isFrozen(POWERUPS_V1.inventory), true);
  assert.equal(Object.isFrozen(POWERUPS_V1.abilities.frostSeal.duration), true);
});

test('profile changes produce new hashes and config-derived card copy', () => {
  const input = createPowerupsV1Input();
  input.id = 'two-turn-freeze';
  input.abilities.frostSeal.duration.count = 2;
  const tuned = resolveVariantConfig(input);
  assert.notEqual(tuned.hash, POWERUPS_V1.hash);
  assert.equal(
    describeAbility('frostSeal', tuned.abilities.frostSeal).summary,
    'Freeze a point for 2 opponent turns.',
  );
  assert.equal(FAST_BALANCE.draft.intervalRounds, 1);
  assert.notEqual(FAST_BALANCE.hash, POWERUPS_V1.hash);
});

test('config hashes are stable when object keys have a different insertion order', () => {
  const input = createPowerupsV1Input();
  const reversedEntries = Object.entries(input.abilities).reverse();
  const reordered = {
    abilities: Object.fromEntries(reversedEntries) as AbilityConfigMap,
    draft: input.draft,
    inventory: input.inventory,
    version: input.version,
    id: input.id,
  };
  assert.equal(resolveVariantConfig(reordered).hash, POWERUPS_V1.hash);
  assert.equal(resolveVariantConfig(POWERUPS_V1).hash, POWERUPS_V1.hash);
  const tampered = structuredClone(POWERUPS_V1);
  tampered.inventory.powerupSlots++;
  assert.throws(() => resolveVariantConfig(tampered), /hash mismatch/);
});

test('invalid probabilities, draft sizes, and unknown ability fields fail early', () => {
  const probability = createPowerupsV1Input();
  probability.abilities.loadedKnuckles.matchChance = { numerator: 4, denominator: 3 };
  assert.throws(() => resolveVariantConfig(probability), /between 0 and 1/);

  const offer = createPowerupsV1Input();
  offer.draft.picksPerPlayer = 2;
  assert.throws(() => resolveVariantConfig(offer), /enough cards for both players/);

  const optionalRecast = createPowerupsV1Input();
  optionalRecast.abilities.recast.acceptResult = false;
  assert.throws(() => resolveVariantConfig(optionalRecast), /acceptResult must be true/);

  const inertHomeGuard = createPowerupsV1Input();
  inertHomeGuard.abilities.homeGuard.protectOwnHome = false;
  inertHomeGuard.abilities.homeGuard.restrictOpponentHome = false;
  assert.throws(() => resolveVariantConfig(inertHomeGuard), /must enable its protection/);

  const directionlessFocus = createPowerupsV1Input();
  directionlessFocus.abilities.opportunist.focusDirections = [];
  assert.throws(
    () => resolveVariantConfig(directionlessFocus),
    /focusDirections must not be empty/,
  );

  const excessiveFocusUses = createPowerupsV1Input();
  excessiveFocusUses.abilities.opportunist.focusUsesPerRoll = 3;
  assert.throws(() => resolveVariantConfig(excessiveFocusUses), /focusUsesPerRoll must be 1 or 2/);

  const invalidJinxFloor = createPowerupsV1Input();
  invalidJinxFloor.abilities.jinx.minimumToken = 7;
  assert.throws(() => resolveVariantConfig(invalidJinxFloor), /minimumToken must be <= 6/);

  const invalidJinxExpiry = createPowerupsV1Input();
  invalidJinxExpiry.abilities.jinx.duration.boundary = 'TARGET_TURN_END';
  assert.throws(() => resolveVariantConfig(invalidJinxExpiry), /must be one of NEXT_DRAFT/);

  const unknown = createPowerupsV1Input() as unknown as {
    abilities: Record<string, Record<string, unknown>>;
  };
  unknown.abilities.frostSeal.surprise = 99;
  assert.throws(() => resolveVariantConfig(unknown), /unknown keys: surprise/);
});

test('the registry has one typed definition for every configured ability', () => {
  assert.deepEqual(Object.keys(abilityRegistry), [...ABILITY_IDS]);
  for (const abilityId of ABILITY_IDS) {
    const definition = abilityRegistry[abilityId];
    assert.equal(definition.id, abilityId);
    assert.ok(definition.kind === 'POWERUP' || definition.kind === 'PASSIVE');
    assert.equal(POWERUPS_V1.abilities[abilityId].enabled, true);
  }
});

test('powerup sessions retain their config identity through restart', () => {
  const rules = powerupsRules(POWERUPS_V1);
  const state = initialGameState(rules);
  assert.equal(state.ruleset, 'POWERUPS_V1');
  assert.equal(state.variantConfigHash, POWERUPS_V1.hash);
  assert.deepEqual(state.powerups?.loadouts, [
    { powerups: [], passives: [] },
    { powerups: [], passives: [] },
  ]);
  assert.deepEqual(transitionSession({ state, history: [] }, { type: 'beginRoll' }), {
    ok: false,
    reason: 'rules_mismatch',
  });
  const restarted = transitionSession({ state, history: [] }, { type: 'restart' }, rules);
  assert.equal(restarted.ok, true);
  if (!restarted.ok) return;
  assert.equal(restarted.session.state.variantConfigHash, POWERUPS_V1.hash);
  assert.equal(restarted.session.state.powerups?.completedRounds, 0);
});
