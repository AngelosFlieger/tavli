import test from 'node:test';
import assert from 'node:assert/strict';
import { GameController } from '../src/app/game-controller';
import {
  createOnlineGameFlow,
  type OnlineDice,
  type OnlineScene,
} from '../src/app/online-game-flow';
import type { Move } from '../src/game/engine';
import { initialGameState } from '../src/game/session/state';
import { POWERUPS_V1 } from '../src/game/variant/config/profiles';
import { powerupsRules } from '../src/game/variant/types';
import { PresentationCoordinator } from '../src/app/presentation-coordinator';
import { resolvedOpeningState } from './support/resolved-opening';

const cursor = { matchId: 'match-1', revision: 0 } as const;
const update = <T extends object>(revision: number, value: T) => ({
  matchId: cursor.matchId,
  revision,
  presentations: [],
  ...value,
});

test('online opening adopts resolved authority before presenting all paired attempts', () => {
  const controller = new GameController();
  const presentation = new PresentationCoordinator();
  const calls: string[] = [];
  const state = structuredClone(controller.state);
  state.opening = {
    status: 'RESOLVED',
    attempts: [
      [4, 4],
      [6, 1],
    ],
    winner: 0,
  };
  state.phase = 'WAITING_FOR_ROLL';
  state.active = 0;
  state.roll = [6, 1];
  const scene: OnlineScene = {
    faceSeat() {},
    presentState() {
      calls.push('present');
    },
    playRemoteMove() {},
  };
  const dice: OnlineDice = {
    play() {},
    playOpening(attempts) {
      calls.push(`opening-${attempts.map((attempt) => attempt.join('-')).join('_')}`);
    },
    reset() {},
  };
  const flow = createOnlineGameFlow(controller, scene, dice, presentation);
  flow.join(0, () => {}, state, false, null, cursor, [
    { type: 'OPENING', blocking: true, attempts: state.opening.attempts },
  ]);

  assert.equal(controller.state.phase, 'WAITING_FOR_ROLL');
  assert.equal(presentation.blocking, false);
  assert.deepEqual(calls, ['present']);
  flow.presentInitial();
  assert.equal(presentation.blocking, true);
  assert.equal(calls.at(-1), 'opening-4-4_6-1');
  flow.presentedRoll();
  assert.equal(presentation.blocking, false);
  assert.equal(calls.at(-1), 'present');
});

test('online opening cannot retain an input lock when its renderer is unavailable', () => {
  const controller = new GameController();
  const presentation = new PresentationCoordinator();
  const state = structuredClone(controller.state);
  state.opening = { status: 'RESOLVED', attempts: [[6, 1]], winner: 0 };
  state.phase = 'WAITING_FOR_ROLL';
  state.active = 0;
  state.roll = [6, 1];
  const scene: OnlineScene = {
    faceSeat() {},
    presentState() {},
    playRemoteMove() {},
  };
  const dice: OnlineDice = { play() {}, reset() {} };
  const flow = createOnlineGameFlow(controller, scene, dice, presentation);
  flow.join(0, () => {}, state, false, null, cursor, [
    { type: 'OPENING', blocking: true, attempts: state.opening.attempts },
  ]);
  flow.presentInitial();
  assert.equal(presentation.blocking, false);
});

