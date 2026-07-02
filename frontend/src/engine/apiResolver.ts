import { actionsApi, effectsApi, featsApi, spellsApi } from '../api/client';
import type { EntityResolver } from './registry';

/** Резолвер сущностей через API (UUID или card_number). */
export function createApiResolver(): EntityResolver {
  return {
    resolveSpell: (slug) => spellsApi.getSpell(slug).catch(() => null),
    resolveAction: (slug) => actionsApi.getAction(slug).catch(() => null),
    resolveEffect: (slug) => effectsApi.getEffect(slug).catch(() => null),
    resolveFeat: (slug) => featsApi.getFeat(slug).catch(() => null),
  };
}
