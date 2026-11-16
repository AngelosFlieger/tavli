import type { GameController } from '../app/game-controller';
import type { PickupView } from '../app/pickup-selection';
import type { Move } from '../game/engine';
import type { AbilityId, AbilityTarget, RollAbilityOption } from '../game/variant/types';
import { describeConfiguredAbility } from '../game/variant/abilities/registry';
import {
  rollAbilityOptionLabel,
  rollAbilityPrompt,
  usesDirectDieSelection,
} from './abilities/presenters';
import { createDraftPanel } from './draft-panel';

type GameplayHudActions = {
  undo: () => void;
  restart: () => void;
  forfeit: () => void;
  releaseLast: () => void;
  bearOff: (sequence: Move[]) => void;
  pickAbility: (abilityId: AbilityId, replaceInstanceId?: string) => boolean;
  selectAbility: (instanceId: string) => boolean;
  cancelAbility: () => void;
  playRollAbility: (option: RollAbilityOption) => void;
  playBeforeRollAbility: (target: AbilityTarget) => void;
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
  const forfeit = document.querySelector<HTMLButtonElement>('#forfeit');
  const rulesetBadge = document.querySelector<HTMLElement>('#ruleset-badge')!;
  const panels = [
    document.querySelector<HTMLElement>('.player.red')!,
    document.querySelector<HTMLElement>('.player.ivory')!,
  ];
  let rollShown: 'roll' | 'end' | 'ability-target' | 'ability-end' | null = null;
  const draftPanel = createDraftPanel(controller, locked, {
    pickAbility: actions.pickAbility,
    selectAbility: actions.selectAbility,
    cancelAbility: actions.cancelAbility,
  });

  undo.addEventListener('click', actions.undo);
  next.addEventListener('click', actions.restart);
  forfeit?.addEventListener('click', actions.forfeit);

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
    const selectedAbility = controller.selectedAbility;
    const selectedTarget = controller.selectedAbilityTarget;
    const mode = ending
      ? selectedAbility
        ? selectedTarget
          ? 'ability-end'
          : 'ability-target'
        : 'end'
      : 'roll';
    if (mode !== rollShown) {
      rollShown = mode;
      roll.classList.toggle('end-action', ending);
      roll.innerHTML = ending
        ? selectedAbility
          ? selectedTarget
            ? 'USE &amp; END <span>→</span>'
            : 'SELECT POINT <span>↗</span>'
          : 'END <span>→</span>'
        : 'ROLL <span>↗</span>';
    }
    if (selectedAbility && !selectedTarget) roll.disabled = true;
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
    if (selectedAbility && state.phase === 'TURN_COMPLETE') {
      const copy = controller.variantConfig
        ? describeConfiguredAbility(selectedAbility.abilityId, controller.variantConfig)
        : null;
      const status = document.createElement('span');
      status.className = 'pickup-status';
      status.textContent = selectedTarget
        ? `${copy?.name ?? 'Ability'} targets ${describeTarget(selectedTarget)}`
        : `Choose a highlighted point for ${copy?.name ?? 'this ability'}`;
      const cancel = document.createElement('button');
      cancel.textContent = 'Cancel ability';
      cancel.onclick = actions.cancelAbility;
      choices.append(status, cancel);
    }
    if (selectedAbility && state.phase === 'WAITING_FOR_ROLL') {
      const copy = controller.variantConfig
        ? describeConfiguredAbility(selectedAbility.abilityId, controller.variantConfig)
        : null;
      const status = document.createElement('span');
      status.className = 'pickup-status';
      status.textContent = `Choose an effect for ${copy?.name ?? 'this ability'}`;
      choices.append(status);
      for (const target of controller.abilityTargets()) {
        if (target.type !== 'EFFECT') continue;
        const effect = state.powerups?.activeEffects.find(
          (candidate) => candidate.instanceId === target.instanceId,
        );
        if (!effect) continue;
        const effectCopy = controller.variantConfig
          ? describeConfiguredAbility(effect.abilityId, controller.variantConfig)
          : null;
        const button = document.createElement('button');
        button.textContent = `Remove ${effectCopy?.name ?? effect.abilityId} · ${describeTarget(effect.target)}`;
        button.onclick = () => actions.playBeforeRollAbility(target);
        choices.append(button);
      }
      const cancel = document.createElement('button');
      cancel.textContent = 'Cancel ability';
      cancel.onclick = actions.cancelAbility;
      choices.append(cancel);
    }
    if (selectedAbility && state.phase === 'WAITING_FOR_MOVE') {
      const copy = controller.variantConfig
        ? describeConfiguredAbility(selectedAbility.abilityId, controller.variantConfig)
        : null;
      const status = document.createElement('span');
      status.className = 'pickup-status';
      const directDieSelection = usesDirectDieSelection(selectedAbility.abilityId);
      status.textContent = rollAbilityPrompt(
        selectedAbility.abilityId,
        copy?.name ?? 'this ability',
      );
      choices.append(status);
      for (const option of controller.rollAbilityOptions()) {
        const button = document.createElement('button');
        if (directDieSelection) button.className = 'dice-choice-fallback';
        button.textContent = rollAbilityOptionLabel(
          selectedAbility.abilityId,
          state,
          option,
          controller.variantConfig!,
        );
        button.onclick = () => actions.playRollAbility(option);
        choices.append(button);
      }
      const cancel = document.createElement('button');
      cancel.textContent = 'Cancel ability';
      cancel.onclick = actions.cancelAbility;
      choices.append(cancel);
    } else if (state.phase === 'WAITING_FOR_MOVE' && state.diceModifiers.length) {
      const modified = document.createElement('span');
      modified.className = 'pickup-status';
      modified.textContent = state.diceModifiers
        .map((modifier) => {
          const name = controller.variantConfig
            ? describeConfiguredAbility(modifier.abilityId, controller.variantConfig).name
            : modifier.abilityId;
          return `${name} die ${modifier.dieIndex + 1}: ${modifier.before} → ${modifier.after}`;
        })
        .join(' · ');
      choices.append(modified);
    }
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
    if (forfeit) {
      forfeit.hidden = !controller.scripted || state.phase === 'GAME_OVER';
      forfeit.disabled = blocked;
    }
    const config = controller.variantConfig;
    rulesetBadge.hidden = !config;
    rulesetBadge.textContent = config ? `Powerups · ${config.id} v${config.version}` : '';
    rulesetBadge.title = config ? `Configuration ${config.hash}` : '';
    draftPanel.render();
    canvas.dataset.phase = state.phase;
    canvas.dataset.active = String(state.active);
    canvas.dataset.ruleset = state.ruleset;
    canvas.dataset.variantConfig = state.variantConfigHash ?? '';
    canvas.dataset.remaining = state.remaining.join(',');
    actions.onChange();
  }

  return { render };
}

function describeTarget(target: NonNullable<GameController['selectedAbilityTarget']>): string {
  switch (target.type) {
    case 'PLAYER':
      return `Player ${target.player + 1}`;
    case 'POINT':
      return `point ${target.point + 1}`;
    case 'CHECKER':
      return `checker ${target.checker + 1}`;
    case 'DIE':
      return `die ${target.index + 1}`;
    case 'EFFECT':
      return `effect ${target.instanceId}`;
  }
}
