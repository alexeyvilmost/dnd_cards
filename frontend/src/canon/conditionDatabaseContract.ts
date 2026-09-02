import type { EntitySupportCertification } from '../content/supportStatus';
import {
  BUILTIN_CONDITION_RULES,
  type ConditionModifier,
  type ConditionRule,
} from '../engine/conditions';
import { payloadsOf } from '../engine/mechanicsView';
import { canonicalSha256 } from '../rules-core/determinism';
import { certifiedExecutableRootProjection } from './certifiedContentProjection';

export interface ConditionEffectRecord {
  id?: string;
  card_number?: string | null;
  name: string;
  name_en?: string | null;
  description?: string | null;
  detailed_description?: string | null;
  image_url?: string | null;
  rarity?: string | null;
  author?: string | null;
  source?: string | null;
  effect_type?: string | null;
  mechanics?: unknown;
  support?: EntitySupportCertification | null;
}

export type CertifiedConditionEffectEntity = ConditionEffectRecord & {
  id: string;
  effect_type: 'condition';
  mechanics: Record<string, unknown>;
};

export const MICRO_MVP_CONDITION_CERTIFICATION_VERSION = 'micro-mvp-l1-rules-core-v4';

const CONDITION_ID = /^[a-z][a-z0-9_-]*$/;
const CONDITION_MODIFIER_OPS = new Set<ConditionModifier['op']>([
  'advantage', 'disadvantage', 'add', 'set', 'multiply', 'upgrade', 'downgrade',
  'auto_fail', 'auto_crit', 'deny',
]);
const CERTIFICATION_VOLATILE_FIELDS = [
  'support', 'created_at', 'updated_at', 'deleted_at',
] as const;

export function isCompleteConditionRule(rule: ConditionRule | null): rule is ConditionRule {
  if (!rule || !CONDITION_ID.test(rule.id) || !rule.label.trim()) return false;
  if (!Array.isArray(rule.modifiers) || rule.modifiers.some((modifier) => (
    !modifier
      || typeof modifier !== 'object'
      || !modifier.applies_to
      || typeof modifier.applies_to.roll !== 'string'
      || !modifier.applies_to.roll.trim()
      || !CONDITION_MODIFIER_OPS.has(modifier.op)
  ))) return false;
  const dependencies = [...(rule.includes ?? []), ...(rule.leaves ?? [])];
  const conditionIds = Object.keys(BUILTIN_CONDITION_RULES);
  if (dependencies.some((dependency) => !conditionIds.includes(dependency))) return false;
  if (rule.stacking
    && rule.stacking.mode !== 'binary'
    && rule.stacking.mode !== 'levels') return false;
  if (rule.stacking?.max != null
    && (!Number.isSafeInteger(rule.stacking.max) || rule.stacking.max <= 0)) return false;
  if (rule.longRest) {
    const removeLevels = rule.longRest.removeLevels;
    if (removeLevels == null || !Number.isSafeInteger(removeLevels) || removeLevels < 0) return false;
  }
  return !(rule.thresholds ?? []).some((threshold) => (
    !Number.isSafeInteger(threshold.atLevel)
      || threshold.atLevel <= 0
      || threshold.outcome !== 'death'
  ));
}

function toConditionModifier(payload: Record<string, unknown>): ConditionModifier | null {
  if (payload.kind !== 'modifier') return null;
  const applies = payload.applies_to as ConditionModifier['applies_to'] | undefined;
  if (!applies?.roll) return null;
  return {
    applies_to: applies,
    op: String(payload.op ?? 'add') as ConditionModifier['op'],
    ...(payload.value != null ? { value: String(payload.value) } : {}),
    ...(payload.scope === 'target' ? { scope: 'target' as const } : {}),
    ...(payload.range === 'melee' || payload.range === 'ranged'
      ? { range: payload.range as 'melee' | 'ranged' }
      : {}),
    ...(Array.isArray(payload.when) ? { when: payload.when as Record<string, unknown>[] } : {}),
  };
}

/** Pure DB effect to engine rule materializer, shared by browser bootstrap and
 * the Node-backed certification/Playwright boundaries. */
export function materializeConditionRule(effect: ConditionEffectRecord): ConditionRule | null {
  const payloads = payloadsOf(effect.mechanics as Record<string, unknown> | undefined);
  const modifiers = payloads
    .map(toConditionModifier)
    .filter((modifier): modifier is ConditionModifier => modifier !== null);
  const mechanics = effect.mechanics as Record<string, unknown> | undefined;
  const condition = mechanics?.condition as Record<string, unknown> | undefined;
  const id = typeof condition?.id === 'string' ? condition.id.trim() : '';
  if (!CONDITION_ID.test(id)) return null;
  const rawIncludes = mechanics?.includes;
  const includes = Array.isArray(rawIncludes) ? rawIncludes.map(String) : undefined;
  const rawLeaves = mechanics?.leaves;
  const leaves = Array.isArray(rawLeaves) ? rawLeaves.map(String) : undefined;
  const stacking = mechanics?.stacking as ConditionRule['stacking'] | undefined;
  const rawLongRest = (mechanics?.long_rest ?? mechanics?.longRest) as Record<string, unknown> | undefined;
  const removeLevels = Number(rawLongRest?.remove_levels ?? rawLongRest?.removeLevels);
  const longRest = Number.isFinite(removeLevels) && removeLevels >= 0
    ? { removeLevels }
    : undefined;
  const rawThresholds = mechanics?.thresholds;
  const thresholds = Array.isArray(rawThresholds)
    ? rawThresholds.flatMap((threshold) => {
      if (!threshold || typeof threshold !== 'object') return [];
      const row = threshold as Record<string, unknown>;
      const atLevel = Number(row.at_level ?? row.atLevel);
      return Number.isInteger(atLevel) && atLevel > 0 && row.outcome === 'death'
        ? [{ atLevel, outcome: 'death' as const }]
        : [];
    })
    : undefined;
  const worldFacts = mechanics?.world_facts;
  return {
    id,
    label: effect.name,
    ...(typeof effect.id === 'string' && effect.id.trim()
      ? {
          entityRef: {
            kind: 'effect' as const,
            id: effect.id,
            ...(typeof effect.card_number === 'string' && effect.card_number.trim()
              ? { cardNumber: effect.card_number }
              : {}),
          },
        }
      : {}),
    modifiers,
    payloads: payloads.filter((payload) => payload.kind !== 'modifier'),
    ...(includes?.length ? { includes } : {}),
    ...(leaves?.length ? { leaves } : {}),
    ...(stacking?.mode === 'levels' || stacking?.mode === 'binary' ? { stacking } : {}),
    ...(longRest ? { longRest } : {}),
    ...(thresholds?.length ? { thresholds } : {}),
    ...(worldFacts && typeof worldFacts === 'object' && !Array.isArray(worldFacts)
      ? { worldFacts: worldFacts as Record<string, unknown> }
      : {}),
    note: effect.description || undefined,
  };
}

/** Exact executable root hash shared by server-loaded and isolated fixture rows. */
export async function conditionRecordContentHash(
  effect: ConditionEffectRecord,
): Promise<string> {
  return canonicalSha256(certifiedExecutableRootProjection(
    effect,
    CERTIFICATION_VOLATILE_FIELDS,
  ));
}
