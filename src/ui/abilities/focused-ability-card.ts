import type { GameController } from '../../app/game-controller';
import type { Player } from '../../game/rules/position';
import { abilityRegistry } from '../../game/variant/abilities/registry';
import type { AbilityInstance } from '../../game/variant/types';
import { t } from '../i18n';
import { createAbilityCardContent } from './card-content';

type FocusedAbilityActions = {
  selectAbility: (instanceId: string) => boolean;
  cancelAbility: () => void;
};

export function createFocusedAbilityCard(
  controller: GameController,
  locked: () => boolean,
  actions: FocusedAbilityActions,
  instance: AbilityInstance,
  player: Player,
  closeCard: () => void,
  requestRender: () => void,
): HTMLElement {
  const config = controller.variantConfig!;
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
  close.setAttribute('aria-label', t('ability.close'));
  close.textContent = '×';
  close.onclick = () => {
    if (controller.selectedAbility?.instanceId === instance.instanceId) actions.cancelAbility();
    closeCard();
    requestRender();
  };
  detailCard.append(close, createAbilityCardContent(instance.abilityId, config, 'FOCUS'));
  const use = document.createElement('button');
  use.type = 'button';
  use.className = 'ability-use';
  const selected = controller.selectedAbility?.instanceId === instance.instanceId;
  const passive = abilityRegistry[instance.abilityId].kind === 'PASSIVE';
  use.disabled = !canUse || selected;
  use.textContent = selected
    ? t('ability.selected')
    : canUse
      ? t('ability.use')
      : passive
        ? t('ability.alwaysActive')
        : t('ability.notPlayable');
  use.onclick = () => {
    if (actions.selectAbility(instance.instanceId)) requestRender();
  };
  detailCard.append(use);
  return detailCard;
}
