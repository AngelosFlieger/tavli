import type { GameState } from '../../game/session/state';
import type { Player } from '../../game/rules/position';
import { opportunistFocus, quartermasterCooldown } from '../../game/variant/passives/policy';
import type { AbilityId, ResolvedVariantConfig, RollAbilityOption } from '../../game/variant/types';
import { t } from '../i18n';

type AbilityPresenter = Readonly<{
  counter?: (state: GameState, player: Player, config: ResolvedVariantConfig) => string | null;
  rollPrompt?: (name: string) => string;
  rollOption?: (
    state: GameState,
    option: RollAbilityOption,
    config: ResolvedVariantConfig,
  ) => string;
  directDieSelection?: boolean;
}>;

export const abilityPresenters: Readonly<Record<AbilityId, AbilityPresenter>> = Object.freeze({
  frostSeal: {},
  bastion: {},
  jinx: {},
  clearSkies: {},
  recast: {
    rollPrompt: () => t('ability.recast.prompt'),
    rollOption: (state, option) =>
      t('ability.recast.option', {
        die: option.target.index + 1,
        value: state.roll[option.target.index],
      }),
    directDieSelection: true,
  },
  nudge: {
    rollOption: (state, option, config) =>
      adjustedDieLabel(state, option, config.abilities.nudge.adjustment),
  },
  loadedKnuckles: {},
  quartermaster: {
    counter: (state, player) => {
      const cooldown = quartermasterCooldown(state.powerups!, player);
      return cooldown ? t('ability.cooldown', { count: cooldown }) : null;
    },
  },
  homeGuard: {},
  opportunist: {
    counter: (state, player, config) =>
      t('ability.focus', {
        focus: opportunistFocus(state.powerups!, player),
        cap: config.abilities.opportunist.focusCap,
      }),
    rollOption: (state, option, config) =>
      adjustedDieLabel(state, option, config.abilities.opportunist.focusAdjustment),
  },
});

export function abilityCounterText(
  abilityId: AbilityId,
  state: GameState,
  player: Player,
  config: ResolvedVariantConfig,
): string | null {
  return abilityPresenters[abilityId].counter?.(state, player, config) ?? null;
}

export function rollAbilityPrompt(abilityId: AbilityId, name: string): string {
  return abilityPresenters[abilityId].rollPrompt?.(name) ?? t('ability.chooseUse', { name });
}

export function rollAbilityOptionLabel(
  abilityId: AbilityId,
  state: GameState,
  option: RollAbilityOption,
  config: ResolvedVariantConfig,
): string {
  return (
    abilityPresenters[abilityId].rollOption?.(state, option, config) ??
    t('ability.dieOption', {
      die: option.target.index + 1,
      value: state.roll[option.target.index],
    })
  );
}

export function usesDirectDieSelection(abilityId: AbilityId): boolean {
  return abilityPresenters[abilityId].directDieSelection ?? false;
}

function adjustedDieLabel(state: GameState, option: RollAbilityOption, adjustment: number): string {
  const before = state.roll[option.target.index];
  const after = before + (option.option === 'INCREASE' ? adjustment : -adjustment);
  return t('ability.dieAdjusted', {
    die: option.target.index + 1,
    before,
    after,
  });
}
