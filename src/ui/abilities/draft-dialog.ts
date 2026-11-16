import type { GameController } from '../../app/game-controller';
import { abilityRegistry, describeConfiguredAbility } from '../../game/variant/abilities/registry';
import type { AbilityId, AbilityInstance, PlayerLoadout } from '../../game/variant/types';
import { portrait } from '../portraits';
import { createAbilityCardContent } from './card-content';

type DraftDialogActions = {
  pickAbility: (abilityId: AbilityId, replaceInstanceId?: string) => boolean;
};

/** Owns the modal draft, order reveal, offered cards, and same-kind replacement choice. */
export function createAbilityDraftDialog(
  controller: GameController,
  locked: () => boolean,
  actions: DraftDialogActions,
  requestRender: () => void,
) {
  const panel = document.querySelector<HTMLElement>('#draft-panel')!;
  const status = document.querySelector<HTMLElement>('#draft-status')!;
  const order = document.querySelector<HTMLElement>('#draft-order')!;
  const contestants = document.querySelector<HTMLElement>('#draft-contestants')!;
  const cards = document.querySelector<HTMLElement>('#draft-cards')!;
  const replacement = document.querySelector<HTMLElement>('#draft-replacement')!;
  let pendingAbility: AbilityId | null = null;
  let renderedDraftKey = '';
  let presentedOrderKey = '';
  let revealingOrder = false;
  let revealTimer = 0;

  function render() {
    const config = controller.variantConfig;
    const powerups = controller.state.powerups;
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
        requestRender();
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

  function abilityCard(abilityId: AbilityId, picker: 0 | 1, canPick: boolean) {
    const config = controller.variantConfig!;
    const copy = describeConfiguredAbility(abilityId, config);
    const button = document.createElement('button');
    button.className = 'draft-card';
    button.dataset.kind = abilityRegistry[abilityId].kind;
    button.dataset.ability = abilityId;
    button.classList.toggle('selected', pendingAbility === abilityId);
    button.disabled = !canPick;
    button.setAttribute('aria-label', `Choose ${copy.name}`);
    button.append(createAbilityCardContent(abilityId, config, 'DRAFT'));
    button.onclick = () => choose(abilityId, picker);
    return button;
  }

  function choose(abilityId: AbilityId, player: 0 | 1) {
    const inventory = inventoryFor(powerupsLoadout(player), abilityId);
    if (inventory.length >= controller.inventoryCapacity(player, abilityId)) {
      pendingAbility = abilityId;
      requestRender();
      return;
    }
    if (actions.pickAbility(abilityId)) {
      pendingAbility = null;
      requestRender();
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
          requestRender();
        }
      };
      choices.append(button);
    }
    const cancel = document.createElement('button');
    cancel.className = 'draft-replacement-cancel';
    cancel.textContent = 'Choose another card';
    cancel.onclick = () => {
      pendingAbility = null;
      requestRender();
    };
    replacement.append(prompt, choices, cancel);
  }

  function powerupsLoadout(player: 0 | 1): PlayerLoadout {
    return controller.state.powerups!.loadouts[player];
  }

  return { render };
}

function inventoryFor(loadout: PlayerLoadout, abilityId: AbilityId): AbilityInstance[] {
  return abilityRegistry[abilityId].kind === 'POWERUP' ? loadout.powerups : loadout.passives;
}

const pipPositions: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

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