test('online flow adopts authority immediately while presentations block input', () => {
  const controller = new GameController();
  const presentation = new PresentationCoordinator();
  const calls: string[] = [];
  let completeMove = () => {};
  let moveStart: number[] = [];
  const scene: OnlineScene = {
    faceSeat: () => calls.push('face'),
    presentState: (resetDice) => calls.push(resetDice ? 'present-reset' : 'present'),
    playRemoteMove: (_sequence: Move[], checker: number, start, done: () => void) => {
      calls.push(`animate-${checker}`);
      moveStart = [...start.board[0]];
      completeMove = done;
    },
  };
  const dice: OnlineDice = {
    play: (values, rerolledDie) =>
      calls.push(
        `dice-${values.join('-')}${rerolledDie === undefined ? '' : `-only-${rerolledDie}`}`,
      ),
    reset: () => calls.push('dice-reset'),
  };
  const flow = createOnlineGameFlow(controller, scene, dice, presentation);
  flow.join(0, () => {}, controller.state, false, null, cursor);
  assert.deepEqual(calls, ['face', 'present', 'dice-reset']);
  assert.equal(controller.seat, 0);

  const rolled = structuredClone(controller.state);
  rolled.active = 1;
  flow.receive(
    update(1, {
      state: rolled,
      canUndo: false,
      presentations: [{ type: 'DICE' as const, blocking: true as const, values: [2, 3] }],
    }),
  );
  assert.equal(controller.state.active, 1);
  assert.equal(controller.busy, false);
  assert.equal(presentation.blocking, true);
  assert.equal(calls.at(-1), 'dice-2-3');
  flow.presentedRoll();
  assert.equal(controller.state.active, 1);
  assert.equal(presentation.blocking, false);

  flow.receive(
    update(2, {
      state: controller.state,
      canUndo: false,
      presentations: [
        {
          type: 'DICE' as const,
          blocking: true as const,
          values: [4, 3] as [number, number],
          rerolledDie: 0 as const,
        },
      ],
    }),
  );
  assert.equal(calls.at(-1), 'dice-4-3-only-0');
  flow.presentedRoll();

  const ready = structuredClone(controller.state);
  ready.active = 0;
  ready.opening = { status: 'RESOLVED', attempts: [[6, 1]], winner: 0 };
  ready.phase = 'WAITING_FOR_MOVE';
  ready.remaining = [2];
  flow.receive(update(3, { state: ready, canUndo: false }));
  const moved = structuredClone(ready);
  moved.board[2] = [moved.board[0].pop()!];
  moved.remaining = [];
  moved.phase = 'TURN_COMPLETE';
  flow.receive(
    update(4, {
      state: moved,
      canUndo: true,
      presentations: [
        {
          type: 'MOVE' as const,
          blocking: true as const,
          sequence: [{ from: 0, to: 2, die: 2 }],
        },
      ],
    }),
  );
  assert.equal(controller.busy, false);
  assert.equal(presentation.blocking, true);
  assert.deepEqual(controller.state.board[2], [14]);
  assert.equal(moveStart.at(-1), 14);
  assert.equal(calls.at(-1), 'animate-14');
  completeMove();
  assert.deepEqual(controller.state.board[2], [14]);
  assert.equal(controller.state.phase, 'TURN_COMPLETE');
  assert.equal(controller.busy, false);
  assert.equal(presentation.blocking, false);
  assert.equal(controller.canUndo, true);

  flow.receive(
    update(5, {
      state: controller.state,
      canUndo: false,
      presentations: [{ type: 'RESET_DICE' as const, blocking: false as const }],
    }),
  );
  assert.deepEqual(calls.slice(-2), ['dice-reset', 'present-reset']);
  flow.leave();
  assert.equal(controller.seat, null);
  assert.equal(controller.state.phase, 'OPENING');
  const afterLeave = calls.length;
  flow.receive(update(6, { state: rolled, canUndo: false }));
  assert.equal(controller.state.phase, 'OPENING');
  assert.equal(calls.length, afterLeave);
});

test('interrupted remote presentation adopts once and ignores a late completion', () => {
  const controller = new GameController();
  const presentation = new PresentationCoordinator();
  let done = () => {};
  let presents = 0;
  const scene: OnlineScene = {
    faceSeat() {},
    presentState() {
      presents++;
    },
    playRemoteMove(_sequence, _checker, _start, complete) {
      done = complete;
    },
  };
  const dice: OnlineDice = { play() {}, reset() {} };
  const flow = createOnlineGameFlow(controller, scene, dice, presentation);
  flow.join(0, () => {}, controller.state, false, null, cursor);
  const ready = structuredClone(controller.state);
  ready.opening = { status: 'RESOLVED', attempts: [[6, 1]], winner: 0 };
  ready.phase = 'WAITING_FOR_MOVE';
  ready.remaining = [2];
  flow.receive(update(1, { state: ready, canUndo: false }));
  const moved = structuredClone(ready);
  moved.board[2] = [moved.board[0].pop()!];
  moved.remaining = [];
  moved.phase = 'TURN_COMPLETE';
  flow.receive(
    update(2, {
      state: moved,
      canUndo: true,
      presentations: [
        {
          type: 'MOVE' as const,
          blocking: true as const,
          sequence: [{ from: 0, to: 2, die: 2 }],
        },
      ],
    }),
  );
  assert.equal(presentation.blocking, true);
  flow.finishRemoteMove();
  assert.deepEqual(controller.state.board[2], [14]);
  assert.equal(controller.busy, false);
  assert.equal(presentation.blocking, false);
  const afterInterruption = presents;
  done();
  assert.equal(presents, afterInterruption);
});

