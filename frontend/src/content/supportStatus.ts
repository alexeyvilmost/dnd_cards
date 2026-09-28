/** Ручной статус проверки. Он не ограничивает каталог или редактирование механики. */
export const ENTITY_SUPPORT_STATUSES = [
  'verified', 'verified_partial', 'not_verified', 'not_tested', 'narrative',
  'partial_narrative_verified', 'partial_narrative_not_verified',
] as const;
export type EntityReviewStatus = (typeof ENTITY_SUPPORT_STATUSES)[number];
/** Старые значения сохраняются только для чтения исторических артефактов. */
export type EntitySupportStatus = EntityReviewStatus | 'verified_mechanical' | 'verified_narrative'
  | 'partial' | 'untested' | 'known_mismatch';
export const DEFAULT_VISIBLE_SUPPORT_STATUSES: ReadonlySet<EntitySupportStatus> = new Set(ENTITY_SUPPORT_STATUSES);
export function normalizeSupportStatus(status: unknown): EntityReviewStatus {
  if (ENTITY_SUPPORT_STATUSES.includes(status as EntityReviewStatus)) return status as EntityReviewStatus;
  return ({ verified_mechanical: 'verified', verified_narrative: 'narrative', partial: 'not_verified',
    untested: 'not_tested', known_mismatch: 'not_verified' } as Record<string, EntityReviewStatus>)[String(status)] ?? 'not_verified';
}

export interface EntitySupportCertification {
  status: EntitySupportStatus;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  /** Хэш полей самой сущности, влияющих на описание и механику. */
  content_hash?: string | null;
  /** Хэш транзитивных механических зависимостей. */
  dependency_hash?: string | null;
  /** Версия certification pipeline/набора контрактов. */
  certification_version?: string | null;
  certified_at?: string | null;
  /** Явные границы verified_partial. */
  limitations?: string[] | null;
  note?: string | null;
  /** Durable release-gate artifact and the exact rule/content identities it certified. */
  evidence_id?: string | null;
  evidence_hash?: string | null;
  evidence_completed_at?: string | null;
  gate_source_hash?: string | null;
  source_content_hash?: string | null;
  rules_hash?: string | null;
  release_content_hash?: string | null;
  release_hash?: string | null;
  patch_hash?: string | null;
  catalog_hash?: string | null;
  test_coverage?: EntityTestCoverage | null;
  mechanics_locked?: boolean | null;
}

export interface EntityTestCoverage {
  schema_version: 1;
  /** Explicit milestone/rules scope; 100% never means all future D&D content. */
  scope: string;
  required: number;
  passed: number;
  percent: number;
}

export interface SupportableEntity {
  support?: EntitySupportCertification | null;
}

const MICRO_MVP_V3_CERTIFICATION = 'micro-mvp-l1-rules-core-v3';
const MICRO_MVP_V4_CERTIFICATION = 'micro-mvp-l1-rules-core-v4';
const MINI_MVP_V1_CERTIFICATION = 'mini-mvp-l1-v1';
const BASIC_ACTIONS_CERTIFICATION = 'micro-mvp-basic-actions-v2';

