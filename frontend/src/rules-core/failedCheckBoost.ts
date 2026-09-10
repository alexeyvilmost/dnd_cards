import {canPay, pay, runtimeBoonSpec, addBonusDieToD20Roll, type EngineEvent, type RollLog} from './legacy/engineAdapter';
import type {ActorState, RuleActionDefinition, RulesCatalog} from './domain';

type Dict = Record<string, unknown>;

/** Exact declarative shape: a triggered self boon added to this failed check.
 * No action-name/UUID switches, and no arbitrary action effects are skipped. */
export function failedCheckBoostSpec(actor: ActorState, action: RuleActionDefinition) {
  const activation = action.mechanics.activation as Dict | undefined;
  const trigger = activation?.trigger as Dict | undefined;
  if (action.kind !== 'nonSpell' || activation?.mode !== 'triggered'
    || !Array.isArray(trigger?.events) || !trigger.events.includes('ability_check_failed')) return null;
  const targeting = action.mechanics.targeting as Dict | undefined;
  if (targeting && targeting.shape !== 'self') return null;
  const effects = action.mechanics.effects as Dict[] | undefined;
  if (!Array.isArray(effects) || effects.length !== 1 || effects[0].resolution !== 'auto') return null;
  const result = effects[0].result as Dict[] | undefined;
  if (!Array.isArray(result) || result.length !== 1 || result[0].kind !== 'grant_effect') return null;
  const effect = actor.grantedEffects?.[String(result[0].value)];
  if (!effect?.mechanics || typeof effect.mechanics !== 'object') return null;
  const spec = runtimeBoonSpec({id: String(effect.id ?? result[0].value), name: effect.name ?? action.name,
    source: action.name, mechanics: effect.mechanics as Dict});
  if (!spec?.appliesTo.includes('ability_check') || !spec.timing.includes('after_failure')) return null;
  return spec;
}

export function failedCheckBoostActions(actor: ActorState, catalog: RulesCatalog) {
  return actor.capabilities.actionIds.flatMap(id => {
    const action = catalog.getAction(id);
    if (!action || !failedCheckBoostSpec(actor, action)) return [];
    const activation = action.mechanics.activation as Dict;
    const cost = activation.cost;
    if (!Array.isArray(cost) || !canPay(actor.runtime, cost).ok) return [];
    return [action];
  });
}

export function applyFailedCheckBoost(actor: ActorState, action: RuleActionDefinition, roll: RollLog, rng: () => number) {
  const spec = failedCheckBoostSpec(actor, action);
  const activation = action.mechanics.activation as Dict;
  const cost = activation?.cost as Dict[];
  if (!spec || roll.kind !== 'd20' || roll.outcome !== 'fail' || roll.target?.type !== 'dc'
    || !Array.isArray(cost) || !canPay(actor.runtime, cost).ok) throw Error('Недоступный бонус к проваленной проверке');
  const paid = pay(actor.runtime, cost);
  const augmented = addBonusDieToD20Roll(roll, spec.faces, action.name, rng);
  let runtime = paid.state;
  const events: EngineEvent[] = [...paid.events];
  if (augmented.outcome === 'fail' && spec.refundOnFailure) {
    const {resource, amount} = spec.refundOnFailure;
    const current = runtime.resources[resource] ?? 0;
    const next = Math.min(runtime.maxResources[resource] ?? current, current + amount);
    if (next > current) {
      runtime = {...runtime, resources: {...runtime.resources, [resource]: next}};
      events.push({type: 'resource_restored', resource, amount: next - current, current: next});
    }
  }
  events.push({type: 'roll', label: action.name, roll: {...augmented, kind: 'check'}});
  return {runtime, roll: augmented, events};
}