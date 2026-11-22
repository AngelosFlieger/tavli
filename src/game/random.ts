export type RandomInt = (maximum: number) => number;

export function parseOptionalSeed(raw: string): number | undefined {
  const trimmed = raw.trim();

  if (!trimmed) return undefined;

  const seed = Number(trimmed);

  return Number.isInteger(seed) && seed >= 0 && seed <= 0xffff_ffff ? seed : undefined;
}

/** A stable, non-cryptographic random source for reproducible local playtests. */
export function createSeededRandomInt(seed: number): RandomInt {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff)
    throw new Error('seed must be an unsigned 32-bit integer');

  let state = seed >>> 0;

  return (maximum: number) => {
    if (!Number.isSafeInteger(maximum) || maximum <= 0 || maximum > 0x1_0000_0000)
      throw new Error('random maximum must be an integer between 1 and 2^32');

    state = (state + 0x6d2b79f5) >>> 0;

    let value = state;

    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);

    const unsigned = (value ^ (value >>> 14)) >>> 0;

    return Math.floor((unsigned / 0x1_0000_0000) * maximum);
  };
}

/**
 * A reproducible die for seeded test matches. It advances its own stream so dice never
 * shift draft, Recast, or passive draws taken from the same test seed.
 */
export function createSeededDie(seed: number): () => number {
  const next = createSeededRandomInt((seed + 1) >>> 0);

  return () => next(6) + 1;
}
