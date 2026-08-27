import { effectsApi } from './client';
import {
  BUILTIN_CONDITION_RULES,
  conditionRegistryAuthority,
  replaceConditionsFromDatabase,
  resetConditionsToOfflineFixture,
  type ConditionModifier,
  type ConditionRule,
} from '../engine/conditions';
import { payloadsOf } from '../engine/mechanicsView';
import type { EntitySupportCertification } from '../content/supportStatus';
import { canonicalSha256 } from '../rules-core/determinism';
import { certifiedExecutableRootProjection } from '../canon/certifiedContentProjection';

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

const CONDITION_IDS = Object.keys(BUILTIN_CONDITION_RULES).sort();
const CONDITION_PAGE_LIMIT = 200;
const CONDITION_MAX_PAGES = 10_000;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONDITION_ID = /^[a-z][a-z0-9_-]*$/;
const RFC3339_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
export const MICRO_MVP_CONDITION_CERTIFICATION_VERSION = 'micro-mvp-l1-rules-core-v4';
const CERTIFICATION_VOLATILE_FIELDS = [
  'support', 'created_at', 'updated_at', 'deleted_at',
] as const;
const RELEASE_EVIDENCE_FIELDS = [
  'certification_version', 'certified_at', 'evidence_id', 'evidence_hash',
  'evidence_completed_at', 'gate_source_hash', 'source_content_hash',
  'rules_hash', 'release_content_hash', 'release_hash', 'patch_hash',
  'catalog_hash',
] as const satisfies readonly (keyof EntitySupportCertification)[];

export interface ExpectedConditionReleaseBinding {
  certificationVersion: typeof MICRO_MVP_CONDITION_CERTIFICATION_VERSION;
  /** Hash of the rules/overlay executable policy certified by the release. */
  rulesHash: string;
  /** Exact contentHash carried by the current compiled RulesetReference. */
  releaseContentHash: string;
  /** Hash of the complete compiled release envelope. */
  releaseHash: string;
}

type CertifiedConditionEntityCatalog = {
  setHash: string;
  byConditionId: Map<string, CertifiedConditionEffectEntity>;
};

let certifiedConditionEntityCatalog: CertifiedConditionEntityCatalog | null = null;

/** Exact certified DB entity behind a registered condition. Offline fixture
 * rules remain available for recovery/tips, but can never authorize a runtime
 * mutation because they have no current DB entity provenance. */
export function certifiedConditionEffectEntity(
  conditionId: string,
): CertifiedConditionEffectEntity | null {
  const authority = conditionRegistryAuthority();
  if (authority.mode !== 'database_release'
    || certifiedConditionEntityCatalog?.setHash !== authority.setHash) {
    return null;
  }
  const entity = certifiedConditionEntityCatalog.byConditionId.get(conditionId);
  return entity ? structuredClone(entity) : null;
}

function releaseEvidenceIdentity(effect: ConditionEffectRecord): string {
  return JSON.stringify(RELEASE_EVIDENCE_FIELDS.map((field) => effect.support?.[field] ?? null));
}

const CONDITION_MODIFIER_OPS = new Set<ConditionModifier['op']>([
  'advantage', 'disadvantage', 'add', 'set', 'multiply', 'upgrade', 'downgrade',
  'auto_fail', 'auto_crit', 'deny',
]);

