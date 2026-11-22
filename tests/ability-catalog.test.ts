import test from 'node:test';
import assert from 'node:assert/strict';
import { abilityRegistry } from '../src/game/variant/abilities/registry';
import { FAST_BALANCE, POWERUPS_V1 } from '../src/game/variant/config/profiles';
import { sampleDraftOffer } from '../src/game/variant/draft';
import { initialGameState } from '../src/game/session/state';
import { ABILITY_IDS, powerupsRules } from '../src/game/variant/types';
import { abilityPresenters, rollAbilityPrompt } from '../src/ui/abilities/presenters';
import { el } from '../src/ui/i18n/el';
import { en } from '../src/ui/i18n/en';

/**
 * These values are a public contract: seeded local games, persisted matches, and downloaded
 * playtest reports all depend on them. Refactors must update this file only when a change is
 * deliberate.
 */
const frozenIds = [
  'frostSeal',
  'bastion',
  'jinx',
  'clearSkies',
  'recast',
  'nudge',
  'loadedKnuckles',
  'quartermaster',
  'homeGuard',
  'opportunist',
] as const;

const frozenHashes = { 'powerups-v1': 'v1-cabaf9b7', 'fast-balance': 'v1-fe28e959' };

const frozenOffers = [
  { seed: 123456789, profile: 'powerups-v1', offer: ['nudge', 'recast', 'opportunist'] },
  { seed: 987654321, profile: 'fast-balance', offer: ['nudge', 'jinx', 'homeGuard'] },
] as const;

/** Small deterministic generator; the exact stream is part of the frozen draft expectations. */
function lcg(start: number) {
  let seed = start;

  return (maximum: number) => {
    seed = (seed * 1664525 + 1013904223) >>> 0;

    return seed % maximum;
  };
}

test('ability IDs keep their public order', () => {
  assert.deepEqual([...ABILITY_IDS], [...frozenIds]);
  assert.deepEqual(Object.keys(abilityRegistry), [...frozenIds]);
});

test('registered profile hashes stay stable', () => {
  assert.equal(POWERUPS_V1.hash, frozenHashes['powerups-v1']);
  assert.equal(FAST_BALANCE.hash, frozenHashes['fast-balance']);
});

test('seeded draft offers stay stable', () => {
  for (const expected of frozenOffers) {
    const profile = expected.profile === 'powerups-v1' ? POWERUPS_V1 : FAST_BALANCE;
    const state = initialGameState(powerupsRules(profile));

    assert.deepEqual(
      sampleDraftOffer(state.powerups!, profile, lcg(expected.seed)),
      [...expected.offer],
      `${expected.profile} draft offer drifted`,
    );
  }
});

test('every ability has a name and summary entry in both catalogs', () => {
  for (const abilityId of frozenIds) {
    assert.ok(en[`ability.${abilityId}.name`], `en is missing ability.${abilityId}.name`);
    assert.ok(el[`ability.${abilityId}.name`], `el is missing ability.${abilityId}.name`);
    assert.ok(
      Object.keys(en).some((key) => key.startsWith(`ability.${abilityId}.summary`)),
      `en is missing an ability.${abilityId}.summary entry`,
    );
    assert.ok(
      Object.keys(el).some((key) => key.startsWith(`ability.${abilityId}.summary`)),
      `el is missing an ability.${abilityId}.summary entry`,
    );
  }
});

test('presenter entries are optional and every ability has default copy', () => {
  assert.equal(rollAbilityPrompt('frostSeal', 'Frost Seal'), 'Choose how to use Frost Seal');

  for (const abilityId of frozenIds) {
    const prompt = rollAbilityPrompt(abilityId, 'Ability');

    assert.ok(prompt.length > 0, `no roll prompt copy for ${abilityId}`);

    if (abilityId in abilityPresenters) assert.ok(abilityPresenters[abilityId]);
  }
});
