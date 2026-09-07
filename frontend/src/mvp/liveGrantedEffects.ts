import { API_BASE_URL } from '../api/client';
import {
  buildMaterializedRuntimeEffectRegistry,
  resolveMaterializedRuntimeEffects,
} from '../canon/materializedRuntimeEffects';
import type { PassiveEffect } from '../types';
import type { ExecuteContext } from './contracts';
import { readLiveJson } from './liveJsonRead';

export type GrantedEffectRegistry = NonNullable<ExecuteContext['grantedEffects']>;

let liveEffectsPromise: Promise<PassiveEffect[]> | undefined;

/** Load the same effects catalog that the character sheet preloads for
 * synchronous grant_effect execution. The promise is shared by callers in the
 * same Vitest worker so a live suite does not request identical pages twice. */
export function fetchLiveGrantedEffects(): Promise<PassiveEffect[]> {
  liveEffectsPromise ??= (async () => {
    const effects: PassiveEffect[] = [];
    const seenIds = new Set<string>();
    let expectedTotal: number | null = null;
    for (let page = 1; page <= 100; page += 1) {
      const body = await readLiveJson<Record<string, unknown>>(
        `${API_BASE_URL}/api/effects?page=${page}&limit=1000`,
        { label: '/api/effects' },
      );
      if (!Array.isArray(body.effects)) {
        throw new Error('/api/effects: required collection effects is missing');
      }
      const batch = body.effects as PassiveEffect[];
      const responseTotal = Number(body.total);
      if (Number.isSafeInteger(responseTotal) && responseTotal >= 0) {
        if (expectedTotal !== null && responseTotal !== expectedTotal) {
          throw new Error(`/api/effects: total changed from ${expectedTotal} to ${responseTotal}`);
        }
        expectedTotal = responseTotal;
      }
      for (const effect of batch) {
        if (!effect.id || seenIds.has(effect.id)) {
          throw new Error(`/api/effects: pagination repeated or omitted entity id ${effect.id || '<blank>'}`);
        }
        seenIds.add(effect.id);
        effects.push(effect);
      }
      if (expectedTotal !== null) {
        if (effects.length === expectedTotal) return effects;
        if (effects.length > expectedTotal || batch.length === 0) {
          throw new Error(`/api/effects: received ${effects.length}/${expectedTotal} records`);
        }
      } else if (batch.length < 1000) {
        return effects;
      }
    }
    throw new Error('/api/effects: pagination exceeded 100 pages');
  })();
  return liveEffectsPromise;
}

export function buildGrantedEffectRegistry(effects: PassiveEffect[]): GrantedEffectRegistry {
  return buildMaterializedRuntimeEffectRegistry(effects.map((effect) => ({
      id: effect.id,
      card_number: effect.card_number,
      name: effect.name,
      mechanics: effect.mechanics,
      repeatable: effect.repeatable,
  }))) as GrantedEffectRegistry;
}

export { resolveMaterializedRuntimeEffects };
