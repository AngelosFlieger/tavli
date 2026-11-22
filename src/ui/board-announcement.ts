import { t } from './i18n';

/** Owns short, non-authoritative text projected over the board. */
export function createBoardAnnouncement() {
  const element = document.querySelector<HTMLElement>('#board-announcement')!;
  let sequence = 0;
  let playerNames: [string, string] | null = null;

  function show(text: string) {
    sequence++;
    element.textContent = text;
    element.hidden = false;
  }

  return {
    openingStarted() {
      show(t('hud.openingDetermining'));
    },
    openingFinished(player: 0 | 1) {
      show(
        t('hud.openingFirst', {
          player: playerNames?.[player] ?? t('target.player', { player: player + 1 }),
        }),
      );

      const ticket = sequence;

      window.setTimeout(() => {
        if (ticket !== sequence) return;

        element.hidden = true;
      }, 1800);
    },
    setPlayerNames(players: [string, string] | null) {
      playerNames = players;
    },
    hide() {
      sequence++;
      element.hidden = true;
    },
  };
}
