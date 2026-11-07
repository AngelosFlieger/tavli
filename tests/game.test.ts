import './lobby.test.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Game,
  moveSequences,
  initialPosition,
  rawMoves,
  legalMoves,
  applyMove,
  canBearOff,
  pinned,
  outcome,
  owner,
  type Position,
} from '../src/game/engine';
import { PATHS, pointPosition } from '../src/game/points';
import { faces, landingRotation, upwardFace } from '../src/scene/dice';
const empty = (): Position => ({ board: Array.from({ length: 24 }, () => []), off: [[], []] });
const startTurn = (values: number[]) => {
  const g = new Game();
  g.beginRoll();
  g.receiveRoll([6, 6]);
  g.beginRoll();
  g.receiveRoll([1, 1]);
  g.beginRoll();
  g.receiveRoll(values);
  return g;
};
test('initial 15-checker positions are inside the leftmost physical points', () => {
  const p = initialPosition();
  assert.equal(p.board[0].length, 15);
  assert.equal(p.board[12].length, 15);
  assert.equal(p.board.flat().length, 30);
  assert.ok(Math.abs(pointPosition(0).x + 0.2265) < 1e-9);
  assert.ok(Math.abs(pointPosition(12).x + 0.2265) < 1e-9);
  assert.ok(pointPosition(0).z < 0);
  assert.ok(pointPosition(12).z > 0);
});
test('explicit opposite paths each cover exactly 24 physical points', () => {
  for (const path of PATHS) {
    assert.equal(new Set(path).size, 24);
    assert.deepEqual(
      [...path].sort((a, b) => a - b),
      Array.from({ length: 24 }, (_, i) => i),
    );
  }
  assert.deepEqual([...PATHS[0]].reverse(), [...PATHS[1]]);
  assert.equal(PATHS[0][23], 12);
  assert.equal(PATHS[1][23], 0);
});
test('each player rolls two dice, totals decide starter, ties replay both rolls', () => {
  const g = new Game();
  assert.equal(g.state.active, 0);
  assert.equal(g.beginRoll(), true);
  assert.equal(g.beginRoll(), false);
  g.receiveRoll([3, 4]);
  assert.equal(g.state.active, 1);
  assert.equal(g.state.phase, 'OPENING_ROLL');
  assert.deepEqual(g.state.openingRolls[0], [3, 4]);
  g.beginRoll();
  g.receiveRoll([5, 2]);
  assert.equal(g.state.phase, 'OPENING_ROLL');
  assert.equal(g.state.active, 0);
  assert.deepEqual(g.state.openingRolls, [null, null]);
  g.beginRoll();
  g.receiveRoll([2, 1]);
  g.beginRoll();
  g.receiveRoll([2, 5]);
  assert.equal(g.state.active, 1);
  assert.equal(g.state.phase, 'WAITING_FOR_ROLL');
  assert.deepEqual(g.state.remaining, []);
});
test('different dice allow independent steps and legal orderings', () => {
  const g = startTurn([3, 5]);
  assert.deepEqual(g.state.remaining, [3, 5]);
  assert.deepEqual(new Set(g.moves().map((m) => m.die)), new Set([3, 5]));
  const first = g.moves().find((m) => m.die === 3)!;
  g.move(first);
  g.finishAnimation();
  assert.deepEqual(g.state.remaining, [5]);
  assert.ok(g.moves().some((m) => m.from === first.to && m.to === 8));
});
test('doubles provide four actions', () => {
  assert.deepEqual(startTurn([4, 4]).state.remaining, [4, 4, 4, 4]);
});
test('blocked landing and illegal intermediate point are rejected', () => {
  const p = empty();
  p.board[1] = [0];
  p.board[3] = [15, 16];
  p.board[4] = [17, 18];
  assert.equal(rawMoves(p, 0, 2).length, 0);
  assert.equal(rawMoves(p, 0, 3).length, 0);
  assert.deepEqual(legalMoves(p, 0, [2, 3]), []);
});
test('maximum dice usage forbids a move that strands the other die', () => {
  const p = empty();
  p.board[1] = [0];
  p.board[2] = [15, 16];
  p.board[4] = [17, 18];
  // A 2 reaches 3, then 1 is blocked at 4. A 1 is blocked at 2, so only 2 can be used.
  assert.deepEqual(
    legalMoves(p, 0, [1, 2]).map((m) => m.die),
    [2],
  );
  const q = empty();
  q.board[1] = [0];
  q.board[6] = [15, 16];
  // Both individual dice work but their sum hits a block; higher die is mandatory.
  assert.deepEqual(
    legalMoves(q, 0, [2, 3]).map((m) => m.die),
    [3],
  );
});
test('sequence search requires both dice if a compatible branch exists', () => {
  const p = empty();
  p.board[1] = [0];
  p.board[4] = [1];
  p.board[6] = [15, 16];
  p.board[9] = [17, 18];
  const moves = legalMoves(p, 0, [2, 3]);
  for (const m of moves) {
    assert.ok(legalMoves(applyMove(p, 0, m), 0, [m.die === 2 ? 3 : 2]).length > 0);
  }
});
test('landing on a singleton pins without hitting; pinned point blocks its owner', () => {
  const p = empty();
  p.board[1] = [0];
  p.board[3] = [15];
  const q = applyMove(p, 0, { from: 1, to: 3, die: 2 });
  assert.deepEqual(q.board[3], [15, 0]);
  assert.equal(pinned(q, 1), true);
  assert.equal(
    rawMoves(q, 1, 1).some((m) => m.from === 3),
    false,
  );
  q.board[4] = [16];
  assert.equal(
    rawMoves(q, 1, 1).some((m) => m.to === 3),
    false,
  );
  assert.equal(q.off[1].length, 0);
});
test('multiple controllers maintain the pin until the last leaves', () => {
  const p = empty();
  p.board[3] = [15, 0, 1];
  const q = applyMove(p, 0, { from: 3, to: 4, die: 1 });
  assert.ok(pinned(q, 1));
  const r = applyMove(q, 0, { from: 3, to: 5, die: 2 });
  assert.equal(pinned(r, 1), false);
  assert.ok(rawMoves(r, 1, 1).some((m) => m.from === 3));
});
test('mother pin wins two points when own starting checkers have departed', () => {
  const p = empty();
  p.board[12] = [15, 0];
  assert.deepEqual(outcome(p), { winner: 0, points: 2, reason: 'Mother victory' });
});
test('mother exception continues until own start empties, both pinned is a draw', () => {
  const p = empty();
  p.board[12] = [15, 0];
  p.board[0] = [1];
  assert.equal(outcome(p), null);
  p.board[0] = [1, 16];
  assert.deepEqual(outcome(p), { winner: null, points: 0, reason: 'Both mothers pinned — draw' });
});
test('bearing off requires all remaining checkers home and none pinned', () => {
  const p = empty();
  p.board[12] = [0];
  p.board[17] = [1];
  assert.ok(canBearOff(p, 0));
  p.board[18] = [2];
  assert.equal(canBearOff(p, 0), false);
  p.board[18] = [];
  p.board[12] = [0, 15];
  assert.equal(canBearOff(p, 0), false);
});
test('exact bearing off and higher die only from highest occupied lower point', () => {
  const p = empty();
  p.board[14] = [0];
  p.board[16] = [1];
  assert.ok(rawMoves(p, 0, 3).some((m) => m.from === 14 && m.to === -1));
  assert.ok(rawMoves(p, 0, 6).some((m) => m.from === 16 && m.to === -1));
  assert.equal(
    rawMoves(p, 0, 6).some((m) => m.from === 14 && m.to === -1),
    false,
  );
});
test('home moves may be chosen instead of bearing off and lower dice move forward', () => {
  const p = empty();
  p.board[16] = [0];
  assert.ok(rawMoves(p, 0, 2).some((m) => m.to === 14));
  p.board[14] = [1];
  assert.ok(rawMoves(p, 0, 3).some((m) => m.from === 14 && m.to === -1));
  assert.ok(rawMoves(p, 0, 3).some((m) => m.from === 16 && m.to === 13));
});
test('normal win awards one, Mars awards two', () => {
  const p = empty();
  p.off[0] = Array.from({ length: 15 }, (_, i) => i);
  p.off[1] = [15];
  assert.equal(outcome(p)?.points, 1);
  p.off[1] = [];
  assert.equal(outcome(p)?.points, 2);
});
test('turns lock rolling, animate moves, enable end only after compulsory moves', () => {
  const g = startTurn([1, 2]);
  assert.equal(g.beginRoll(), false);
  assert.equal(g.endTurn(), false);
  while (g.state.phase === 'WAITING_FOR_MOVE') {
    assert.ok(g.move(g.moves()[0]));
    assert.equal(g.state.phase, 'ANIMATING_MOVE');
    assert.equal(g.undo(), false);
    g.finishAnimation();
  }
  assert.equal(g.state.phase, 'TURN_COMPLETE');
  assert.ok(g.endTurn());
  assert.equal(g.state.active, 1);
  assert.equal(g.state.phase, 'WAITING_FOR_ROLL');
  assert.equal(g.history.length, 0);
});
test('no legal moves automatically passes', () => {
  const g = new Game();
  g.state = { ...g.state, ...empty(), active: 0, opening: false, phase: 'WAITING_FOR_ROLL' };
  g.state.board[1] = [0];
  g.state.board[2] = [15, 16];
  g.state.board[3] = [17, 18];
  g.beginRoll();
  g.receiveRoll([1, 2]);
  assert.equal(g.state.active, 1);
  assert.equal(g.state.phase, 'WAITING_FOR_ROLL');
});
test('undo restores board, pins, dice and legal moves for the current turn', () => {
  const g = startTurn([2, 3]);
  g.state.board = empty().board;
  g.state.board[1] = [0];
  g.state.board[3] = [15];
  const before = structuredClone(g.state);
  const allowed = g.moves();
  const move = allowed.find((m) => m.to === 3)!;
  assert.ok(move);
  g.move(move);
  g.finishAnimation();
  assert.ok(pinned(g.state, 1));
  assert.ok(g.undo());
  assert.deepEqual(g.state, before);
  assert.deepEqual(g.moves(), allowed);
});
test('single game finishes without match scoring and can be restarted', () => {
  const g = new Game();
  g.state = {
    ...g.state,
    ...empty(),
    active: 0,
    opening: false,
    phase: 'WAITING_FOR_MOVE',
    remaining: [1],
  };
  g.state.off[0] = Array.from({ length: 14 }, (_, i) => i);
  g.state.board[12] = [14];
  assert.ok(g.move({ from: 12, to: -1, die: 1 }));
  g.finishAnimation();
  assert.equal(g.state.phase, 'GAME_OVER');
  assert.equal(g.state.outcome?.winner, 0);
  assert.equal('scores' in g.state, false);
  g.reset();
  assert.equal(g.state.active, 0);
  assert.equal(g.state.phase, 'OPENING_ROLL');
  assert.equal(g.state.board[0].length, 15);
});
test('all modeled die face normals read correctly at all tested yaw angles', () => {
  for (const face of faces)
    for (let yaw = 0; yaw < Math.PI * 2; yaw += 0.1)
      assert.equal(upwardFace(landingRotation(face.value, yaw)), face.value);
});
test('long deterministic legal play conserves all 30 checkers and completes', () => {
  const g = new Game();
  g.beginRoll();
  g.receiveRoll([6, 6]);
  g.beginRoll();
  g.receiveRoll([1, 1]);
  let seed = 51,
    turns = 0;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed;
  };
  while (g.state.phase !== 'GAME_OVER' && turns < 2000) {
    if (g.state.phase === 'WAITING_FOR_ROLL') {
      g.beginRoll();
      g.receiveRoll([(random() % 6) + 1, (random() % 6) + 1]);
      turns++;
    } else if (g.state.phase === 'WAITING_FOR_MOVE') {
      const moves = g.moves();
      assert.ok(moves.length);
      g.move(moves[random() % moves.length]);
      g.finishAnimation();
    } else if (g.state.phase === 'TURN_COMPLETE') g.endTurn();
    else throw Error(g.state.phase);
    const ids = [...g.state.board.flat(), ...g.state.off.flat()];
    assert.equal(ids.length, 30);
    assert.equal(new Set(ids).size, 30);
  }
  assert.equal(g.state.phase, 'GAME_OVER');
});

