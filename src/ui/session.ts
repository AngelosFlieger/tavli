import type { PlaytestReport } from '../app/playtest-report';
import type { MatchSelection } from '../net/messages';

/**
 * Callbacks the shell receives from `main.ts`. They are filled in once the board, dice, and
 * match session exist, so title and dialog panels only call through this typed contract.
 */
export type Session = {
  onNewGame: () => void;
  canNewGame: () => boolean;
  onLocal: (selection: MatchSelection, seed?: number) => void;
  onMultiplayer: (selection: MatchSelection) => void;
  onCreateRoom: (selection: MatchSelection) => void;
  onJoinRoom: (code: string) => void;
  onExitGame: () => void;
  onSignOut: () => void;
  playtestReport: () => PlaytestReport | null;
};
