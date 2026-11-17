import type { AbilityCopy, AbilityId, ResolvedVariantConfig } from '../../game/variant/types';
import { pluralSuffix, t } from '../i18n';

function opponentTurns(count: number): string {
  const unit = t('unit.opponentTurn');
  return `${count} ${unit}${pluralSuffix(count)}`;
}

function ownTurns(count: number): string {
  const unit = t('unit.turn');
  return `${count} ${unit}${pluralSuffix(count)}`;
}

/**
 * Presents variant ability copy in the active locale. Rule logic stays in the
 * pure variant definitions; this adapter only re-renders their display strings.
 */
export function localizedAbilityCopy(id: AbilityId, config: ResolvedVariantConfig): AbilityCopy {
  switch (id) {
    case 'frostSeal': {
      const value = config.abilities.frostSeal;
      return {
        name: t('ability.frostSeal.name'),
        summary: t('ability.frostSeal.summary', { turns: opponentTurns(value.duration.count) }),
      };
    }
    case 'bastion': {
      const value = config.abilities.bastion;
      return {
        name: t('ability.bastion.name'),
        summary: t('ability.bastion.summary', { turns: opponentTurns(value.duration.count) }),
      };
    }
    case 'jinx': {
      const value = config.abilities.jinx;
      return {
        name: t('ability.jinx.name'),
        summary: t(
          value.targetToken === 'HIGHEST'
            ? 'ability.jinx.summary.highest'
            : 'ability.jinx.summary.lowest',
          { penalty: value.penalty },
        ),
      };
    }
    case 'clearSkies': {
      const value = config.abilities.clearSkies;
      return {
        name: t('ability.clearSkies.name'),
        summary: t('ability.clearSkies.summary', {
          count: value.maxEffects,
          s: pluralSuffix(value.maxEffects),
        }),
      };
    }
    case 'recast': {
      const value = config.abilities.recast;
      return {
        name: t('ability.recast.name'),
        summary: t('ability.recast.summary', {
          count: value.rerollCount,
          s: pluralSuffix(value.rerollCount),
        }),
      };
    }
    case 'nudge': {
      const value = config.abilities.nudge;
      const sign =
        value.directions.length === 2 ? '±' : value.directions[0] === 'INCREASE' ? '+' : '−';
      return {
        name: t('ability.nudge.name'),
        summary: t('ability.nudge.summary', { amount: `${sign}${value.adjustment}` }),
      };
    }
    case 'loadedKnuckles': {
      const value = config.abilities.loadedKnuckles;
      return {
        name: t('ability.loadedKnuckles.name'),
        summary: t('ability.loadedKnuckles.summary'),
        benefit: t('ability.loadedKnuckles.benefit', {
          numerator: value.matchChance.numerator,
          denominator: value.matchChance.denominator,
        }),
        drawback: t('ability.loadedKnuckles.drawback', { tokens: value.doubleMoveTokens }),
      };
    }
    case 'quartermaster': {
      const value = config.abilities.quartermaster;
      return {
        name: t('ability.quartermaster.name'),
        summary: t('ability.quartermaster.summary'),
        benefit: t('ability.quartermaster.benefit', {
          count: value.extraPowerupSlots,
          s: pluralSuffix(value.extraPowerupSlots),
        }),
        drawback: t('ability.quartermaster.drawback', { turns: ownTurns(value.cooldownOwnTurns) }),
      };
    }
    case 'homeGuard': {
      const value = config.abilities.homeGuard;
      const summary =
        value.protectOwnHome && value.restrictOpponentHome
          ? t('ability.homeGuard.summary.both')
          : value.protectOwnHome
            ? t('ability.homeGuard.summary.defense')
            : t('ability.homeGuard.summary.offense');
      return {
        name: t('ability.homeGuard.name'),
        summary,
        ...(value.protectOwnHome ? { benefit: t('ability.homeGuard.benefit') } : {}),
        ...(value.restrictOpponentHome ? { drawback: t('ability.homeGuard.drawback') } : {}),
      };
    }
    case 'opportunist': {
      const value = config.abilities.opportunist;
      return {
        name: t('ability.opportunist.name'),
        summary: t('ability.opportunist.summary'),
        benefit: t('ability.opportunist.benefit', {
          gain: value.focusGain,
          cap: value.focusCap,
          adjustment: value.focusAdjustment,
        }),
        drawback: t('ability.opportunist.drawback', { slots: value.equippedPowerupSlots }),
      };
    }
  }
}