test('doubles exhaust all four available movements before ending', () => {
  const g = startTurn([4, 4]);
  let used = 0;
  while (g.state.phase === 'WAITING_FOR_MOVE') {
    g.move(g.moves()[0]);
    g.finishAnimation();
    used++;
  }
  assert.equal(used, 4);
  assert.equal(g.state.phase, 'TURN_COMPLETE');
  assert.equal(g.state.remaining.length, 0);
});
test('a blocked larger die does not suppress the only playable smaller die', () => {
  const p = empty();
  p.board[1] = [0];
  p.board[4] = [15, 16];
  p.board[6] = [17, 18];
  assert.deepEqual(
    legalMoves(p, 0, [2, 3]).map((m) => m.die),
    [2],
  );
});

test('combined 4 + 2 move consumes both dice and undoes in one action', () => {
  const g = startTurn([4, 2]),
    before = structuredClone(g.state);
  const sequence = moveSequences(g.state, 0, g.state.remaining, 0).find(
    (s) => s.length === 2 && s.at(-1)!.to === 6,
  )!;
  assert.ok(sequence);
  assert.equal(g.moveSequence(sequence)?.length, 2);
  g.finishAnimation();
  assert.equal(g.state.board[6].length, 1);
  assert.equal(g.state.remaining.length, 0);
  assert.equal(g.state.phase, 'TURN_COMPLETE');
  assert.equal(g.history.length, 1);
  assert.ok(g.undo());
  assert.deepEqual(g.state, before);
});
test('combined moves use the alternate die order if its intermediate point is open', () => {
  const p = empty();
  p.board[1] = [0];
  p.board[5] = [15, 16];
  const sequence = moveSequences(p, 0, [4, 2], 1).find((s) => s.at(-1)!.to === 7)!;
  assert.ok(sequence);
  assert.deepEqual(
    sequence.map((m) => m.die),
    [2, 4],
  );
  p.board[3] = [17, 18];
  assert.equal(
    moveSequences(p, 0, [4, 2], 1).some((s) => s.at(-1)!.to === 7),
    false,
  );
});
test('doubles expose combined destinations of two, three and four steps', () => {
  const g = startTurn([2, 2]),
    sequences = moveSequences(g.state, 0, g.state.remaining, 0);
  for (const steps of [1, 2, 3, 4])
    assert.ok(sequences.some((s) => s.length === steps && s.at(-1)!.to === steps * 2));
});
test('combined moves cannot skip a mother victory or switch checker', () => {
  const p = empty();
  p.board[14] = [0];
  p.board[12] = [15];
  assert.equal(
    moveSequences(p, 0, [2, 1], 14).some((s) => s[0].die === 2 && s.length > 1),
    false,
  );
  const g = startTurn([2, 4]),
    before = structuredClone(g.state);
  assert.equal(
    g.moveSequence([
      { from: 0, to: 2, die: 2 },
      { from: 0, to: 4, die: 4 },
    ]),
    null,
  );
  assert.deepEqual(g.state, before);
});

