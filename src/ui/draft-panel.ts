import type { GameController } from '../app/game-controller';
import { abilityRegistry, describeConfiguredAbility } from '../game/variant/abilities/registry';
import type {
  AbilityId,
  AbilityInstance,
  AbilityTarget,
  EffectBoundary,
  PlayerLoadout,
} from '../game/variant/types';
import { opportunistFocus, quartermasterCooldown } from '../game/variant/passives/policy';
import { portrait } from './portraits';

type DraftPanelActions = {
  pickAbility: (abilityId: AbilityId, replaceInstanceId?: string) => boolean;
  selectAbility: (instanceId: string) => boolean;
  cancelAbility: () => void;
};

/** Presents draft choices and inventories; all legality remains in the session transition. */
export function createDraftPanel(
  controller: GameController,
  locked: () => boolean,
  actions: DraftPanelActions,
) {
  const panel = document.querySelector<HTMLElement>('#draft-panel')!;
  const status = document.querySelector<HTMLElement>('#draft-status')!;
  const order = document.querySelector<HTMLElement>('#draft-order')!;
  const contestants = document.querySelector<HTMLElement>('#draft-contestants')!;
  const cards = document.querySelector<HTMLElement>('#draft-cards')!;
  const replacement = document.querySelector<HTMLElement>('#draft-replacement')!;
  const playerPanels = [
    document.querySelector<HTMLElement>('.player.red')!,
    document.querySelector<HTMLElement>('.player.ivory')!,
  ];
  let pendingAbility: AbilityId | null = null;
  let renderedDraftKey = '';
  let presentedOrderKey = '';
  let revealingOrder = false;
  let revealTimer = 0;
  let focusedInstanceId: string | null = null;

  function render() {
    const config = controller.variantConfig;
    const powerups = controller.state.powerups;
    renderLoadouts(config ? powerups?.loadouts : undefined);
    if (!config || !powerups?.draft) {
      panel.hidden = true;
      pendingAbility = null;
      renderedDraftKey = '';
      presentedOrderKey = '';
      revealingOrder = false;
      clearTimeout(revealTimer);
      delete contestants.dataset.rollPresentations;
      return;
    }

    panel.hidden = false;
    const draft = powerups.draft;
    if (draft.stage !== 'PICKING') {
      panel.dataset.stage = 'ROLLING';
      status.textContent = 'Drawing the ability cards…';
      order.textContent = '';
      contestants.replaceChildren();
      cards.replaceChildren();
      replacement.replaceChildren();
      return;
    }

    const key = `${draft.currentPick}:${draft.offer.join(',')}`;
    if (key !== renderedDraftKey) {
      pendingAbility = null;
      renderedDraftKey = key;
    }
    const picker = draft.pickOrder[draft.currentPick];
    const canPick = controller.mine() && !locked();
    const lastRoll = draft.attempts.at(-1);
    const orderKey = `${draft.offer.join(',')}:${draft.attempts.map((roll) => roll.join('-')).join(',')}`;
    if (draft.currentPick === 0 && lastRoll && orderKey !== presentedOrderKey) {
      presentedOrderKey = orderKey;
      revealingOrder = true;
      contestants.dataset.rollPresentations = String(
        Number(contestants.dataset.rollPresentations ?? 0) + 1,
      );
      clearTimeout(revealTimer);
      const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 260 : 1450;
      revealTimer = window.setTimeout(() => {
        if (presentedOrderKey !== orderKey) return;
        revealingOrder = false;
        render();
      }, duration);
    }
    panel.dataset.stage = revealingOrder ? 'ROLLING' : 'PICKING';
    status.textContent = revealingOrder
      ? 'Rolling for first choice'
      : canPick
        ? 'Choose one ability'
        : 'Waiting for a choice';
    order.textContent = revealingOrder
      ? 'Highest die chooses first'
      : `Choice ${draft.currentPick + 1} of ${draft.pickOrder.length}`;
    renderContestants(picker, lastRoll, revealingOrder);

    if (revealingOrder) {
      cards.replaceChildren();
      replacement.replaceChildren();
    } else {
      cards.replaceChildren(
        ...draft.offer.map((abilityId) => abilityCard(abilityId, picker, canPick)),
      );
      renderReplacement(picker, canPick);
    }
  }

  function renderContestants(picker: 0 | 1, roll: [number, number] | undefined, rolling: boolean) {
    const key = `${picker}:${rolling}:${roll?.join('-') ?? ''}`;
    if (contestants.dataset.key === key) return;
    contestants.dataset.key = key;
    contestants.replaceChildren(
      ...([0, 1] as const).map((player) => {
        const card = document.createElement('article');
        card.className = 'draft-contestant';
        card.dataset.player = String(player);
        card.classList.toggle('is-picker', !rolling && player === picker);
        card.classList.toggle('is-eliminated', !rolling && player !== picker);
        card.setAttribute(
          'aria-label',
          rolling
            ? `Player ${player + 1} rolled ${roll?.[player] ?? ''}`
            : player === picker
              ? `Player ${player + 1} chooses now`
              : `Player ${player + 1} waits`,
        );
        const avatar = document.createElement('div');
        avatar.className = 'draft-avatar';
        avatar.innerHTML = portrait(player === 1);
        const caption = document.createElement('span');
        caption.textContent = player === picker && !rolling ? 'Choose' : `P${player + 1}`;
        card.append(avatar, caption);
        if (roll && rolling) card.append(draftDie(roll[player], player));
        return card;
      }),
    );
  }

  function draftDie(value: number, player: 0 | 1) {
    const scene = document.createElement('div');
    scene.className = 'draft-die-scene';
    const cube = document.createElement('div');
    cube.className = 'draft-die-cube';
    cube.dataset.value = String(value);
    cube.dataset.player = String(player);
    for (const face of [1, 2, 3, 4, 5, 6]) {
      const side = document.createElement('span');
      side.className = `draft-die-face face-${face}`;
      side.setAttribute('aria-hidden', 'true');
      for (let pip = 0; pip < 9; pip++) {
        const dot = document.createElement('i');
        if (pipPositions[face].includes(pip)) dot.className = 'visible';
        side.append(dot);
      }
      cube.append(side);
    }
    scene.append(cube);
    return scene;
  }

  function abilityCard(abilityId: AbilityId, picker: 0 | 1, canPick: boolean) {
    const config = controller.variantConfig!;
    const definition = abilityRegistry[abilityId];
    const copy = describeConfiguredAbility(abilityId, config);
    const button = document.createElement('button');
    button.className = 'draft-card';
    button.dataset.kind = definition.kind;
    button.dataset.ability = abilityId;
    button.classList.toggle('selected', pendingAbility === abilityId);
    button.disabled = !canPick;
    button.setAttribute('aria-label', `Choose ${copy.name}`);
    const eyebrow = document.createElement('span');
    eyebrow.className = 'draft-card-kind';
    eyebrow.textContent = definition.kind === 'POWERUP' ? 'Powerup · expendable' : 'Passive';
    const name = document.createElement('strong');
    name.textContent = copy.name;
    const summary = document.createElement('span');
    summary.className = 'draft-card-summary';
    summary.textContent = copy.summary;
    button.append(eyebrow, name, summary);
    if (copy.benefit) button.append(detail('Benefit', copy.benefit));
    if (copy.drawback) button.append(detail('Drawback', copy.drawback));
    button.onclick = () => choose(abilityId, picker);
    return button;
  }

  function detail(label: string, value: string) {
    const row = document.createElement('span');
    row.className = `draft-card-detail ${label.toLowerCase()}`;
    row.textContent = `${label}: ${value}`;
    return row;
  }

  function choose(abilityId: AbilityId, player: 0 | 1) {
    const inventory = inventoryFor(powerupsLoadout(player), abilityId);
    const capacity = controller.inventoryCapacity(player, abilityId);
    if (inventory.length >= capacity) {
      pendingAbility = abilityId;
      render();
      return;
    }
    if (actions.pickAbility(abilityId)) {
      pendingAbility = null;
      render();
    }
  }

  function renderReplacement(player: 0 | 1, canPick: boolean) {
    replacement.replaceChildren();
    if (!pendingAbility) return;
    const config = controller.variantConfig!;
    const pendingCopy = describeConfiguredAbility(pendingAbility, config);
    const prompt = document.createElement('p');
    prompt.textContent = `Your ${abilityRegistry[pendingAbility].kind === 'POWERUP' ? 'powerup' : 'passive'} slots are full. Replace one to take ${pendingCopy.name}:`;
    const choices = document.createElement('div');
    choices.className = 'draft-replacement-choices';
    for (const instance of inventoryFor(powerupsLoadout(player), pendingAbility)) {
      const button = document.createElement('button');
      button.disabled = !canPick;
      button.textContent = `Replace ${describeConfiguredAbility(instance.abilityId, config).name}`;
      button.onclick = () => {
        if (actions.pickAbility(pendingAbility!, instance.instanceId)) {
          pendingAbility = null;
          render();
        }
      };
      choices.append(button);
    }
    const cancel = document.createElement('button');
    cancel.className = 'draft-replacement-cancel';
    cancel.textContent = 'Choose another card';
    cancel.onclick = () => {
      pendingAbility = null;
      render();
    };
    replacement.append(prompt, choices, cancel);
  }

  function powerupsLoadout(player: 0 | 1): PlayerLoadout {
    return controller.state.powerups!.loadouts[player];
  }

  function inventoryFor(loadout: PlayerLoadout, abilityId: AbilityId): AbilityInstance[] {
    return abilityRegistry[abilityId].kind === 'POWERUP' ? loadout.powerups : loadout.passives;
  }

  function renderLoadouts(loadouts: [PlayerLoadout, PlayerLoadout] | undefined) {
    for (const [player, playerPanel] of playerPanels.entries()) {
      let view = playerPanel.querySelector<HTMLElement>('.ability-loadout');
      if (!loadouts) {
        view?.remove();
        playerPanel.classList.remove('has-hostile-effect');
        continue;
      }
      if (!view) {
        view = document.createElement('div');
        view.className = 'ability-loadout';
        playerPanel.append(view);
      }
      const config = controller.variantConfig!;
      const loadout = loadouts[player];
      const instances = [...loadout.passives, ...loadout.powerups];
      const effects =
        controller.state.powerups?.activeEffects.filter(
          (effect) => effect.affectedPlayer === player,
        ) ?? [];
      view.replaceChildren();
      view.setAttribute('aria-label', `Player ${player + 1} abilities`);
      playerPanel.classList.toggle(
        'has-hostile-effect',
        effects.some((effect) => effect.source !== player),
      );
      const stack = document.createElement('div');
      stack.className = 'ability-card-stack';
      if (!instances.length && !effects.length) {
        const empty = document.createElement('span');
        empty.className = 'ability-slot empty';
        empty.textContent = 'No abilities';
        stack.append(empty);
      } else {
        for (const instance of instances) {
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
          const copy = describeConfiguredAbility(instance.abilityId, config);
          const cooldown =
            instance.abilityId === 'quartermaster'
              ? quartermasterCooldown(controller.state.powerups!, player as 0 | 1)
              : 0;
          const focus =
            instance.abilityId === 'opportunist'
              ? opportunistFocus(controller.state.powerups!, player as 0 | 1)
              : null;
          const kind = document.createElement('small');
          kind.textContent =
            abilityRegistry[instance.abilityId].kind === 'POWERUP' ? 'Power' : 'Passive';
          const name = document.createElement('strong');
          name.textContent = copy.name;
          chip.append(kind, name);
          if (cooldown || focus !== null) {
            const counter = document.createElement('span');
            counter.textContent = cooldown
              ? `Cooldown ${cooldown}`
              : `Focus ${focus}/${config.abilities.opportunist.focusCap}`;
            chip.append(counter);
          }
          chip.title = [
            copy.summary,
            ...(copy.benefit ? [`Benefit: ${copy.benefit}`] : []),
            ...(copy.drawback ? [`Drawback: ${copy.drawback}`] : []),
          ].join(' ');
          chip.setAttribute('aria-pressed', String(focusedInstanceId === instance.instanceId));
          chip.setAttribute('aria-label', `View ${copy.name}${canUse ? ', playable now' : ''}`);
          chip.onclick = () => {
            focusedInstanceId =
              focusedInstanceId === instance.instanceId ? null : instance.instanceId;
            render();
          };
          stack.append(chip);
        }
      }
      view.append(stack);
      const focused = instances.find((instance) => instance.instanceId === focusedInstanceId);
      if (focused) view.append(focusedAbilityCard(focused, player as 0 | 1));
      const effectList = document.createElement('div');
      effectList.className = 'active-effect-list';
      for (const effect of effects) {
        const chip = document.createElement('span');
        chip.className = 'ability-slot active-effect';
        chip.dataset.kind = abilityRegistry[effect.abilityId].kind;
        chip.dataset.ability = effect.abilityId;
        chip.dataset.instance = effect.instanceId;
        const copy = describeConfiguredAbility(effect.abilityId, config);
        const target = describeEffectTarget(effect.target);
        const expiry = describeEffectExpiry(effect.duration.boundary, effect.remaining);
        chip.textContent = `${copy.name} · ${target} · ${effect.remaining}`;
        chip.title = `Player ${effect.source + 1}: ${copy.summary} Target ${target}; ${expiry}.`;
        effectList.append(chip);
      }
      if (effectList.childElementCount) view.append(effectList);
    }
  }

  function focusedAbilityCard(instance: AbilityInstance, player: 0 | 1) {
    const config = controller.variantConfig!;
    const copy = describeConfiguredAbility(instance.abilityId, config);
    const canUse =
      player === controller.state.active &&
      controller.mine() &&
      !locked() &&
      controller.abilityIsPlayable(instance.instanceId);
    const detailCard = document.createElement('aside');
    detailCard.className = 'ability-focus-card';
    detailCard.dataset.kind = abilityRegistry[instance.abilityId].kind;
    detailCard.dataset.ability = instance.abilityId;
    const close = document.createElement('button');
    close.className = 'ability-focus-close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Close ability details');
    close.textContent = '×';
    close.onclick = () => {
      if (controller.selectedAbility?.instanceId === instance.instanceId) actions.cancelAbility();
      focusedInstanceId = null;
      render();
    };
    const kind = document.createElement('small');
    kind.textContent =
      abilityRegistry[instance.abilityId].kind === 'POWERUP' ? 'Expendable power' : 'Passive';
    const name = document.createElement('strong');
    name.textContent = copy.name;
    const summary = document.createElement('p');
    summary.textContent = copy.summary;
    detailCard.append(close, kind, name, summary);
    if (copy.benefit) detailCard.append(detail('Benefit', copy.benefit));
    if (copy.drawback) detailCard.append(detail('Drawback', copy.drawback));
    const use = document.createElement('button');
    use.type = 'button';
    use.className = 'ability-use';
    const selected = controller.selectedAbility?.instanceId === instance.instanceId;
    const passive = abilityRegistry[instance.abilityId].kind === 'PASSIVE';
    use.disabled = !canUse || selected;
    use.textContent = selected
      ? 'Selected'
      : canUse
        ? 'Use'
        : passive
          ? 'Always active'
          : 'Not playable now';
    use.onclick = () => {
      if (actions.selectAbility(instance.instanceId)) render();
    };
    detailCard.append(use);
    return detailCard;
  }

  return { render };
}

const pipPositions: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

function describeEffectTarget(target: AbilityTarget): string {
  switch (target.type) {
    case 'PLAYER':
      return `Player ${target.player + 1}`;
    case 'POINT':
      return `P${target.point + 1}`;
    case 'CHECKER':
      return `checker ${target.checker + 1}`;
    case 'DIE':
      return `die ${target.index + 1}`;
    case 'EFFECT':
      return `effect ${target.instanceId}`;
  }
}

function describeEffectExpiry(boundary: EffectBoundary, remaining: number): string {
  const unit =
    boundary === 'NEXT_DRAFT'
      ? 'draft boundary'
      : boundary === 'SOURCE_TURN_END'
        ? 'source turn'
        : 'target turn';
  return `${remaining} ${unit}${remaining === 1 ? '' : 's'} remaining`;
}
