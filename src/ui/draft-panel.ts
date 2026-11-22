import type { GameController } from '../app/game-controller';
import type { AbilityId } from '../game/variant/types';
import { createAbilityDraftDialog } from './abilities/draft-dialog';
import { createAbilityLoadouts } from './abilities/loadout-stack';

type DraftPanelActions = {
  pickAbility: (abilityId: AbilityId, replaceInstanceId?: string) => boolean;
  selectAbility: (instanceId: string) => boolean;
  cancelAbility: () => void;
};

/** Composes the independent ability draft and player-loadout views. */
export function createDraftPanel(
  controller: GameController,
  locked: () => boolean,
  actions: DraftPanelActions,
) {
  const draft = createAbilityDraftDialog(controller, locked, actions, render);
  const loadouts = createAbilityLoadouts(controller, locked, actions, render);

  function render() {
    const config = controller.variantConfig;

    loadouts.render(config ? controller.state.powerups?.loadouts : undefined);
    draft.render();
  }

  return { render };
}
