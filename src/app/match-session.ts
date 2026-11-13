import type { GameState, Player } from '../game/engine';
import type { Command, Update } from '../net/messages';
import type { GameController } from './game-controller';

export type MatchEvents = {
  onWaiting: () => void;
  onMatched: (you: Player, state: GameState) => void;
  onUpdate: (update: Update) => void;
  onLeft: () => void;
  onClose: () => void;
};

export type MatchTransport = {
  find: () => void;
  cancel: () => void;
  send: (command: Command) => void;
};

export type MatchFlow = {
  join: (you: Player, send: (command: Command) => void, state: GameState) => void;
  receive: (update: Update) => void;
  leave: () => void;
};

export type MatchScene = { startSetup: () => void };

export type MatchUi = {
  setSearching: (searching: boolean) => void;
  showNote: (message: string | null) => void;
  enterTable: () => void;
  showTitle: () => void;
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
  const table = connect({
    onWaiting() {},
    onMatched(you, state) {
      if (!searching) {
        table.cancel();
        return;
      }
      searching = false;
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
      ui.setSearching(false);
      flow.leave();
      ui.showTitle();
      ui.showNote('Opponent left. Search again to play.');
    },
    onClose() {
      const playing = controller.scripted;
      searching = false;
      ui.setSearching(false);
      if (playing) {
        flow.leave();
        ui.showTitle();
      }
      ui.showNote('Can’t reach the game server.');
    },
  });

  return {
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
      ui.setSearching(true);
      ui.showNote(null);
      table.find();
    },
  };
}
