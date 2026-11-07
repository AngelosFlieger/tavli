import test from 'node:test';
import assert from 'node:assert/strict';
import { createHomeWorld } from '../src/scene/home-physics';

test('decorative checkers fall, settle on the original felt and stay stable', () => {
  const { world, checker } = createHomeWorld({ x: 0, y: 0, z: 0 }, 15.625);
  const body = checker(0.245, 0.1875);
  body.position.set(2, 5, 0);
  for (let i = 0; i < 1200; i++) world.step(1 / 120);
  assert.ok(Math.abs(body.position.y - (0.0275 * 15.625 + 0.1875 / 2)) < 0.025);
  assert.ok(body.velocity.length() < 0.05);
});

test('a checker missing the board falls away without an invisible floor', () => {
  const { world, checker } = createHomeWorld({ x: 0, y: 0, z: 0 }, 15.625);
  const body = checker(0.245, 0.1875);
  body.position.set(6, 5, 0);
  for (let i = 0; i < 360; i++) world.step(1 / 120);
  assert.ok(body.position.y < -12);
});
