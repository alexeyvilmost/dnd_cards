import type {CharacterContext, RuntimeState} from '../mvp/contracts';
import {evaluate, FormulaError, type FormulaContext} from './formula';
import {matchesWhen, type EvalContext} from './circumstances';
import {payloadsOf} from './mechanicsView';
import {isWearingArmor} from './equipment';

type Dict = Record<string, unknown>;
const object = (value: unknown): value is Dict => !!value && typeof value === 'object' && !Array.isArray(value);
export interface StaticDamageReduction {
  amount: number;
  source: string;
  sourceEntityIds: string[];
}

/** A passive reduction has no cost, dice or decision. Reactions and triggered
 * listeners retain their existing authoritative continuation path. Unknown
 * filters/conditions fail closed, so a partial declaration cannot reduce all
 * damage by accident. Each typed incoming packet is one evaluation. */
export function staticDamageReductions(input: {
  mechanics: Dict[];
  state: RuntimeState;
  character: CharacterContext;
  formula: FormulaContext;
  conditions: EvalContext;
  damageType: string;
  delivery: 'attack' | 'other';
  critical?: boolean;
}): StaticDamageReduction[] {
  const out: StaticDamageReduction[] = [];
  const scoreVariables: Record<string, number> = {};
  for (const ability of ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const) {
    const score = input.character.abilityScores?.[ability];
    if (typeof score === 'number' && Number.isFinite(score)) scoreVariables[`${ability}_score`] = score;
  }
  const formula: FormulaContext = {...input.formula, variables: {
    ...Object.fromEntries(Object.entries(input.formula.variables ?? {}).filter(([key, value]) => !key.endsWith('_score') && typeof value === 'number')),
    ...scoreVariables,
  },rng:()=>{throw new FormulaError('Static damage reduction cannot roll dice');}};
  const conditionsMatch = (when: unknown) => when === undefined || (Array.isArray(when) && when.every(object) && matchesWhen(when, input.conditions));
  for (const mechanics of input.mechanics) {
    const activation = object(mechanics.activation) ? mechanics.activation : undefined;
    if (activation?.mode !== undefined && activation.mode !== 'passive') continue;
    if (!conditionsMatch(mechanics.when) || !conditionsMatch(activation?.when)) continue;
    const payloads = mechanics.kind === 'reduce_damage' ? [mechanics] : payloadsOf(mechanics);
    for (const payload of payloads) {
      if (payload.kind !== 'reduce_damage' || !conditionsMatch(payload.when)) continue;
      if (payload.filter !== undefined && !object(payload.filter)) continue;
      const filter = object(payload.filter) ? payload.filter : {};
      if (Object.keys(filter).some(key => !['source','damage_types','armor','critical'].includes(key))) continue;
      if (filter.critical !== undefined && (typeof filter.critical!=='boolean' || filter.critical!==(input.critical===true))) continue;
      if (filter.source !== undefined && filter.source !== input.delivery) continue;
      if (filter.damage_types !== undefined && (!Array.isArray(filter.damage_types)
        || filter.damage_types.some(type => typeof type !== 'string')
        || !filter.damage_types.includes(input.damageType))) continue;
      if (filter.armor !== undefined && (typeof filter.armor !== 'string'
        || !['light','medium','heavy'].includes(filter.armor)
        || !isWearingArmor(input.state, [...input.character.equippedCards ?? [], ...input.character.knownCards ?? []], filter.armor))) continue;
      if (typeof payload.amount !== 'number' && typeof payload.amount !== 'string') continue;
      const expression = String(payload.amount);
      // Static reductions must never roll hidden dice while receiving damage.
      if (/\d+\s*[dдк]\s*\d+/iu.test(expression)) continue;
      let evaluated: ReturnType<typeof evaluate>;
      try { evaluated = evaluate(expression, formula); }
      catch (error) { if (error instanceof FormulaError) continue; throw error; }
      if (typeof evaluated !== 'number' || !Number.isFinite(evaluated)) continue;
      const amount = Math.max(0, Math.floor(evaluated));
      if (!amount) continue;
      const declaredIds = [payload.sourceEntityIds, payload.source_entity_ids, mechanics.sourceEntityIds, mechanics.source_entity_ids]
        .flatMap(value => Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string' && id.length > 0) : []);
      const id = typeof mechanics.id === 'string' ? mechanics.id : undefined;
      const sourceEntityIds = [...new Set([...declaredIds, ...(id ? [id] : [])])];
      const source = [payload.source, mechanics.name, id].find(value => typeof value === 'string' && value.length > 0);
      out.push({amount, source: typeof source === 'string' ? source : 'Снижение урона', sourceEntityIds});
    }
  }
  return out;
}
