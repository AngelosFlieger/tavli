import type { GameState, Move, Player } from '../game/engine';
import type { Command, Update } from '../net/messages';
import type { GameController } from './game-controller';
import { resolveVariantConfig } from '../game/variant/config/schema';
import { CLASSIC_RULES, powerupsRules, type ResolvedVariantConfig } from '../game/variant/types';

export type OnlineScene = {
  faceSeat: () => void;
  presentState: (resetDice?: boolean) => void;
  playRemoteMove: (sequence: Move[], checker: number, done: () => void) => void;
};

export type OnlineDice = {
  play: (values: [number, number], rerolledDie?: 0 | 1) => void;
  reset: () => void;
};

/** Orders authoritative updates around dice and checker presentation. */
export function createOnlineGameFlow(
  controller: GameController,
  scene: OnlineScene,
  dice: OnlineDice,
) {
  function adopt(state: GameState, canUndo: boolean, resetDice = false, preservePickup = false) {
    controller.adopt(state, canUndo, preservePickup);
    if (resetDice) dice.reset();
    scene.presentState(resetDice);
  }

  function finishRemoteMove() {
    const result = controller.finishRemoteMove();
    if (result) adopt(result.state, result.canUndo, false, true);
  }

  return {
    join(
      you: Player,
      send: (command: Command) => void,
      state: GameState,
      canUndo = false,
      variantConfig: ResolvedVariantConfig | null = null,
    ) {
      const rules = variantConfig
        ? powerupsRules(resolveVariantConfig(variantConfig))
        : CLASSIC_RULES;
      if (
        state.ruleset !== rules.ruleset ||
        state.variantConfigHash !== (rules.variantConfig?.hash ?? null)
      )
        throw new Error('matched state and variant configuration do not agree');
      if (!controller.configure(rules)) throw new Error('controller could not adopt match rules');
      controller.join(you, send, rules);
      controller.adopt(state, canUndo);
      scene.faceSeat();
      scene.presentState();
      dice.reset();
    },
    leave() {
      controller.leaveOnline();
      scene.faceSeat();
      dice.reset();
      scene.presentState(true);
    },
    receive(update: Update) {
      controller.recordAuthoritativeEvents(update.events, update.state);
      if (update.resetDice) {
        adopt(update.state, update.canUndo, true);
      } else if (update.dice) {
        controller.queueRoll(update.state, update.canUndo);
        dice.play(update.dice, update.rerolledDie);
      } else if (update.sequence) {
        const checker = controller.beginRemoteMove(update.sequence, update.state, update.canUndo);
        if (checker === null) adopt(update.state, update.canUndo);
        else scene.playRemoteMove(update.sequence, checker, finishRemoteMove);
      } else adopt(update.state, update.canUndo);
    },
    presentedRoll() {
      const result = controller.presentedRoll();
      if (result) adopt(result.state, result.canUndo);
    },
    finishRemoteMove,
  };
}
