import type { GameState, Player } from '../game/engine';
import type {
  AuthorityCursor,
  ClientErrorCode,
  CommandRequest,
  RevisionedCommand,
  RevisionedUpdate,
} from '../net/messages';
import { CLASSIC_SELECTION, type MatchSelection } from '../net/messages';
import type { GameController } from './game-controller';
import { rulesForSelection } from '../game/variant/rules-context';
import type { ResolvedVariantConfig } from '../game/variant/types';
import { createSeededRandomInt } from '../game/random';
import { t } from '../ui/i18n';

export type MatchEvents = {
  onReady: (name: string) => void;
  onResume: (
    you: Player,
    players: [string, string],
    state: GameState,
    canUndo: boolean,
    variantConfig: ResolvedVariantConfig | null,
    cursor: AuthorityCursor,
    presentations?: RevisionedUpdate['presentations'],
    events?: RevisionedUpdate['events'],
  ) => void;
  onRejected: () => void;
  onReconnect: () => void;
  onWaiting: () => void;
  onRoom: (code: string) => void;
  onMatched: (
    you: Player,
    players: [string, string],
    state: GameState,
    variantConfig: ResolvedVariantConfig | null,
    cursor: AuthorityCursor,
    presentations?: RevisionedUpdate['presentations'],
    events?: RevisionedUpdate['events'],
  ) => void;
  onUpdate: (update: RevisionedUpdate) => void;
  onError: (code: ClientErrorCode) => void;
  onRematch: (status: 'OFFERED' | 'DECLINED') => void;
  onLeft: () => void;
  onClose: () => void;
};

export type MatchTransport = {
  connect: () => void;
  find: (selection?: MatchSelection) => void;
  createRoom: (selection?: MatchSelection) => void;
  joinRoom: (code: string) => void;
  cancel: () => void;
  send: (command: RevisionedCommand) => void;
  abandon: () => void;
};

export type MatchFlow = {
  join: (
    you: Player,
    send: (request: CommandRequest) => void,
    state: GameState,
    canUndo?: boolean,
    variantConfig?: ResolvedVariantConfig | null,
    cursor?: AuthorityCursor,
    presentations?: RevisionedUpdate['presentations'],
    events?: RevisionedUpdate['events'],
  ) => void;
  receive: (update: RevisionedUpdate) => void;
  presentInitial?: () => void;
  leave: () => void;
};

export type MatchScene = {
  startSetup: (complete?: () => void) => void;
  presentOpening?: (attempts: [number, number][]) => void;
  setPlayerNames?: (players: [string, string] | null) => void;
};

export type MatchUi = {
  setSearching: (searching: boolean, status?: 'CONNECTING' | 'SEARCHING') => void;
  showNote: (message: string | null) => void;
  showRoom: (code: string) => void;
  enterTable: () => void;
  showTitle: () => void;
  signedOut: () => void;
};

type MatchLifecycle =
  { type: 'IDLE' } | { type: 'SEARCHING' } | { type: 'PLAYING'; cursor: AuthorityCursor };

