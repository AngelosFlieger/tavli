import type { GameState } from '../../session/state';
import type { AbilityActivation, RollAbilityOption, RollKind } from '../types';
import type { AfterRollAbilityApplication } from './capabilities';

type NumericAdjustmentPolicy = {
  adjustment: number;
  directions: readonly NonNullable<AbilityActivation['option']>[];
  allowedRolls: RollKind;
  allowBearingOff: boolean;
  createdMatchBecomesDouble: boolean;
};

export function numericAdjustmentOptions(
  state: GameState,
  availableDice: readonly (0 | 1)[],
  policy: NumericAdjustmentPolicy,
): RollAbilityOption[] {
  if (policy.allowedRolls === 'NON_DOUBLE' && state.roll[0] === state.roll[1]) return [];
  return availableDice.flatMap((index) =>
    policy.directions.flatMap((direction) => {
      const after = adjustedValue(state.roll[index], direction, policy.adjustment);
      return after >= 1 && after <= 6
        ? [{ target: { type: 'DIE' as const, index }, option: direction }]
        : [];
    }),
  );
}

export function applyNumericAdjustment(
  state: GameState,
  activation: AbilityActivation,
  policy: NumericAdjustmentPolicy,
  createdDoubleTokens: (value: number) => number[],
): AfterRollAbilityApplication | null {
  if (activation.target.type !== 'DIE' || !activation.option) return null;
  const before = state.roll[activation.target.index];
  const after = adjustedValue(before, activation.option, policy.adjustment);
  if (after < 1 || after > 6) return null;
  const token = state.remaining.indexOf(before);
  if (token < 0) return null;
  const wasDouble = state.roll[0] === state.roll[1];
  state.remaining[token] = after;
  const other = state.roll[activation.target.index === 0 ? 1 : 0];
  if (!wasDouble && after === other && policy.createdMatchBecomesDouble)
    state.remaining = createdDoubleTokens(after);
  return { before, after, allowBearingOff: policy.allowBearingOff };
}

export function replaceOneMovementToken(tokens: number[], before: number, after: number): boolean {
  const index = tokens.indexOf(before);
  if (index < 0) return false;
  tokens[index] = after;
  return true;
}

function adjustedValue(
  before: number,
  direction: NonNullable<AbilityActivation['option']>,
  adjustment: number,
): number {
  return before + (direction === 'INCREASE' ? adjustment : -adjustment);
}
