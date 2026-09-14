import type {Action} from '../types';
import type {RuntimeState} from '../mvp/contracts';
import {actionUsesKey} from './actionUses';
import {costKey} from './cost';

/** Read the same materialized pool the executor spends; never infer a full pool. */
export function actionUsagePreview(action: Pick<Action,'id'|'card_number'|'mechanics'>, runtime?: Pick<RuntimeState,'resources'|'maxResources'>) {
  if (!runtime) return [];
  const activation=action.mechanics?.activation as {cost?:Record<string,unknown>[]} | undefined;
  const personalKey=actionUsesKey(action.card_number || action.id);
  const costs=Array.isArray(activation?.cost)?activation.cost:[];
  const keys=new Set([personalKey,...costs.map(cost=>cost.resource==='self_uses'?personalKey:costKey(cost))]);
  const turnPools=new Set(['action','bonus_action','reaction','action_surge_action','quickened_spell_action','item','equipped_weapon_ammo']);
  return [...keys].flatMap(key=>{
    const maximum=runtime.maxResources[key];
    if (turnPools.has(key) || /^(spell_slot|pact_slot|warlock_spell_slot)_/.test(key) || !Number.isFinite(maximum) || maximum<=0) return [];
    const remaining=Math.max(0,Math.min(maximum,runtime.resources[key]??0));
    return [{key,maximum,remaining,spent:maximum-remaining}];
  });
}
