import test from 'node:test';
import assert from 'node:assert/strict';
import { formatReadability } from '../scripts/readability.mjs';

test('separates setup, control flow, effects, and return phases', () => {
  const source = [
    'function update() {',
    '  const current = read();',
    '  if (!current) return null;',
    '  save(current);',
    '  return current;',
    '}',
    '',
  ].join('\n');

  const result = formatReadability(source);

  assert.equal(
    result.formatted,
    [
      'function update() {',
      '  const current = read();',
      '',
      '  if (!current) return null;',
      '',
      '  save(current);',
      '',
      '  return current;',
      '}',
      '',
    ].join('\n'),
  );
});

test('keeps related declarations and actions grouped', () => {
  const source = [
    'function update() {',
    '  const current = read();',
    '  const next = derive(current);',
    '',
    '  save(current);',
    '  publish(next);',
    '}',
    '',
  ].join('\n');

  assert.equal(formatReadability(source).formatted, source);
});

test('keeps a trailing explanation attached to its declaration', () => {
  const source = [
    'type Move = { to: number }; // -1 means bear off.',
    'type Player = 0 | 1;',
    '',
  ].join('\n');

  assert.equal(
    formatReadability(source).formatted,
    ['type Move = { to: number }; // -1 means bear off.', '', 'type Player = 0 | 1;', ''].join(
      '\n',
    ),
  );
});

test('is idempotent after applying its formatting', () => {
  const first = formatReadability('const value = read();\nreturn value;\n').formatted;

  assert.equal(formatReadability(first).formatted, first);
});
