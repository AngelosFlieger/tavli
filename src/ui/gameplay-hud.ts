import type { GameController } from '../app/game-controller';
import type { PickupView } from '../app/pickup-selection';
import type { Move } from '../game/engine';
import type { AbilityId, AbilityTarget, RollAbilityOption } from '../game/variant/types';
import { localizedAbilityCopy } from './abilities/copy';
import {
  rollAbilityOptionLabel,
  rollAbilityPrompt,
  usesDirectDieSelection,
} from './abilities/presenters';
import { createDraftPanel } from './draft-panel';
import { formatClock } from '../game/clock';
import { stateMessageParts } from '../game/session/messages';
import { pluralSuffix, t } from '../ui/i18n';

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
  const clock = document.querySelector<HTMLOutputElement>('#game-clock');
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
  // A short press animation acknowledges the click even while the dice are settling.
  roll.addEventListener('click', () => {
    roll.classList.remove('bounce');
    void roll.offsetWidth;
    roll.classList.add('bounce');
  });

  const clockTimer = setInterval(() => {
    if (!clock) return;

    const stateClock = controller.state.clock;

    clock.hidden = !stateClock;

    if (stateClock) {
      clock.textContent = formatClock(stateClock, Date.now());
      clock.classList.toggle('is-low', formatClock(stateClock, Date.now()).startsWith('0:'));
    }
  }, 250);

  void clockTimer;

  function render({ queue, sequences }: PickupView) {
    const state = controller.state;
    const blocked = locked();
    const mine = controller.mine();
    const ending = state.phase === 'TURN_COMPLETE';

    roll.disabled =
      blocked || !mine || !['WAITING_FOR_ROLL', 'TURN_COMPLETE'].includes(state.phase);
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
            ? `${t('hud.useAndEnd')} <span>→</span>`
            : `${t('hud.selectPoint')} <span>↗</span>`
          : `${t('hud.end')} <span>→</span>`
        : `${t('hud.roll')} <span>↗</span>`;
    }
    if (selectedAbility && !selectedTarget) roll.disabled = true;

    roll.setAttribute('aria-label', ending ? t('hud.endLabel') : t('hud.rollLabel'));

    const status = stateMessageParts(state);

    message.textContent =
      status?.key === 'status.winner' && state.outcome
        ? t(status.key, { ...status.params, reason: t(`outcome.${state.outcome.kind}`) })
        : status
          ? t(status.key, status.params)
          : '';
    message.hidden = state.phase !== 'GAME_OVER';
    panels.forEach((panel, player) => {
      panel.classList.toggle('inactive', state.active !== null && state.active !== player);
      panel.classList.toggle('active', state.active === player && state.phase !== 'GAME_OVER');
      panel.classList.toggle('you', controller.seat === player);
      panel.setAttribute(
        'aria-label',
        `${t('target.player', { player: player + 1 })}${state.active === player ? t('hud.panelActive') : ''}${controller.seat === player ? t('hud.panelYou') : ''}`,
      );
    });
    choices.replaceChildren();

    if (selectedAbility && state.phase === 'TURN_COMPLETE') {
      const copy = controller.variantConfig
        ? localizedAbilityCopy(selectedAbility.abilityId, controller.variantConfig)
        : null;
      const status = document.createElement('span');

      status.className = 'pickup-status';
      status.textContent = selectedTarget
        ? t('hud.targets', {
            name: copy?.name ?? t('hud.ability'),
            target: describeTarget(selectedTarget),
          })
        : t('hud.chooseTarget', { name: copy?.name ?? t('hud.thisAbility') });

      const cancel = document.createElement('button');

      cancel.textContent = t('hud.cancelAbility');
      cancel.onclick = actions.cancelAbility;
      choices.append(status, cancel);
    }
    if (selectedAbility && state.phase === 'WAITING_FOR_ROLL') {
      const copy = controller.variantConfig
        ? localizedAbilityCopy(selectedAbility.abilityId, controller.variantConfig)
        : null;
      const status = document.createElement('span');

      status.className = 'pickup-status';
      status.textContent = t('hud.chooseEffect', { name: copy?.name ?? t('hud.thisAbility') });
      choices.append(status);

      for (const target of controller.abilityTargets()) {
        if (target.type !== 'EFFECT') continue;

        const effect = state.powerups?.activeEffects.find(
          (candidate) => candidate.instanceId === target.instanceId,
        );

        if (!effect) continue;

        const effectCopy = controller.variantConfig
          ? localizedAbilityCopy(effect.abilityId, controller.variantConfig)
          : null;
        const button = document.createElement('button');

        button.textContent = t('hud.removeEffect', {
          name: effectCopy?.name ?? effect.abilityId,
          target: describeTarget(effect.target),
        });
        button.onclick = () => actions.playBeforeRollAbility(target);
        choices.append(button);
      }

      const cancel = document.createElement('button');

      cancel.textContent = t('hud.cancelAbility');
      cancel.onclick = actions.cancelAbility;
      choices.append(cancel);
    }
    if (selectedAbility && state.phase === 'WAITING_FOR_MOVE') {
      const copy = controller.variantConfig
        ? localizedAbilityCopy(selectedAbility.abilityId, controller.variantConfig)
        : null;
      const status = document.createElement('span');

      status.className = 'pickup-status';

      const directDieSelection = usesDirectDieSelection(selectedAbility.abilityId);

      status.textContent = rollAbilityPrompt(
        selectedAbility.abilityId,
        copy?.name ?? t('hud.thisAbility'),
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

      cancel.textContent = t('hud.cancelAbility');
      cancel.onclick = actions.cancelAbility;
      choices.append(cancel);
    } else if (state.phase === 'WAITING_FOR_MOVE' && state.diceModifiers.length) {
      const modified = document.createElement('span');

      modified.className = 'pickup-status';
      modified.textContent = state.diceModifiers
        .map((modifier) => {
          const name = controller.variantConfig
            ? localizedAbilityCopy(modifier.abilityId, controller.variantConfig).name
            : modifier.abilityId;

          return t('hud.dieModifier', {
            name,
            die: modifier.dieIndex + 1,
            before: modifier.before,
            after: modifier.after,
          });
        })
        .join(' · ');
      choices.append(modified);
    }
    if (state.phase === 'WAITING_FOR_MOVE' && queue.length && !blocked) {
      const status = document.createElement('span');

      status.className = 'pickup-status';
      status.textContent = t('hud.checkersHeld', {
        count: queue.length,
        s: pluralSuffix(queue.length),
      });
      choices.append(status);

      const release = document.createElement('button');

      release.textContent = t('hud.putBackLast');
      release.setAttribute('aria-label', t('hud.putBackLastAria'));
      release.onclick = actions.releaseLast;
      choices.append(release);

      for (const sequence of sequences.filter((candidate) => candidate.at(-1)!.to === -1)) {
        const button = document.createElement('button');

        button.textContent = `${t('hud.bearOff')} · ${sequence.map((move) => move.die).join(' + ')}`;
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
    rulesetBadge.title = config ? t('hud.configuration', { hash: config.hash }) : '';
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
      return t('target.player', { player: target.player + 1 });
    case 'POINT':
      return t('target.point', { point: target.point + 1 });
    case 'CHECKER':
      return t('target.checker', { checker: target.checker + 1 });
    case 'DIE':
      return t('target.die', { index: target.index + 1 });
    case 'EFFECT':
      return t('target.effect', { instanceId: target.instanceId });
  }
}
