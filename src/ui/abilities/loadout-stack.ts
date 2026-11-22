import type { GameController } from '../../app/game-controller';
import type { Player } from '../../game/rules/position';
import { abilityRegistry } from '../../game/variant/abilities/registry';
import type { AbilityInstance, PlayerLoadout } from '../../game/variant/types';
import { t } from '../i18n';
import { createActiveEffectList } from './active-effect-list';
import { abilityTooltip } from './card-content';
import { localizedAbilityCopy } from './copy';
import { createFocusedAbilityCard } from './focused-ability-card';
import { abilityCounterText } from './presenters';

type LoadoutActions = {
  selectAbility: (instanceId: string) => boolean;
  cancelAbility: () => void;
};

/** Owns both overlapping inventory stacks and their focused-card interaction. */
export function createAbilityLoadouts(
  controller: GameController,
  locked: () => boolean,
  actions: LoadoutActions,
  requestRender: () => void,
) {
  const trayRoot = document.querySelector<HTMLElement>('#ability-trays')!;
  const playerTrays = [
    trayRoot.querySelector<HTMLElement>('.ability-tray[data-player="0"]')!,
    trayRoot.querySelector<HTMLElement>('.ability-tray[data-player="1"]')!,
  ];
  const loadoutViews = playerTrays.map((tray) =>
    tray.querySelector<HTMLElement>('.ability-loadout')!,
  );
  let focusedInstanceId: string | null = null;
  let displayedPlayer: Player | null = null;

  function render(loadouts: [PlayerLoadout, PlayerLoadout] | undefined) {
    const activePlayer =
      loadouts && !['DRAFT_ORDER', 'DRAFT_PICK', 'GAME_OVER'].includes(controller.state.phase)
        ? controller.state.active
        : null;
    if (activePlayer !== displayedPlayer) {
      focusedInstanceId = null;
      displayedPlayer = activePlayer;
    }
    trayRoot.hidden = !loadouts || activePlayer === null;
    trayRoot.dataset.activePlayer = activePlayer === null ? '' : String(activePlayer);
    for (const [playerIndex, playerTray] of playerTrays.entries()) {
      const player = playerIndex as Player;
      const view = loadoutViews[player];
      if (!loadouts) {
        view.replaceChildren();
        playerTray.classList.remove('is-current', 'you', 'has-hostile-effect');
        playerTray.inert = true;
        playerTray.setAttribute('aria-hidden', 'true');
        continue;
      }
      const config = controller.variantConfig!;
      const loadout = loadouts[player];
      const instances = [...loadout.passives, ...loadout.powerups];
      const effects =
        controller.state.powerups?.activeEffects.filter(
          (effect) => effect.affectedPlayer === player,
        ) ?? [];
      view.replaceChildren();
      view.setAttribute('aria-label', t('draft.player.abilities', { player: player + 1 }));
      const isCurrent = activePlayer === player;
      playerTray.classList.toggle('is-current', isCurrent);
      playerTray.inert = !isCurrent;
      playerTray.setAttribute('aria-hidden', String(!isCurrent));
      playerTray.classList.toggle('you', controller.seat === player);
      playerTray.classList.toggle(
        'has-hostile-effect',
        effects.some((effect) => effect.source !== player),
      );
      view.append(createStack(instances, effects.length > 0, player));
      const focused = instances.find((instance) => instance.instanceId === focusedInstanceId);
      if (focused && isCurrent)
        view.append(
          createFocusedAbilityCard(
            controller,
            locked,
            actions,
            focused,
            player,
            () => (focusedInstanceId = null),
            requestRender,
          ),
        );
      const effectList = createActiveEffectList(effects, config);
      if (effectList) view.append(effectList);
    }
  }

  function createStack(
    instances: AbilityInstance[],
    hasEffects: boolean,
    player: Player,
  ): HTMLElement {
    const stack = document.createElement('div');
    stack.className = 'ability-card-stack';
    if (!instances.length && !hasEffects) {
      const empty = document.createElement('span');
      empty.className = 'ability-slot empty';
      empty.textContent = t('ability.noAbilities');
      stack.append(empty);
      return stack;
    }
    for (const instance of instances) stack.append(inventoryCard(instance, player));
    return stack;
  }

  function inventoryCard(instance: AbilityInstance, player: Player): HTMLButtonElement {
    const config = controller.variantConfig!;
    const canUse =
      player === controller.state.active &&
      controller.mine() &&
      !locked() &&
      controller.abilityIsPlayable(instance.instanceId);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'ability-slot ability-inventory-card';
    chip.dataset.kind = abilityRegistry[instance.abilityId].kind;
    chip.dataset.ability = instance.abilityId;
    chip.dataset.instance = instance.instanceId;
    chip.classList.toggle('focused', focusedInstanceId === instance.instanceId);
    const copy = localizedAbilityCopy(instance.abilityId, config);
    const kind = document.createElement('small');
    kind.textContent =
      abilityRegistry[instance.abilityId].kind === 'POWERUP'
        ? t('ability.power')
        : t('ability.passive');
    const name = document.createElement('strong');
    name.textContent = copy.name;
    chip.append(kind, name);
    const counter = abilityCounterText(instance.abilityId, controller.state, player, config);
    if (counter) {
      const value = document.createElement('span');
      value.textContent = counter;
      chip.append(value);
    }
    chip.title = abilityTooltip(instance.abilityId, config);
    chip.setAttribute('aria-pressed', String(focusedInstanceId === instance.instanceId));
    chip.setAttribute(
      'aria-label',
      t('ability.view', {
        name: copy.name,
        playable: canUse ? t('ability.playable') : '',
      }),
    );
    chip.onclick = () => {
      focusedInstanceId = focusedInstanceId === instance.instanceId ? null : instance.instanceId;
      requestRender();
    };
    return chip;
  }

  return { render };
}
