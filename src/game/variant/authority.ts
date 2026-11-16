import { sessionMessageParts } from '../session/messages';
import type { Session } from '../session/state';
import { transitionSession, type SessionEvent } from '../session/transition';
import { sampleDraftOffer } from './draft';
import type { RulesContext } from './types';

export type DraftAuthorityResult = {
  session: Session;
  events: SessionEvent[];
  orderRolls: [number, number][];
};

/** Resolves authority-owned offer and order randomness, stopping when player input is required. */
export function advancePendingDraft(
  input: Session,
  rules: RulesContext,
  randomInt: (maximum: number) => number,
): DraftAuthorityResult {
  if (
    !rules.variantConfig ||
    input.state.phase !== 'DRAFT_ORDER' ||
    input.state.powerups?.draft?.stage !== 'AWAITING_OFFER'
  )
    return { session: input, events: [], orderRolls: [] };

  const offer = sampleDraftOffer(input.state.powerups, rules.variantConfig, randomInt);
  const opened = transitionSession(input, { type: 'openDraft', offer }, rules);
  if (!opened.ok) throw new Error(`authority could not open draft: ${opened.reason}`);
  let session = opened.session;
  const events = [...opened.events];
  const orderRolls: [number, number][] = [];
  for (let attempt = 0; attempt < 100; attempt++) {
    const rolls: [number, number] = [
      randomInt(rules.variantConfig.draft.orderDieSides) + 1,
      randomInt(rules.variantConfig.draft.orderDieSides) + 1,
    ];
    const ordered = transitionSession(session, { type: 'resolveDraftOrder', rolls }, rules);
    if (!ordered.ok) throw new Error(`authority could not resolve draft order: ${ordered.reason}`);
    session = ordered.session;
    events.push(...ordered.events);
    orderRolls.push(rolls);
    if (session.state.phase === 'DRAFT_PICK') {
      const parts = sessionMessageParts(session.state, events);
      if (parts) {
        session.state.message = parts.text;
        session.state.messageKey = parts.key;
        session.state.messageParams = parts.params;
      }
      return { session, events, orderRolls };
    }
  }
  throw new Error('draft order remained tied for 100 attempts');
}

export function secureRandomInt(maximum: number): number {
  if (!Number.isSafeInteger(maximum) || maximum <= 0 || maximum > 0x1_0000_0000)
    throw new Error('random maximum must be an integer between 1 and 2^32');
  const limit = Math.floor(0x1_0000_0000 / maximum) * maximum;
  const sample = new Uint32Array(1);
  do globalThis.crypto.getRandomValues(sample);
  while (sample[0] >= limit);
  return sample[0] % maximum;
}