test('portrait layout adapts board proportions without changing logical paths', async () => {
  const { boardLayout } = await import('../src/scene/layout');
  assert.deepEqual(boardLayout(false, false, 1.7), { depth: 1, stackSlots: 5 });
  assert.deepEqual(boardLayout(true, true, 0.6), { depth: 1, stackSlots: 5 });
  assert.deepEqual(boardLayout(true, false, 0.6), { depth: 2.6, stackSlots: 7 });
  assert.equal(boardLayout(true, false, 1.2).depth, 1.6 / 1.2);
  assert.equal(PATHS[0].length, 24);
  assert.equal(PATHS[1].length, 24);
});
test('board framing maps to the UI rectangle while keeping picking aligned', async () => {
  const { applyBoardViewport } = await import('../src/scene/layout');
  const { OrthographicCamera, Vector3, Raycaster, Vector2, Plane } = await import('three');
  const camera = new OrthographicCamera(-2, 2, 2, -2, 0.1, 20);
  camera.position.set(0, 0, 5);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const frame = { left: 5, top: 146, width: 380, height: 579 };
  applyBoardViewport(camera, frame, 390, 844);
  const expectedX = ((frame.left + frame.width / 2) / 390) * 2 - 1,
    expectedY = 1 - ((frame.top + frame.height / 2) / 844) * 2;
  const screen = new Vector3(0, 0, 0).project(camera);
  assert.ok(Math.abs(screen.x - expectedX) < 1e-9);
  assert.ok(Math.abs(screen.y - expectedY) < 1e-9);
  const ray = new Raycaster();
  ray.setFromCamera(new Vector2(expectedX, expectedY), camera);
  const hit = ray.ray.intersectPlane(new Plane(new Vector3(0, 0, 1), 0), new Vector3())!;
  assert.ok(hit.distanceTo(new Vector3()) < 1e-8);
});