const SHA256 = /^sha256:[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UTC_RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const RELEASE_EVIDENCE_HASH_FIELDS = [
  'content_hash', 'dependency_hash', 'evidence_hash', 'gate_source_hash',
  'source_content_hash', 'rules_hash', 'release_content_hash', 'release_hash',
  'patch_hash', 'catalog_hash',
] as const satisfies readonly (keyof EntitySupportCertification)[];

function releaseEvidenceIssues(certification: EntitySupportCertification): string[] {
  if (![MICRO_MVP_V3_CERTIFICATION, MICRO_MVP_V4_CERTIFICATION, MINI_MVP_V1_CERTIFICATION]
    .includes(certification.certification_version ?? '')) return [];
  const issues: string[] = [];
  if (!UUID.test(certification.evidence_id ?? '')) issues.push('release evidence требует evidence_id UUID');
  for (const field of RELEASE_EVIDENCE_HASH_FIELDS) {
    if (!SHA256.test(String(certification[field] ?? ''))) {
      issues.push(`release evidence требует ${field} sha256`);
    }
  }
  for (const field of ['certified_at', 'evidence_completed_at'] as const) {
    const value = certification[field] ?? '';
    if (!UTC_RFC3339.test(value) || Number.isNaN(Date.parse(value))) {
      issues.push(`release evidence требует ${field} UTC RFC3339`);
    }
  }
  if ([MICRO_MVP_V4_CERTIFICATION, MINI_MVP_V1_CERTIFICATION]
    .includes(certification.certification_version ?? '')) {
    const coverage = certification.test_coverage;
    const expectedScope = certification.certification_version === MINI_MVP_V1_CERTIFICATION
      ? 'mini-mvp-l1'
      : 'micro-mvp-l1';
    if (!coverage || coverage.schema_version !== 1 || coverage.scope !== expectedScope
      || !Number.isInteger(coverage.required) || coverage.required < 1
      || !Number.isInteger(coverage.passed) || coverage.passed < 0
      || coverage.passed > coverage.required
      || !Number.isInteger(coverage.percent)
      || coverage.percent !== Math.floor((coverage.passed * 100) / coverage.required)) {
      issues.push(`${certification.certification_version} требует точный test_coverage`);
    }
    if (certification.mechanics_locked === true
      && (!coverage || coverage.passed !== coverage.required || coverage.percent !== 100)) {
      issues.push('mechanics_locked требует 100% покрытия заявленного scope');
    }
    if (certification.mechanics_locked === true
      && !certification.status.startsWith('verified_')) {
      issues.push('mechanics_locked требует verified-статус');
    }
  }
  return issues;
}

function basicActionsEvidenceIssues(certification: EntitySupportCertification): string[] {
  if (certification.certification_version !== BASIC_ACTIONS_CERTIFICATION) return [];
  const issues: string[] = [];
  if (!UUID.test(certification.evidence_id ?? '')) {
    issues.push('basic-actions evidence требует evidence_id UUID');
  }
  if (!SHA256.test(certification.evidence_hash ?? '')) {
    issues.push('basic-actions evidence требует evidence_hash sha256');
  }
  for (const field of ['certified_at', 'evidence_completed_at'] as const) {
    const value = certification[field] ?? '';
    if (!UTC_RFC3339.test(value) || Number.isNaN(Date.parse(value))) {
      issues.push(`basic-actions evidence требует ${field} UTC RFC3339`);
    }
  }
  const coverage = certification.test_coverage;
  if (!coverage || coverage.schema_version !== 1 || coverage.scope !== 'micro-mvp-basic-actions-v2'
    || !Number.isInteger(coverage.required) || coverage.required < 1
    || coverage.passed !== coverage.required || coverage.percent !== 100) {
    issues.push('basic-actions evidence требует точное 100% test_coverage');
  }
  return issues;
}

export type SupportStatusPresentation = {
  label: string;
  tone: 'success' | 'info' | 'warning' | 'neutral' | 'danger';
  verified: boolean;
  color: string;
};
const PRESENTATION: Record<EntityReviewStatus, SupportStatusPresentation> = {
  verified: { label: 'Проверено', tone: 'success', verified: true, color: '#22c55e' },
  verified_partial: { label: 'Проверено частично', tone: 'warning', verified: true, color: '#eab308' },
  not_verified: { label: 'Не проверено', tone: 'danger', verified: false, color: '#ef4444' },
  not_tested: { label: 'Не тестировалось', tone: 'neutral', verified: false, color: '#9ca3af' },
  narrative: { label: 'Нарративное', tone: 'info', verified: false, color: '#38bdf8' },
  partial_narrative_verified: { label: 'Частично нарративное, механика проверена', tone: 'info', verified: true, color: '#2563eb' },
  partial_narrative_not_verified: { label: 'Частично нарративное, механика не проверена', tone: 'danger', verified: false, color: '#a855f7' },
};
export function supportStatusPresentation(status: EntitySupportStatus): SupportStatusPresentation {
  return PRESENTATION[normalizeSupportStatus(status)];
}
export function supportStatusOf(entity: SupportableEntity | null | undefined): EntityReviewStatus {
  return normalizeSupportStatus(entity?.support?.status);
}

export function testCoverageOf(
  entity: SupportableEntity | null | undefined,
): EntityTestCoverage | null {
  const coverage = entity?.support?.test_coverage;
  if (!coverage || coverage.schema_version !== 1 || !coverage.scope?.trim()
    || !Number.isInteger(coverage.required) || coverage.required < 1
    || !Number.isInteger(coverage.passed) || coverage.passed < 0
    || coverage.passed > coverage.required
    || coverage.percent !== Math.floor((coverage.passed * 100) / coverage.required)) return null;
  return coverage;
}

/** Историческая сертификация больше не блокирует изменения. */
export function isMechanicsLocked(_entity: SupportableEntity | null | undefined): boolean { return false; }
export function isDefaultVisibleSupportStatus(_status: EntitySupportStatus): boolean { return true; }
export function isEntityVisibleBySupport(_entity: SupportableEntity | null | undefined, _showAll: boolean): boolean { return true; }
export function filterEntitiesBySupport<T extends SupportableEntity & { id: string }>(
  entities: T[], _showAll: boolean, _alwaysIncludeIds: Iterable<string> = [],
): T[] { return entities; }
export function supportSelectionWarning(_entity: SupportableEntity | null | undefined): string | null { return null; }

/** Следующие функции оставлены для чтения прежних сертификатов и истории. */
/**
 * Проверяет, относится ли certification к текущей версии сущности.
 * Если вызывающий ещё не вычисляет хэши, переданные undefined не инвалидируют
 * статус. Certification gate обязан передавать оба актуальных хэша.
 */
export function isCertificationFresh(
  certification: EntitySupportCertification | null | undefined,
  currentContentHash?: string,
  currentDependencyHash?: string,
): boolean {
  if (!certification) return false;
  if (
    currentContentHash !== undefined
    && certification.content_hash !== currentContentHash
  ) {
    return false;
  }
  if (
    currentDependencyHash !== undefined
    && certification.dependency_hash !== currentDependencyHash
  ) {
    return false;
  }
  return true;
}

export function effectiveSupportStatus(
  certification: EntitySupportCertification | null | undefined,
  currentContentHash?: string,
  currentDependencyHash?: string,
): EntitySupportStatus {
  if (!isCertificationFresh(certification, currentContentHash, currentDependencyHash)
    || (certification != null && certificationContractIssues(certification).length > 0)) {
    return 'untested';
  }
  return certification!.status;
}

/** verified_partial без описанных ограничений не является валидной сертификацией. */
export function certificationContractIssues(
  certification: EntitySupportCertification,
): string[] {
  const issues: string[] = [];
  if (
    certification.status === 'verified_partial'
    && !(certification.limitations?.some((item) => item.trim()))
  ) {
    issues.push('verified_partial требует непустой список limitations');
  }
  if (
    certification.status.startsWith('verified_')
    && !certification.certification_version
  ) {
    issues.push(`${certification.status} требует certification_version`);
  }
  if (certification.status.startsWith('verified_') && !certification.content_hash) {
    issues.push(`${certification.status} требует content_hash`);
  }
  if (certification.status.startsWith('verified_') && !certification.dependency_hash) {
    issues.push(`${certification.status} требует dependency_hash`);
  }
  issues.push(...releaseEvidenceIssues(certification));
  issues.push(...basicActionsEvidenceIssues(certification));
  return issues;
}
