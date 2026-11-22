import type { GameState } from '../session/state';
import { resolveVariantConfig } from './config/schema';
import { VARIANT_PROFILE_IDS, variantProfile, type VariantProfileId } from './config/profiles';
import {
  CLASSIC_RULES,
  powerupsRules,
  type ResolvedVariantConfig,
  type RulesContext,
} from './types';

export type VariantRulesSelection =
  { ruleset: 'CLASSIC' } | { ruleset: 'POWERUPS_V1'; profileId: VariantProfileId };

export function rulesForSelection(selection: VariantRulesSelection): RulesContext {
  return selection.ruleset === 'CLASSIC'
    ? CLASSIC_RULES
    : powerupsRules(variantProfile(selection.profileId));
}

/** Stable queue identity for matches that use the exact same resolved rules. */
export function matchKey(rules: RulesContext): string {
  return `${rules.ruleset}:${rules.variantConfig?.hash ?? 'classic'}`;
}

/**
 * Resolves and validates the rules used by an existing state.
 *
 * Omitting `snapshot` supports legacy persisted games by looking up a registered profile from the
 * state's hash. Passing `null` explicitly means Classic, which keeps wire-state validation strict.
 */
export function rulesForState(
  state: Pick<GameState, 'ruleset' | 'variantConfigHash'>,
  snapshot?: ResolvedVariantConfig | null,
): RulesContext {
  let rules: RulesContext;

  if (snapshot !== undefined) {
    rules = snapshot === null ? CLASSIC_RULES : powerupsRules(resolveVariantConfig(snapshot));
  } else if (state.ruleset === 'CLASSIC') {
    rules = CLASSIC_RULES;
  } else {
    const config = VARIANT_PROFILE_IDS.map(variantProfile).find(
      (candidate) => candidate.hash === state.variantConfigHash,
    );

    if (!config) throw new Error(`Unknown variant configuration ${state.variantConfigHash ?? ''}`);

    rules = powerupsRules(config);
  }

  if (
    state.ruleset !== rules.ruleset ||
    state.variantConfigHash !== (rules.variantConfig?.hash ?? null)
  )
    throw new Error('State and variant configuration do not agree');

  return rules;
}
