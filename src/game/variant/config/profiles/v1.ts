import { resolveVariantConfig } from '../schema';
import type { VariantConfig } from '../../types';

export const POWERUPS_V1_ID = 'powerups-v1' as const;

export function createPowerupsV1Input(): VariantConfig {
  return {
    id: POWERUPS_V1_ID,
    version: 1,
    inventory: {
      powerupSlots: 2,
      passiveSlots: 1,
      powerupsPerTurn: 1,
      allowDuplicateAbilities: false,
    },
    draft: {
      intervalRounds: 3,
      offer: { powerups: 2, passives: 1 },
      picksPerPlayer: 1,
      orderDieSides: 6,
      rerollOrderTies: true,
      excludeHeldAbilities: true,
    },
    abilities: {
      frostSeal: {
        enabled: true,
        offerWeight: 10,
        duration: { boundary: 'TARGET_TURN_END', count: 1 },
        allowHomePoints: false,
        allowStartPoints: false,
        allowPinnedStacks: false,
        blockLeaving: true,
        blockLanding: true,
      },
      bastion: {
        enabled: true,
        offerWeight: 10,
        duration: { boundary: 'TARGET_TURN_END', count: 1 },
        requiredOwnCheckers: 1,
        allowHomePoints: true,
        allowStartPoints: false,
        blockLanding: true,
      },
      jinx: {
        enabled: true,
        offerWeight: 10,
        duration: { boundary: 'NEXT_DRAFT', count: 1 },
        penalty: 1,
        minimumToken: 1,
        targetToken: 'HIGHEST',
        affectDoubles: false,
        unaffectedDoubleConsumes: true,
        doubleHandling: 'CHANGE_ONE_TOKEN',
      },
      clearSkies: {
        enabled: true,
        offerWeight: 8,
        maxEffects: 1,
        removableTags: ['CONTROL', 'DICE_PENALTY'],
        canTargetOpponentPositive: false,
      },
      recast: {
        enabled: true,
        offerWeight: 10,
        rerollCount: 1,
        acceptResult: true,
        allowedRolls: 'ANY',
        createdMatchBecomesDouble: false,
        originalDoubleHandling: 'CHANGE_ONE_TOKEN',
      },
      nudge: {
        enabled: true,
        offerWeight: 10,
        adjustment: 1,
        directions: ['INCREASE', 'DECREASE'],
        allowedRolls: 'NON_DOUBLE',
        allowBearingOff: true,
        createdMatchBecomesDouble: false,
      },
      loadedKnuckles: {
        enabled: true,
        offerWeight: 10,
        matchChance: { numerator: 1, denominator: 3 },
        nonMatchDistribution: 'UNIFORM',
        doubleMoveTokens: 3,
      },
      quartermaster: {
        enabled: true,
        offerWeight: 10,
        extraPowerupSlots: 1,
        cooldownOwnTurns: 1,
      },
      homeGuard: {
        enabled: true,
        offerWeight: 10,
        protectOwnHome: true,
        restrictOpponentHome: true,
        excludeStartPoints: true,
      },
      opportunist: {
        enabled: true,
        offerWeight: 8,
        trigger: 'OPPONENT_NO_LEGAL_MOVES',
        focusCap: 1,
        focusGain: 1,
        focusAdjustment: 1,
        focusUsesPerRoll: 1,
        focusDirections: ['INCREASE', 'DECREASE'],
        allowedRolls: 'NON_DOUBLE',
        allowBearingOff: true,
        createdMatchBecomesDouble: false,
        equippedPowerupSlots: 1,
      },
    },
  };
}

export const POWERUPS_V1 = resolveVariantConfig(createPowerupsV1Input());
