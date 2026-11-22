import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerConfig } from '../server/config';
import { boundedBucket, TokenBucket } from '../src/net/rate-limit';

test('server configuration rejects unsafe values and honours static mode', () => {
  const dev = loadServerConfig({});

  assert.equal(dev.port, 3001);
  assert.equal(dev.production, false);
  assert.equal(dev.databaseName, 'plakoto');

  const production = loadServerConfig({}, ['node', 'server', '--static']);

  assert.equal(production.port, 3000);
  assert.equal(production.production, true);
  assert.throws(() => loadServerConfig({ PORT: '99999' }), /PORT/);
  assert.throws(() => loadServerConfig({ PLAKOTO_DB_NAME: 'bad name' }), /DB_NAME/);
  assert.throws(() => loadServerConfig({ PLAKOTO_MONGO_URL: 'http://localhost' }), /mongodb:/);
  assert.equal(loadServerConfig({ PLAKOTO_CLOCK: 'off' }).clock.enabled, false);
});

test('token buckets enforce burst, refill over time, and stay bounded', () => {
  const bucket = new TokenBucket(2, 3, 1_000);

  assert.equal(bucket.take(1_000), true);
  assert.equal(bucket.take(1_000), true);
  assert.equal(bucket.take(1_000), true);
  assert.equal(bucket.take(1_000), false);
  assert.equal(bucket.take(1_500), true);
  assert.equal(bucket.take(1_500), false);
  assert.equal(bucket.take(2_000), true);
  assert.equal(bucket.take(2_000), false);
  assert.equal(bucket.take(3_000), true);
  assert.equal(bucket.take(3_000), true);
  assert.equal(bucket.take(3_000), false);
  assert.equal(bucket.take(4_000), true);
  assert.equal(bucket.take(4_000), true);
  assert.equal(bucket.take(4_000), false);

  const buckets = new Map<string, TokenBucket>();

  for (let index = 0; index < 10_001; index++) boundedBucket(buckets, `ip-${index}`, 1, 1, 1_000);

  assert.equal(buckets.size, 1);
});