/** Owns search, match, and disconnect sequencing behind transport and UI ports. */
export function createMatchSession(
  controller: GameController,
  flow: MatchFlow,
  scene: MatchScene,
  ui: MatchUi,
  connect: (events: MatchEvents) => MatchTransport,
) {
  let lifecycle: MatchLifecycle = { type: 'IDLE' };
  const sendRequest = (request: CommandRequest) => {
    if (lifecycle.type !== 'PLAYING') return;

    table.send({
      type: 'command',
      commandId: request.commandId,
      command: request.command,
      matchId: lifecycle.cursor.matchId,
      expectedRevision: lifecycle.cursor.revision,
    });
  };
  const table = connect({
    onReady() {
      if (lifecycle.type !== 'PLAYING') return;

      lifecycle = { type: 'IDLE' };
      flow.leave();
      ui.showTitle();
      ui.showNote(t('net.matchEndedDisconnected'));
    },
    onResume(you, players, state, canUndo, variantConfig, cursor, presentations, events) {
      lifecycle = { type: 'PLAYING', cursor };
      ui.setSearching(false);
      ui.showNote(null);
      scene.setPlayerNames?.(players);
      flow.join(you, sendRequest, state, canUndo, variantConfig, cursor, presentations, events);
      ui.enterTable();
      scene.startSetup(() => flow.presentInitial?.());
    },
    onRejected() {
      const wasPlaying = lifecycle.type === 'PLAYING';

      lifecycle = { type: 'IDLE' };
      ui.setSearching(false);
      ui.signedOut();

      if (wasPlaying) {
        flow.leave();
        ui.showTitle();
      }

      ui.showNote(t('net.signInAgain'));
    },
    onReconnect() {
      if (lifecycle.type === 'SEARCHING') ui.setSearching(true, 'CONNECTING');
      else if (lifecycle.type !== 'IDLE') ui.showNote(t('net.reconnecting'));
    },
    onWaiting() {
      if (lifecycle.type !== 'SEARCHING') return;

      ui.setSearching(true, 'SEARCHING');
    },
    onRoom(code) {
      ui.showRoom(code);
    },
    onMatched(you, players, state, variantConfig, cursor, presentations, events) {
      if (lifecycle.type !== 'SEARCHING') {
        table.cancel();

        return;
      }

      lifecycle = { type: 'PLAYING', cursor };
      ui.setSearching(false);
      ui.showNote(null);
      scene.setPlayerNames?.(players);
      flow.join(you, sendRequest, state, false, variantConfig, cursor, presentations, events);
      ui.enterTable();
      scene.startSetup(() => flow.presentInitial?.());
    },
    onUpdate(update) {
      if (lifecycle.type !== 'PLAYING') return;

      const resetDice = update.presentations.some(
        (job) => job.type === 'RESET_DICE' || job.type === 'OPENING',
      );

      if (
        (update.matchId === lifecycle.cursor.matchId || (resetDice && update.revision === 0)) &&
        update.revision >=
          (update.matchId === lifecycle.cursor.matchId ? lifecycle.cursor.revision : 0)
      )
        lifecycle = {
          type: 'PLAYING',
          cursor: { matchId: update.matchId, revision: update.revision },
        };
      else return;

      flow.receive(update);
    },
    onError(code) {
      ui.showNote(t(`error.${code}`));
    },
    onRematch(status) {
      ui.showNote(status === 'OFFERED' ? t('net.rematchOffered') : t('net.rematchDeclined'));
    },
    onLeft() {
      lifecycle = { type: 'IDLE' };
      ui.setSearching(false);
      flow.leave();
      ui.showTitle();
      ui.showNote(t('net.opponentLeft'));
    },
    onClose() {
      const wasPlaying = lifecycle.type === 'PLAYING' || controller.scripted;

      lifecycle = { type: 'IDLE' };
      ui.setSearching(false);

      if (wasPlaying) {
        flow.leave();
        ui.showTitle();
      }

      ui.showNote(t('net.unreachable'));
    },
  });

  return {
    reconnect() {
      if (lifecycle.type !== 'IDLE') return;

      table.connect();
    },
    signOut() {
      const wasPlaying = lifecycle.type === 'PLAYING';

      lifecycle = { type: 'IDLE' };
      ui.setSearching(false);
      table.abandon();

      if (wasPlaying) {
        flow.leave();
        ui.showTitle();
      }
    },
    /**
     * Returns to the title screen from the table. An unfinished online match is cancelled through
     * the same authoritative path as signing out: the opponent wins by abandonment and both seats
     * are released, so a later search starts a fresh match instead of resuming the old one.
     */
    exitGame() {
      const online = lifecycle.type === 'PLAYING';

      lifecycle = { type: 'IDLE' };
      ui.setSearching(false);

      if (online) table.abandon();

      flow.leave();
      ui.showNote(null);
      ui.showTitle();
    },
    startLocal(selection: MatchSelection = CLASSIC_SELECTION, seed?: number): boolean {
      scene.setPlayerNames?.(null);

      const rules = rulesForSelection(selection);

      if (
        !controller.configure(rules, seed === undefined ? undefined : createSeededRandomInt(seed))
      )
        return false;

      const attempts = controller.resolveLocalOpening();
      const wasSearching = lifecycle.type === 'SEARCHING';

      lifecycle = { type: 'IDLE' };
      scene.startSetup(() => {
        if (attempts) scene.presentOpening?.(attempts);
      });

      if (!wasSearching) return true;

      ui.setSearching(false);
      table.cancel();

      return true;
    },
    toggleSearch(selection: MatchSelection = CLASSIC_SELECTION) {
      if (lifecycle.type === 'PLAYING') return;
      if (lifecycle.type === 'SEARCHING') {
        lifecycle = { type: 'IDLE' };
        ui.setSearching(false);
        table.cancel();
        ui.showNote(null);

        return;
      }

      lifecycle = { type: 'SEARCHING' };
      ui.showNote(null);
      ui.setSearching(true, 'CONNECTING');
      table.find(selection);
    },
    createRoom(selection: MatchSelection = CLASSIC_SELECTION) {
      if (lifecycle.type === 'PLAYING') return;

      lifecycle = { type: 'SEARCHING' };
      ui.showNote(null);
      table.createRoom(selection);
    },
    joinRoom(code: string) {
      if (lifecycle.type === 'PLAYING') return;

      lifecycle = { type: 'SEARCHING' };
      ui.showNote(null);
      table.joinRoom(code);
    },
  };
}
