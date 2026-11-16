import type { GameState, Player } from '../game/engine';
import type { ClientErrorCode, Command, Update } from '../net/messages';
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
    state: GameState,
    canUndo: boolean,
    variantConfig: ResolvedVariantConfig | null,
  ) => void;
  onRejected: () => void;
  onReconnect: () => void;
  onWaiting: () => void;
  onMatched: (you: Player, state: GameState, variantConfig: ResolvedVariantConfig | null) => void;
  onUpdate: (update: Update) => void;
  onError: (code: ClientErrorCode) => void;
  onRematch: (status: 'OFFERED' | 'DECLINED') => void;
  onLeft: () => void;
  onClose: () => void;
};

export type MatchTransport = {
  connect: () => void;
  find: (selection?: MatchSelection) => void;
  cancel: () => void;
  send: (command: Command) => void;
  abandon: () => void;
};

export type MatchFlow = {
  join: (
    you: Player,
    send: (command: Command) => void,
    state: GameState,
    canUndo?: boolean,
    variantConfig?: ResolvedVariantConfig | null,
  ) => void;
  receive: (update: Update) => void;
  leave: () => void;
};

export type MatchScene = { startSetup: () => void };

export type MatchUi = {
  setSearching: (searching: boolean) => void;
  showNote: (message: string | null) => void;
  enterTable: () => void;
  showTitle: () => void;
  signedOut: () => void;
};

/** Owns search, match, and disconnect sequencing behind transport and UI ports. */
export function createMatchSession(
  controller: GameController,
  flow: MatchFlow,
  scene: MatchScene,
  ui: MatchUi,
  connect: (events: MatchEvents) => MatchTransport,
) {
  let searching = false;
  let playing = false;
  const table = connect({
    onReady() {
      if (!playing) return;
      playing = false;
      flow.leave();
      ui.showTitle();
      ui.showNote(t('net.matchEndedDisconnected'));
    },
    onResume(you, state, canUndo, variantConfig) {
      searching = false;
      playing = true;
      ui.setSearching(false);
      ui.showNote(null);
      flow.join(you, (command) => table.send(command), state, canUndo, variantConfig);
      ui.enterTable();
      scene.startSetup();
    },
    onRejected() {
      const wasPlaying = playing;
      playing = false;
      searching = false;
      ui.setSearching(false);
      ui.signedOut();
      if (wasPlaying) {
        flow.leave();
        ui.showTitle();
      }
      ui.showNote(t('net.signInAgain'));
    },
    onReconnect() {
      if (searching || playing) ui.showNote(t('net.reconnecting'));
    },
    onWaiting() {
      if (!searching) return;
      ui.setSearching(true);
    },
    onMatched(you, state, variantConfig) {
      if (!searching) {
        table.cancel();
        return;
      }
      searching = false;
      playing = true;
      ui.setSearching(false);
      ui.showNote(null);
      flow.join(you, (command) => table.send(command), state, false, variantConfig);
      ui.enterTable();
      scene.startSetup();
    },
    onUpdate(update) {
      flow.receive(update);
    },
    onError(code) {
      ui.showNote(t(`error.${code}`));
    },
    onRematch(status) {
      ui.showNote(status === 'OFFERED' ? t('net.rematchOffered') : t('net.rematchDeclined'));
    },
    onLeft() {
      searching = false;
      playing = false;
      ui.setSearching(false);
      flow.leave();
      ui.showTitle();
      ui.showNote(t('net.opponentLeft'));
    },
    onClose() {
      const wasPlaying = playing || controller.scripted;
      searching = false;
      playing = false;
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
      if (playing || searching) return;
      table.connect();
    },
    signOut() {
      const wasPlaying = playing;
      playing = false;
      searching = false;
      ui.setSearching(false);
      table.abandon();
      if (wasPlaying) {
        flow.leave();
        ui.showTitle();
      }
    },
    startLocal(selection: MatchSelection = CLASSIC_SELECTION, seed?: number): boolean {
      const rules = rulesForSelection(selection);
      if (
        !controller.configure(rules, seed === undefined ? undefined : createSeededRandomInt(seed))
      )
        return false;
      scene.startSetup();
      if (!searching) return true;
      searching = false;
      ui.setSearching(false);
      table.cancel();
      return true;
    },
    toggleSearch(selection: MatchSelection = CLASSIC_SELECTION) {
      if (searching) {
        searching = false;
        ui.setSearching(false);
        table.cancel();
        ui.showNote(null);
        return;
      }
      searching = true;
      ui.showNote(null);
      table.find(selection);
    },
  };
}
