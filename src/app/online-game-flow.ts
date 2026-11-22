import type { GameState, Move, Player, Position } from '../game/engine';
import type { AuthorityCursor, CommandRequest, RevisionedUpdate } from '../net/messages';
import type { GameController } from './game-controller';
import { rulesForState } from '../game/variant/rules-context';
import type { ResolvedVariantConfig } from '../game/variant/types';
import { PresentationCoordinator, type PresentationTicket } from './presentation-coordinator';

export type OnlineScene = {
  faceSeat: () => void;
  presentState: (resetDice?: boolean) => void;
  startSetup?: (complete?: () => void) => void;
  playRemoteMove: (sequence: Move[], checker: number, start: Position, done: () => void) => void;
};

export type OnlineDice = {
  play: (values: [number, number], rerolledDie?: 0 | 1) => void;
  playOpening?: (attempts: [number, number][]) => void;
  reset: () => void;
};

/** Orders authoritative updates around dice and checker presentation. */
export function createOnlineGameFlow(
  controller: GameController,
  scene: OnlineScene,
  dice: OnlineDice,
  presentation = new PresentationCoordinator(),
) {
  let joined = false;
  let cursor: AuthorityCursor | null = null;
  let handledCommandResult: (AuthorityCursor & { commandId: string }) | null = null;
  let rollTicket: PresentationTicket | null = null;
  let moveTicket: PresentationTicket | null = null;
  let pendingOpening: [number, number][] | null = null;

  function cancelPresentation() {
    const kind = presentation.kind;
    presentation.cancel();
    rollTicket = null;
    moveTicket = null;
    if (kind === 'DICE') dice.reset();
  }

  function adoptAndPresent(
    state: GameState,
    canUndo: boolean,
    resetDice = false,
    preservePickup = false,
  ) {
    cancelPresentation();
    controller.adopt(state, canUndo, preservePickup);
    if (resetDice) dice.reset();
    scene.presentState(resetDice);
  }

  function finishRemoteMove() {
    const ticket = moveTicket;
    moveTicket = null;
    if (ticket && presentation.complete(ticket)) scene.presentState();
  }

  function playOpening(attempts: [number, number][]) {
    if (!dice.playOpening) {
      scene.presentState();
      return;
    }
    rollTicket = presentation.begin('DICE');
    dice.playOpening(attempts);
  }

  const startsNewMatch = (update: RevisionedUpdate) =>
    update.presentations.some((job) => job.type === 'RESET_DICE' || job.type === 'OPENING');

  return {
    join(
      you: Player,
      send: (request: CommandRequest) => void,
      state: GameState,
      canUndo = false,
      variantConfig: ResolvedVariantConfig | null = null,
      authorityCursor: AuthorityCursor | null = null,
      presentations: RevisionedUpdate['presentations'] = [],
      events?: RevisionedUpdate['events'],
    ) {
      joined = true;
      const rules = rulesForState(state, variantConfig);
      if (!controller.configure(rules)) throw new Error('controller could not adopt match rules');
      controller.join(you, send, rules);
      controller.adopt(state, canUndo);
      controller.recordAuthoritativeEvents(events, state);
      cursor = authorityCursor;
      handledCommandResult = null;
      cancelPresentation();
      scene.faceSeat();
      scene.presentState();
      dice.reset();
      const opening = presentations.find((job) => job.type === 'OPENING');
      pendingOpening = opening?.attempts ?? null;
    },
    presentInitial() {
      if (!pendingOpening) return;
      const attempts = pendingOpening;
      pendingOpening = null;
      playOpening(attempts);
    },
    leave() {
      joined = false;
      cursor = null;
      handledCommandResult = null;
      pendingOpening = null;
      cancelPresentation();
      controller.leaveOnline();
      scene.faceSeat();
      dice.reset();
      scene.presentState(true);
    },
    receive(update: RevisionedUpdate) {
      if (!joined) return;
      if (
        cursor &&
        update.matchId !== cursor.matchId &&
        !(startsNewMatch(update) && update.revision === 0)
      )
        return;
      if (cursor && update.matchId === cursor.matchId && update.revision < cursor.revision) return;
      if (cursor && update.matchId === cursor.matchId && update.revision === cursor.revision) {
        const result = update.commandResult;
        if (!result || result.commandId !== controller.pendingOnlineCommandId) return;
        if (
          handledCommandResult?.matchId === update.matchId &&
          handledCommandResult.revision === update.revision &&
          handledCommandResult.commandId === result.commandId
        )
          return;
      }
      handledCommandResult = update.commandResult
        ? {
            matchId: update.matchId,
            revision: update.revision,
            commandId: update.commandResult.commandId,
          }
        : null;
      cursor = { matchId: update.matchId, revision: update.revision };
      controller.recordAuthoritativeEvents(update.events, update.state);
      const job = update.presentations[0];
      if (job?.type === 'RESET_DICE') {
        adoptAndPresent(update.state, update.canUndo, true);
      } else if (job?.type === 'OPENING') {
        cancelPresentation();
        controller.adopt(update.state, update.canUndo);
        scene.presentState();
        const present = () => playOpening(job.attempts);
        if (scene.startSetup) scene.startSetup(present);
        else present();
      } else if (job?.type === 'DICE') {
        cancelPresentation();
        rollTicket = presentation.begin('DICE');
        controller.adopt(update.state, update.canUndo);
        scene.presentState();
        dice.play(job.values, job.rerolledDie);
      } else if (job?.type === 'MOVE') {
        const checker = controller.state.board[job.sequence[0]?.from]?.at(-1);
        if (checker === undefined) adoptAndPresent(update.state, update.canUndo);
        else {
          const start: Position = {
            board: controller.state.board.map((stack) => [...stack]),
            off: controller.state.off.map((tray) => [...tray]) as Position['off'],
          };
          cancelPresentation();
          moveTicket = presentation.begin('REMOTE_MOVE');
          controller.pickup.consume(checker);
          controller.adopt(update.state, update.canUndo, true);
          scene.playRemoteMove(job.sequence, checker, start, finishRemoteMove);
        }
      } else adoptAndPresent(update.state, update.canUndo);
    },
    presentedRoll() {
      const ticket = rollTicket;
      rollTicket = null;
      if (ticket && presentation.complete(ticket)) scene.presentState();
    },
    finishRemoteMove,
    hasRemoteMove: () => presentation.kind === 'REMOTE_MOVE',
  };
}
