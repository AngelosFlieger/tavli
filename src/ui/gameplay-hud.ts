import type { GameController } from '../app/game-controller';
import type { PickupView } from '../app/pickup-selection';
import type { Move } from '../game/engine';

type GameplayHudActions = {
  undo: () => void;
  restart: () => void;
  releaseLast: () => void;
  bearOff: (sequence: Move[]) => void;
  onChange: () => void;
};

/** Presents turn controls and held-checker choices without owning game rules. */
export function createGameplayHud(
  canvas: HTMLCanvasElement,
  controller: GameController,
  locked: () => boolean,
  actions: GameplayHudActions,
) {
  const roll = document.querySelector<HTMLButtonElement>('#roll')!;
  const undo = document.querySelector<HTMLButtonElement>('#undo')!;
  const message = document.querySelector<HTMLElement>('#game-message')!;
  const choices = document.querySelector<HTMLElement>('#move-choices')!;
  const next = document.querySelector<HTMLButtonElement>('#next-game')!;
  const panels = [
    document.querySelector<HTMLElement>('.player.red')!,
    document.querySelector<HTMLElement>('.player.ivory')!,
  ];
  let rollShown: 'roll' | 'end' | null = null;

  undo.addEventListener('click', actions.undo);
  next.addEventListener('click', actions.restart);

  function render({ queue, sequences }: PickupView) {
    const state = controller.state;
    const blocked = locked();
    const mine = controller.mine();
    const ending = state.phase === 'TURN_COMPLETE';
    roll.disabled =
      blocked ||
      !mine ||
      !['OPENING_ROLL', 'WAITING_FOR_ROLL', 'TURN_COMPLETE'].includes(state.phase);
    undo.disabled =
      blocked ||
      !mine ||
      !['WAITING_FOR_MOVE', 'TURN_COMPLETE'].includes(state.phase) ||
      !controller.canUndo;
    const mode = ending ? 'end' : 'roll';
    if (mode !== rollShown) {
      rollShown = mode;
      roll.classList.toggle('end-action', ending);
      roll.innerHTML = ending ? 'END <span>→</span>' : 'ROLL <span>↗</span>';
    }
    roll.setAttribute(
      'aria-label',
      ending ? 'End turn' : state.opening ? `Player ${state.active! + 1} opening roll` : 'Roll',
    );
    message.textContent = state.message;
    message.hidden = state.phase !== 'GAME_OVER';
    panels.forEach((panel, player) => {
      panel.classList.toggle('inactive', state.active !== null && state.active !== player);
      panel.classList.toggle('active', state.active === player && state.phase !== 'GAME_OVER');
      panel.classList.toggle('you', controller.seat === player);
      panel.setAttribute(
        'aria-label',
        `Player ${player + 1}${state.active === player ? ', active' : ''}${controller.seat === player ? ', you' : ''}`,
      );
    });
    choices.replaceChildren();
    if (state.phase === 'WAITING_FOR_MOVE' && queue.length && !blocked) {
      const status = document.createElement('span');
      status.className = 'pickup-status';
      status.textContent = `${queue.length} checker${queue.length === 1 ? '' : 's'} held`;
      choices.append(status);
      const release = document.createElement('button');
      release.textContent = 'Put back last';
      release.setAttribute('aria-label', 'Put back last picked-up checker');
      release.onclick = actions.releaseLast;
      choices.append(release);
      for (const sequence of sequences.filter((candidate) => candidate.at(-1)!.to === -1)) {
        const button = document.createElement('button');
        button.textContent = `Bear off · ${sequence.map((move) => move.die).join(' + ')}`;
        button.onclick = () => actions.bearOff(sequence);
        choices.append(button);
      }
    }
    next.hidden = state.phase !== 'GAME_OVER';
    canvas.dataset.phase = state.phase;
    canvas.dataset.active = String(state.active);
    actions.onChange();
  }

  return { render };
}
