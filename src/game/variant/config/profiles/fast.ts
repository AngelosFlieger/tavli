import { resolveVariantConfig } from '../schema';
import { createPowerupsV1Input } from './v1';

export const FAST_BALANCE_ID = 'fast-balance' as const;

const input = createPowerupsV1Input();
input.id = FAST_BALANCE_ID;
input.version = 1;
input.draft.intervalRounds = 1;

export const FAST_BALANCE = resolveVariantConfig(input);