test('a newer authoritative update cancels an unfinished dice presentation', () => {
  const controller = new GameController();
  const presentation = new PresentationCoordinator();
  let resets = 0;
  let presents = 0;
  const flow = createOnlineGameFlow(
    controller,
    {
      faceSeat() {},
      presentState() {
        presents++;
      },
      playRemoteMove() {},
    },
    {
      play() {},
      reset() {
        resets++;
      },
    },
    presentation,
  );
  flow.join(0, () => {}, controller.state, false, null, cursor);

  const rolled = structuredClone(controller.state);
  rolled.active = 1;
  flow.receive(
    update(1, {
      state: rolled,
      canUndo: false,
      presentations: [{ type: 'DICE' as const, blocking: true as const, values: [2, 3] }],
    }),
  );
  assert.equal(presentation.blocking, true);
  const resetBeforeInterruption = resets;

  const newer = structuredClone(rolled);
  newer.phase = 'WAITING_FOR_ROLL';
  flow.receive(update(2, { state: newer, canUndo: false }));

  assert.equal(controller.state.phase, 'WAITING_FOR_ROLL');
  assert.equal(presentation.blocking, false);
  assert.equal(resets, resetBeforeInterruption + 1);
  const afterInterruption = presents;
  flow.presentedRoll();
  assert.equal(presents, afterInterruption);
});

test('online flow ignores older revisions and updates from another match', () => {
  const controller = new GameController();
  let presentations = 0;
  const flow = createOnlineGameFlow(
    controller,
    {
      faceSeat() {},
      presentState() {
        presentations++;
      },
      playRemoteMove() {},
    },
    { play() {}, reset() {} },
  );
  flow.join(0, () => {}, controller.state, false, null, cursor);
  const current = structuredClone(controller.state);
  current.active = 1;
  flow.receive(update(2, { state: current, canUndo: false }));
  assert.equal(controller.state.active, 1);
  const afterCurrent = presentations;

  const stale = structuredClone(current);
  stale.active = 0;
  flow.receive(update(1, { state: stale, canUndo: false }));
  flow.receive({
    matchId: 'another-match',
    revision: 3,
    state: stale,
    canUndo: false,
    presentations: [],
  });

  assert.equal(controller.state.active, 1);
  assert.equal(presentations, afterCurrent);
});

test('only the matching command result releases an online operation', () => {
  const controller = new GameController();
  const requests: { commandId: string }[] = [];
  const flow = createOnlineGameFlow(
    controller,
    { faceSeat() {}, presentState() {}, playRemoteMove() {} },
    { play() {}, reset() {} },
  );
  flow.join(0, (request) => requests.push(request), resolvedOpeningState(), false, null, cursor);

  assert.equal(controller.beginRoll(), true);
  const first = requests.at(-1)!.commandId;
  flow.receive({
    ...cursor,
    state: controller.state,
    canUndo: false,
    presentations: [],
    commandResult: { commandId: first, status: 'REJECTED', reason: 'INVALID_COMMAND' },
  });
  assert.equal(controller.busy, false);

  assert.equal(controller.beginRoll(), true);
  const second = requests.at(-1)!.commandId;
  assert.notEqual(second, first);
  flow.receive({
    ...cursor,
    state: controller.state,
    canUndo: false,
    presentations: [],
    commandResult: { commandId: first, status: 'REJECTED', reason: 'STALE_REVISION' },
  });
  assert.equal(controller.busy, true);

  flow.receive({
    ...cursor,
    state: controller.state,
    canUndo: false,
    presentations: [],
    commandResult: { commandId: second, status: 'REJECTED', reason: 'INVALID_COMMAND' },
  });
  assert.equal(controller.busy, false);
});

test('online join rejects a state without its matching rules snapshot', () => {
  const controller = new GameController();
  const scene: OnlineScene = {
    faceSeat() {},
    presentState() {},
    playRemoteMove() {},
  };
  const dice: OnlineDice = { play() {}, reset() {} };
  const flow = createOnlineGameFlow(controller, scene, dice);
  const state = initialGameState(powerupsRules(POWERUPS_V1));

  assert.throws(() => flow.join(0, () => {}, state, false, null), /do not agree/);
  assert.doesNotThrow(() => flow.join(0, () => {}, state, false, POWERUPS_V1));
});
