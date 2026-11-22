import type { ResolvedVariantConfig } from '../../types';
import { FAST_BALANCE, FAST_BALANCE_ID } from './fast';
import { POWERUPS_V1, POWERUPS_V1_ID } from './v1';

export { FAST_BALANCE, FAST_BALANCE_ID, POWERUPS_V1, POWERUPS_V1_ID };

const profiles = Object.freeze({
  [POWERUPS_V1_ID]: POWERUPS_V1,
  [FAST_BALANCE_ID]: FAST_BALANCE,
});

export type VariantProfileId = keyof typeof profiles;

export const VARIANT_PROFILE_IDS = Object.freeze(Object.keys(profiles) as VariantProfileId[]);

export function isVariantProfileId(value: unknown): value is VariantProfileId {
  return typeof value === 'string' && VARIANT_PROFILE_IDS.includes(value as VariantProfileId);
}

export function variantProfile(id: VariantProfileId): ResolvedVariantConfig {
  return profiles[id];
}
