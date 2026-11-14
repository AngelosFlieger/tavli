import type { GameState, Player } from '../game/engine';
import type { Command, Update } from '../net/messages';
import type { GameController } from './game-controller';

export type MatchEvents = {
  onReady: (name: string) => void;
  onResume: (you: Player, state: GameState, canUndo: boolean) => void;
  onRejected: () => void;
  onReconnect: () => void;
  onWaiting: () => void;
  onMatched: (you: Player, state: GameState) => void;
  onUpdate: (update: Update) => void;
  onLeft: () => void;
  onClose: () => void;
};

export type MatchTransport = {
  connect: () => void;
  find: () => void;
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
      ui.showNote('The match ended while you were disconnected.');
    },
    onResume(you, state, canUndo) {
      searching = false;
      playing = true;
      ui.setSearching(false);
      ui.showNote(null);
      flow.join(you, (command) => table.send(command), state, canUndo);
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
      ui.showNote('Sign in again to play online.');
    },
    onReconnect() {
      if (searching || playing) ui.showNote('Reconnecting…');
    },
    onWaiting() {
      if (!searching) return;
      ui.setSearching(true);
    },
    onMatched(you, state) {
      if (!searching) {
        table.cancel();
        return;
      }
      searching = false;
      playing = true;
      ui.setSearching(false);
      ui.showNote(null);
      flow.join(you, (command) => table.send(command), state);
      ui.enterTable();
      scene.startSetup();
    },
    onUpdate(update) {
      flow.receive(update);
    },
    onLeft() {
      searching = false;
      playing = false;
      ui.setSearching(false);
      flow.leave();
      ui.showTitle();
      ui.showNote('Opponent left. Search again to play.');
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
      ui.showNote('Can’t reach the game server.');
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
    startLocal() {
      scene.startSetup();
      if (!searching) return;
      searching = false;
      ui.setSearching(false);
      table.cancel();
    },
    toggleSearch() {
      if (searching) {
        searching = false;
        ui.setSearching(false);
        table.cancel();
        ui.showNote(null);
        return;
      }
      searching = true;
      ui.showNote(null);
      table.find();
    },
  };
}