function isCompleteConditionRule(rule: ConditionRule | null): rule is ConditionRule {
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
  if (dependencies.some((dependency) => !CONDITION_IDS.includes(dependency))) return false;
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

/** Payload modifier эффекта-состояния → правило ConditionModifier (scope сохраняется). */
function toConditionModifier(p: Record<string, unknown>): ConditionModifier | null {
  if (p.kind !== 'modifier') return null;
  const applies = p.applies_to as ConditionModifier['applies_to'] | undefined;
  if (!applies?.roll) return null;
  return {
    applies_to: applies,
    op: String(p.op ?? 'add') as ConditionModifier['op'],
    ...(p.value != null ? { value: String(p.value) } : {}),
    ...(p.scope === 'target' ? { scope: 'target' as const } : {}),
    ...(p.range === 'melee' || p.range === 'ranged' ? { range: p.range as 'melee' | 'ranged' } : {}),
    ...(Array.isArray(p.when) ? { when: p.when as Record<string, unknown>[] } : {}),
  };
}

/** Pure DB-effect -> engine-rule materializer. Kept exported so release gates
 * can prove new condition mechanics survive API loading without field loss. */
export function materializeConditionRule(e: ConditionEffectRecord): ConditionRule | null {
  const payloads = payloadsOf(e.mechanics as Record<string, unknown> | undefined);
  const modifiers = payloads
    .map(toConditionModifier)
    .filter((modifier): modifier is ConditionModifier => modifier !== null);
  const mech = e.mechanics as Record<string, unknown> | undefined;
  const condition = mech?.condition as Record<string, unknown> | undefined;
  const id = typeof condition?.id === 'string' ? condition.id.trim() : '';
  if (!CONDITION_ID.test(id)) return null;
  const rawIncludes = mech?.includes;
  const includes = Array.isArray(rawIncludes) ? rawIncludes.map(String) : undefined;
  const rawLeaves = mech?.leaves;
  const leaves = Array.isArray(rawLeaves) ? rawLeaves.map(String) : undefined;
  const stacking = mech?.stacking as ConditionRule['stacking'] | undefined;
  const rawLongRest = (mech?.long_rest ?? mech?.longRest) as Record<string, unknown> | undefined;
  const removeLevels = Number(rawLongRest?.remove_levels ?? rawLongRest?.removeLevels);
  const longRest = Number.isFinite(removeLevels) && removeLevels >= 0
    ? { removeLevels }
    : undefined;
  const rawThresholds = mech?.thresholds;
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
  const worldFacts = mech?.world_facts;
  return {
    id,
    label: e.name,
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
    note: e.description || undefined,
  };
}

/** Same root projection as scripts/content/certification-hash.mjs. Keeping the
 * hash check at the runtime boundary prevents a syntactically valid but stale
 * certification from activating different condition mechanics. */
export async function conditionRecordContentHash(
  effect: ConditionEffectRecord,
): Promise<string> {
  return canonicalSha256(certifiedExecutableRootProjection(
    effect,
    CERTIFICATION_VOLATILE_FIELDS,
  ));
}

function validExpectedReleaseBinding(
  expected: ExpectedConditionReleaseBinding,
): boolean {
  return expected?.certificationVersion === MICRO_MVP_CONDITION_CERTIFICATION_VERSION
    && [expected.rulesHash, expected.releaseContentHash, expected.releaseHash]
      .every((hash) => typeof hash === 'string' && SHA256.test(hash));
}

async function certifiedHashes(
  effect: ConditionEffectRecord,
  expected: ExpectedConditionReleaseBinding,
): Promise<{
  contentHash: string;
  dependencyHash: string;
} | null> {
  const support = effect.support;
  if (support?.status !== 'verified_mechanical'
    || support.certification_version !== MICRO_MVP_CONDITION_CERTIFICATION_VERSION
    || support.rules_hash !== expected.rulesHash
    || support.release_content_hash !== expected.releaseContentHash
    || support.release_hash !== expected.releaseHash
    || !support.certified_at
    || !RFC3339_UTC.test(support.certified_at)
    || Number.isNaN(Date.parse(support.certified_at))
    || !support.content_hash
    || !SHA256.test(support.content_hash)
    || !support.dependency_hash
    || !SHA256.test(support.dependency_hash)
    || !support.evidence_id
    || !UUID.test(support.evidence_id)
    || !support.evidence_completed_at
    || !RFC3339_UTC.test(support.evidence_completed_at)
    || Number.isNaN(Date.parse(support.evidence_completed_at))
    || ![
      support.evidence_hash,
      support.gate_source_hash,
      support.source_content_hash,
      support.rules_hash,
      support.release_content_hash,
      support.release_hash,
      support.patch_hash,
      support.catalog_hash,
    ].every((hash) => typeof hash === 'string' && SHA256.test(hash))) {
    return null;
  }
  const actualContentHash = await conditionRecordContentHash(effect);
  if (actualContentHash !== support.content_hash) return null;
  return {
    contentHash: support.content_hash,
    dependencyHash: support.dependency_hash,
  };
}

async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export type ConditionLoadResult =
  | { mode: 'database_release'; count: number; setHash: string }
  | { mode: 'offline_fixture'; reason: string };

async function fetchAllConditionRows(timeoutMs?: number): Promise<ConditionEffectRecord[]> {
  const rows: ConditionEffectRecord[] = [];
  let expectedTotal: number | undefined;
  for (let page = 1; page <= CONDITION_MAX_PAGES; page += 1) {
    const response = await effectsApi.getEffects(
      { effect_type: 'condition', page, limit: CONDITION_PAGE_LIMIT },
      { timeoutMs },
    );
    if (!Array.isArray(response.effects)) {
      throw new Error('condition API returned no effects collection');
    }
    const total = Number(response.total);
    if (!Number.isInteger(total) || total < 0) {
      throw new Error('condition API returned an invalid total');
    }
    if (expectedTotal === undefined) expectedTotal = total;
    if (expectedTotal !== total) {
      throw new Error('condition API total changed during pagination');
    }
    rows.push(...response.effects as ConditionEffectRecord[]);
    if (rows.length === expectedTotal) return rows;
    if (rows.length > expectedTotal) {
      throw new Error('condition API returned more rows than advertised');
    }
    if (response.effects.length === 0) {
      throw new Error('condition API pagination ended before advertised total');
    }
  }
  throw new Error(`condition API exceeded ${CONDITION_MAX_PAGES} pages`);
}

/**
 * Догрузить состояния из эффектов типа 'condition' в реестр движка. Состояние — это
 * ЭФФЕКТ (effect_type='condition'); его scoped-модификаторы (self/target) лежат в mechanics.
 * При ошибке весь набор отклоняется и реестр явно возвращается к offline fixture.
 */
export async function loadConditions(
  options: {
    timeoutMs?: number;
    expectedRelease: ExpectedConditionReleaseBinding;
  },
): Promise<ConditionLoadResult> {
  // A reload never leaves the previous mutation catalog usable while the new
  // release is being fetched/certified.
  certifiedConditionEntityCatalog = null;
  try {
    if (!validExpectedReleaseBinding(options.expectedRelease)) {
      throw new Error('current compiled condition release binding is invalid or missing');
    }
    const rows = await fetchAllConditionRows(options.timeoutMs);
    // The table may also contain homebrew or future conditions. They remain
    // ordinary content, but only rows attested by this exact release suite can
    // participate in the authoritative PHB registry.
    const releaseRows = rows.filter((row) => (
      row.support?.certification_version === MICRO_MVP_CONDITION_CERTIFICATION_VERSION
    ));
    const materialized = await Promise.all(releaseRows.map(async (row) => ({
      row,
      rule: materializeConditionRule(row),
      hashes: await certifiedHashes(row, options.expectedRelease),
    })));
    const ids = materialized.flatMap(({ rule }) => rule ? [rule.id] : []).sort();
    const evidenceIdentities = new Set(materialized.map(({ row }) => (
      releaseEvidenceIdentity(row)
    )));
    const exact = materialized.length === CONDITION_IDS.length
      && materialized.every(({ row, rule, hashes }) => (
        row.effect_type === 'condition'
          && typeof row.id === 'string'
          && row.id.trim().length > 0
          && typeof row.name === 'string'
          && row.name.trim().length > 0
          && !!row.mechanics
          && typeof row.mechanics === 'object'
          && !Array.isArray(row.mechanics)
          && isCompleteConditionRule(rule)
          && hashes !== null
      ))
      && new Set(ids).size === CONDITION_IDS.length
      && evidenceIdentities.size === 1
      && ids.every((id, index) => id === CONDITION_IDS[index]);
    if (!exact) throw new Error('condition release is incomplete, duplicated, invalid, or uncertified');

    const defs = materialized.map(({ rule }) => rule!);
    const hashInput = materialized
      .map(({ rule, hashes }) => (
        `${rule!.id}\0${hashes!.contentHash}\0${hashes!.dependencyHash}`
      ))
      .sort()
      .join('\n');
    const setHash = await sha256(hashInput);
    replaceConditionsFromDatabase(defs, setHash);
    certifiedConditionEntityCatalog = {
      setHash,
      byConditionId: new Map(materialized.map(({ row, rule }) => [
        rule!.id,
        structuredClone(row) as CertifiedConditionEffectEntity,
      ])),
    };
    return { mode: 'database_release', count: defs.length, setHash };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'condition release load failed';
    certifiedConditionEntityCatalog = null;
    resetConditionsToOfflineFixture(reason);
    return { mode: 'offline_fixture', reason };
  }
}
