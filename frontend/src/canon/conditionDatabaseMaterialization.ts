import {
  materializeConditionRule,
  type ConditionEffectRecord,
} from '../api/conditionsApi';
import {
  BUILTIN_CONDITION_RULES,
  type ConditionRule,
} from '../engine/conditions';
import { canonicalStringify } from '../rules-core/determinism';

/** Only executable mechanics are compared. Database-localized labels and
 * descriptions are presentation data and intentionally need not equal the
 * offline recovery fixture. */
function executableConditionShape(rule: ConditionRule): Record<string, unknown> {
  return {
    id: rule.id,
    modifiers: rule.modifiers,
    payloads: rule.payloads ?? [],
    includes: rule.includes ?? [],
    leaves: rule.leaves ?? [],
    stacking: rule.stacking ?? null,
    longRest: rule.longRest ?? null,
    thresholds: rule.thresholds ?? [],
    worldFacts: rule.worldFacts ?? {},
  };
}

/** Release gate for the real DB/browser anti-corruption adapter. It proves
 * that all 15 versioned condition records survive materialization into the
 * already atomically tested executable rules, with no dropped predicates,
 * payloads, lifecycle fields, or world facts. */
export function validateConditionDatabaseMaterialization(
  records: readonly ConditionEffectRecord[],
): void {
  const expectedIds = Object.keys(BUILTIN_CONDITION_RULES).sort();
  const rules = records.map((record) => materializeConditionRule(record));
  const actualIds = rules.flatMap((rule) => rule ? [rule.id] : []).sort();
  const problems: string[] = [];

  if (records.length !== expectedIds.length) {
    problems.push(`expected ${expectedIds.length} condition records, got ${records.length}`);
  }
  if (rules.some((rule) => rule === null)) {
    problems.push('one or more records have no valid mechanics.condition.id');
  }
  if (new Set(actualIds).size !== actualIds.length) {
    problems.push('materialized condition ids are duplicated');
  }
  if (canonicalStringify(actualIds) !== canonicalStringify(expectedIds)) {
    problems.push(`condition id set differs: ${actualIds.join(', ')}`);
  }

  for (const id of expectedIds) {
    const actual = rules.find((rule) => rule?.id === id);
    if (!actual) continue;
    const expected = BUILTIN_CONDITION_RULES[id];
    if (canonicalStringify(executableConditionShape(actual))
      !== canonicalStringify(executableConditionShape(expected))) {
      problems.push(`${id}: database materializer changes or drops executable mechanics`);
    }
  }

  if (problems.length) {
    throw new Error(`Condition database materialization gate failed:\n${problems.join('\n')}`);
  }
}
