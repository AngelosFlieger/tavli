export class TokenBucket {
  private tokens: number;
  private updatedAt: number;

  constructor(
    private readonly ratePerSecond: number,
    private readonly burst: number,
    now: number,
  ) {
    this.tokens = burst;
    this.updatedAt = now;
  }

  take(now: number, cost = 1): boolean {
    const elapsed = Math.max(0, now - this.updatedAt) / 1000;

    this.tokens = Math.min(this.burst, this.tokens + elapsed * this.ratePerSecond);
    this.updatedAt = now;

    if (this.tokens < cost) return false;

    this.tokens -= cost;

    return true;
  }
}

export function boundedBucket<K>(
  buckets: Map<K, TokenBucket>,
  key: K,
  ratePerSecond: number,
  burst: number,
  now: number,
): TokenBucket {
  const found = buckets.get(key);

  if (found) return found;
  if (buckets.size >= 10_000) buckets.clear();

  const bucket = new TokenBucket(ratePerSecond, burst, now);

  buckets.set(key, bucket);

  return bucket;
}
