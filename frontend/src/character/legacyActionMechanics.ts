import type { Action } from '../types';

type Dict = Record<string, unknown>;

const BARDIC_INSPIRATION_CARD = 'ACT-bardic-inspiration';

function isLegacyBardicInspirationNarrative(mechanics: Dict): boolean {
  const effects = mechanics.effects;
  if (!Array.isArray(effects) || effects.length !== 1) return false;
  const effect = effects[0] as Dict;
  const result = effect.result;
  if (effect.resolution !== 'auto' || !Array.isArray(result) || result.length !== 1) return false;
  const payload = result[0] as Dict;
  return payload.kind === 'narrative'
    && typeof payload.description === 'string'
    && payload.description.includes('кость вдохновения');
}

/**
 * Compatibility upgrade for the production Bard action authored before typed
 * cross-sheet boons existed. It is deliberately preimage-gated: once content
 * is repaired, or if the row differs unexpectedly, the catalog bytes win.
 */
export function upgradeLegacyActionMechanics(
  action: Pick<Action, 'card_number' | 'mechanics'>,
): Dict | null | undefined {
  const mechanics = action.mechanics as Dict | null | undefined;
  if (action.card_number !== BARDIC_INSPIRATION_CARD
    || !mechanics
    || !isLegacyBardicInspirationNarrative(mechanics)) return mechanics;
  return {
    ...mechanics,
    effects: [{
      resolution: 'auto',
      who: 'target',
      result: [{
        kind: 'boon',
        id: 'bardic_inspiration',
        die: '1d6',
        applies_to: ['ability_check', 'attack_roll', 'saving_throw'],
        expires: '1 час',
      }],
    }],
  };
}
