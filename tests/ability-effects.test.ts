import test from 'node:test';
import assert from 'node:assert/strict';
import { initialGameState } from '../src/game/session/state';
import { POWERUPS_V1 } from '../src/game/variant/config/profiles';
import { powerupsRules, type ActiveEffect } from '../src/game/variant/types';
import { boardAbilityEffects } from '../src/scene/ability-effects';

function effect(
  instanceId: string,
  abilityId: ActiveEffect['abilityId'],
  point: number,
): ActiveEffect {
  return {
    instanceId,
    abilityId,
    source: 0,
    affectedPlayer: 1,
    target: { type: 'POINT', point },
    tags: ['CONTROL'],
    constraints: abilityId === 'bastion' ? [{ kind: 'ANCHOR_CHECKER', checker: 15 }] : [],
    duration: { boundary: 'TARGET_TURN_END', count: 1 },
    remaining: 1,
  };
}

test('temporary board visuals map Frost Seal and Bastion to the current top checker', () => {
  const state = initialGameState(powerupsRules(POWERUPS_V1));

  state.powerups!.activeEffects = [
    effect('frost-1', 'frostSeal', 0),
    effect('bastion-1', 'bastion', 12),
    effect('jinx-1', 'jinx', 5),
    effect('empty-1', 'frostSeal', 8),
  ];

  assert.deepEqual(boardAbilityEffects(state), [
    { instanceId: 'frost-1', abilityId: 'frostSeal', point: 0, checker: 14 },
    { instanceId: 'bastion-1', abilityId: 'bastion', point: 12, checker: 15 },
  ]);
});
