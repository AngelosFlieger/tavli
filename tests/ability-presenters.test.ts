import test from 'node:test';
import assert from 'node:assert/strict';
import { initialGameState } from '../src/game/session/state';
import { POWERUPS_V1 } from '../src/game/variant/config/profiles';
import { ABILITY_IDS, powerupsRules } from '../src/game/variant/types';
import {
  abilityCounterText,
  abilityPresenters,
  rollAbilityOptionLabel,
  rollAbilityPrompt,
  usesDirectDieSelection,
} from '../src/ui/abilities/presenters';

test('the UI presenter registry covers every ability ID', () => {
  assert.deepEqual(Object.keys(abilityPresenters), [...ABILITY_IDS]);
});

test('ability presenters derive counter and roll-option copy from public state and config', () => {
  const state = initialGameState(powerupsRules(POWERUPS_V1));
  state.roll = [2, 5];
  state.powerups!.passiveCounters[0].quartermasterCooldown = 2;
  state.powerups!.passiveCounters[0].opportunistFocus = 1;

  assert.equal(abilityCounterText('quartermaster', state, 0, POWERUPS_V1), 'Cooldown 2');
  assert.equal(
    abilityCounterText('opportunist', state, 0, POWERUPS_V1),
    `Focus 1/${POWERUPS_V1.abilities.opportunist.focusCap}`,
  );
  assert.equal(abilityCounterText('homeGuard', state, 0, POWERUPS_V1), null);
  assert.equal(rollAbilityPrompt('recast', 'Recast'), 'Click the die you want to reroll');
  assert.equal(usesDirectDieSelection('recast'), true);
  assert.equal(usesDirectDieSelection('nudge'), false);
  assert.equal(
    rollAbilityOptionLabel(
      'nudge',
      state,
      { target: { type: 'DIE', index: 0 }, option: 'INCREASE' },
      POWERUPS_V1,
    ),
    `Die 1 · 2 → ${2 + POWERUPS_V1.abilities.nudge.adjustment}`,
  );
  assert.equal(
    rollAbilityOptionLabel('recast', state, { target: { type: 'DIE', index: 1 } }, POWERUPS_V1),
    'Reroll die 2 · 5',
  );
});
