import { effectsApi } from './client';
import {
  BUILTIN_CONDITION_RULES,
  conditionRegistryAuthority,
  replaceConditionEntityReferences,
  replaceConditionsFromDatabase,
  resetConditionsToOfflineFixture,
} from '../engine/conditions';
import {
  conditionRecordContentHash,
  isCompleteConditionRule,
  materializeConditionRule,
  MICRO_MVP_CONDITION_CERTIFICATION_VERSION,
  type CertifiedConditionEffectEntity,
  type ConditionEffectRecord,
} from '../canon/conditionDatabaseContract';

export {
  conditionRecordContentHash,
  materializeConditionRule,
  MICRO_MVP_CONDITION_CERTIFICATION_VERSION,
  type CertifiedConditionEffectEntity,
  type ConditionEffectRecord,
} from '../canon/conditionDatabaseContract';

const CONDITION_IDS = Object.keys(BUILTIN_CONDITION_RULES).sort();
const CONDITION_PAGE_LIMIT = 200;
const CONDITION_MAX_PAGES = 10_000;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
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

/** Current DB entity behind a registered condition. Offline fixture
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

function validExpectedReleaseBinding(
  expected: ExpectedConditionReleaseBinding,
): boolean {
  return expected?.certificationVersion === MICRO_MVP_CONDITION_CERTIFICATION_VERSION
    && [expected.rulesHash, expected.releaseContentHash, expected.releaseHash]
      .every((hash) => typeof hash === 'string' && SHA256.test(hash));
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
  // catalog is being fetched.
  certifiedConditionEntityCatalog = null;
  try {
    if (!validExpectedReleaseBinding(options.expectedRelease)) {
      throw new Error('current compiled condition release binding is invalid or missing');
    }
    const rows = await fetchAllConditionRows(options.timeoutMs);
    // Review status is human metadata, not permission to execute a condition.
    // Materialize the existing engine registry from current DB declarations;
    // keep completeness/uniqueness checks independently of legacy certificates.
    const releaseRows = rows.filter((row) => {
      const rule = materializeConditionRule(row);
      return rule !== null && CONDITION_IDS.includes(rule.id);
    });
    const materialized = await Promise.all(releaseRows.map(async (row) => ({
      row,
      rule: materializeConditionRule(row),
      contentHash: await conditionRecordContentHash(row),
    })));
    const ids = materialized.flatMap(({ rule }) => rule ? [rule.id] : []).sort();
    const exact = materialized.length === CONDITION_IDS.length
      && materialized.every(({ row, rule }) => (
        row.effect_type === 'condition'
          && typeof row.id === 'string'
          && row.id.trim().length > 0
          && typeof row.name === 'string'
          && row.name.trim().length > 0
          && !!row.mechanics
          && typeof row.mechanics === 'object'
          && !Array.isArray(row.mechanics)
          && isCompleteConditionRule(rule)
      ))
      && new Set(ids).size === CONDITION_IDS.length
      && ids.every((id, index) => id === CONDITION_IDS[index]);
    if (!exact) throw new Error('condition catalog is incomplete, duplicated, or invalid');

    const defs = materialized.map(({ rule }) => rule!);
    const hashInput = materialized
      .map(({ rule, contentHash }) => `${rule!.id}\0${contentHash}`)
      .sort()
      .join('\n');
    const setHash = await sha256(hashInput);
    replaceConditionsFromDatabase(defs, setHash);
    const presentationCandidates = rows.flatMap((row) => {
      const rule = row.effect_type === 'condition' ? materializeConditionRule(row) : null;
      return rule?.entityRef ? [[rule.id, rule.entityRef] as const] : [];
    });
    const presentationCounts = new Map<string, number>();
    for (const [id] of presentationCandidates) {
      presentationCounts.set(id, (presentationCounts.get(id) ?? 0) + 1);
    }
    replaceConditionEntityReferences(Object.fromEntries(
      presentationCandidates.filter(([id]) => presentationCounts.get(id) === 1),
    ));
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
