import type { Move } from '../game/engine';
import { GameController, type LocalMoveRequest } from './game-controller';

/** The presentation operations needed after a user command is accepted. */
export type ActionScene = {
  isSetupActive: () => boolean;
  refresh: (updatePositions?: boolean) => void;
  startSetup: () => void;
  playLocalMove: (sequence: Move[], request: LocalMoveRequest, done: () => void) => void;
};

export type ActionDice = { reset: () => void };

/** Sequences local presentation and online command waits without scene dependencies. */
export function createGameplayActions(
  controller: GameController,
  scene: ActionScene,
  dice: ActionDice,
) {
  const setupLocked = () => scene.isSetupActive();
  let pendingMoveCompletion: (() => void) | null = null;

  return {
    move(sequence: Move[]) {
      const request = controller.requestMove(sequence, setupLocked());
      if (!request) return;
      if (request.type === 'sent') {
        scene.refresh(false);
        return;
      }
      const complete = () => {
        if (pendingMoveCompletion !== complete) return;
        pendingMoveCompletion = null;
        controller.finishLocalMove();
        scene.refresh();
      };
      pendingMoveCompletion = complete;
      scene.playLocalMove(sequence, request, complete);
      scene.refresh(false);
    },
    undo() {
      if (controller.undo(setupLocked()) && !controller.scripted) scene.refresh();
    },
    restart() {
      if (controller.restart(setupLocked()) !== 'local') return;
      scene.startSetup();
      dice.reset();
      scene.refresh();
    },
    canRestart: () => controller.canRestart(setupLocked()),
    beginRoll() {
      const accepted = controller.beginRoll(setupLocked());
      if (accepted) scene.refresh(false);
      return accepted;
    },
    receiveRoll(values: number[]) {
      controller.receiveRoll(values);
      scene.refresh();
    },
    finishTurn() {
      if (!controller.endTurn(setupLocked())) return false;
      if (!controller.scripted) scene.refresh();
      return true;
    },
    finishInterruptedMove() {
      if (!controller.hasLocalMove) return;
      if (pendingMoveCompletion) {
        pendingMoveCompletion();
        return;
      }
      controller.finishLocalMove();
      scene.refresh();
    },
  };
}
