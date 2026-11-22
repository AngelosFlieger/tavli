import type { AbilityConfigBase, EffectBoundary, EffectDuration, Probability } from '../types';

export function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`);

  return value as Record<string, unknown>;
}

export function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string) {
  const expected = new Set(keys);
  const missing = keys.filter((key) => !(key in value));
  const unknown = Object.keys(value).filter((key) => !expected.has(key));

  if (missing.length) throw new Error(`${label} is missing ${missing.join(', ')}`);
  if (unknown.length) throw new Error(`${label} has unknown keys: ${unknown.join(', ')}`);
}

export function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`);

  return value;
}

export function integer(value: unknown, label: string, minimum = 0): number {
  if (!Number.isInteger(value) || (value as number) < minimum)
    throw new Error(`${label} must be an integer >= ${minimum}`);

  return value as number;
}

export function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be non-empty`);

  return value;
}

export function oneOf<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  label: string,
): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value))
    throw new Error(`${label} must be one of ${allowed.join(', ')}`);

  return value as T[number];
}

export function uniqueList<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  label: string,
): T[number][] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);

  const result = value.map((item, index) => oneOf(item, allowed, `${label}[${index}]`));

  if (new Set(result).size !== result.length)
    throw new Error(`${label} must not contain duplicates`);

  return result;
}

export function baseConfig(value: Record<string, unknown>, label: string): AbilityConfigBase {
  const enabled = boolean(value.enabled, `${label}.enabled`);
  const offerWeight = integer(value.offerWeight, `${label}.offerWeight`);

  if (enabled && offerWeight === 0)
    throw new Error(`${label}.offerWeight must be positive when enabled`);

  return { enabled, offerWeight };
}

export function probability(value: unknown, label: string): Probability {
  const input = record(value, label);

  exactKeys(input, ['numerator', 'denominator'], label);

  const numerator = integer(input.numerator, `${label}.numerator`);
  const denominator = integer(input.denominator, `${label}.denominator`, 1);

  if (numerator > denominator) throw new Error(`${label} must be between 0 and 1`);

  return { numerator, denominator };
}

export function duration(
  value: unknown,
  label: string,
  boundaries: readonly EffectBoundary[],
): EffectDuration {
  const input = record(value, label);

  exactKeys(input, ['boundary', 'count'], label);

  return {
    boundary: oneOf(input.boundary, boundaries, `${label}.boundary`),
    count: integer(input.count, `${label}.count`, 1),
  };
}

export function turns(count: number, noun = 'turn'): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
