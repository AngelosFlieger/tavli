import type { AbilityConfigBase, AbilityCopy, AbilityId, AbilityKind, PowerTiming } from '../types';

export type AbilityDefinition<Id extends AbilityId, Config extends AbilityConfigBase> = Readonly<{
  id: Id;
  kind: AbilityKind;
  timing?: PowerTiming;
  validateConfig: (value: unknown) => Config;
  describe: (config: Config) => AbilityCopy;
}>;

export function defineAbility<Id extends AbilityId, Config extends AbilityConfigBase>(
  definition: AbilityDefinition<Id, Config>,
): AbilityDefinition<Id, Config> {
  return Object.freeze(definition);
}
