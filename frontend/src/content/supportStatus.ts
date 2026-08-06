/**
 * Единый продуктовый контракт поддерживаемости контента.
 *
 * Статус относится не просто к записи, а к сертифицированной версии её
 * содержимого и зависимостей. Пока backend не прислал certification, сущность
 * считается untested — наличие mechanics само по себе не доказывает корректность.
 */
export const ENTITY_SUPPORT_STATUSES = [
  'verified_mechanical',
  'verified_partial',
  'verified_narrative',
  'partial',
  'untested',
  'known_mismatch',
] as const;

export type EntitySupportStatus = (typeof ENTITY_SUPPORT_STATUSES)[number];

export const DEFAULT_VISIBLE_SUPPORT_STATUSES: ReadonlySet<EntitySupportStatus> = new Set([
  'verified_mechanical',
  'verified_partial',
  'verified_narrative',
]);

export interface EntitySupportCertification {
  status: EntitySupportStatus;
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
}

export interface SupportableEntity {
  support?: EntitySupportCertification | null;
}

const MICRO_MVP_V3_CERTIFICATION = 'micro-mvp-l1-rules-core-v3';
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UTC_RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const MICRO_MVP_V3_HASH_FIELDS = [
  'content_hash', 'dependency_hash', 'evidence_hash', 'gate_source_hash',
  'source_content_hash', 'rules_hash', 'release_content_hash', 'release_hash',
  'patch_hash', 'catalog_hash',
] as const satisfies readonly (keyof EntitySupportCertification)[];

function microMvpV3EvidenceIssues(certification: EntitySupportCertification): string[] {
  if (certification.certification_version !== MICRO_MVP_V3_CERTIFICATION) return [];
  const issues: string[] = [];
  if (!UUID.test(certification.evidence_id ?? '')) issues.push('micro-MVP v3 требует evidence_id UUID');
  for (const field of MICRO_MVP_V3_HASH_FIELDS) {
    if (!SHA256.test(String(certification[field] ?? ''))) {
      issues.push(`micro-MVP v3 требует ${field} sha256`);
    }
  }
  for (const field of ['certified_at', 'evidence_completed_at'] as const) {
    const value = certification[field] ?? '';
    if (!UTC_RFC3339.test(value) || Number.isNaN(Date.parse(value))) {
      issues.push(`micro-MVP v3 требует ${field} UTC RFC3339`);
    }
  }
  return issues;
}

export type SupportStatusPresentation = {
  label: string;
  tone: 'success' | 'info' | 'warning' | 'neutral' | 'danger';
  verified: boolean;
};

const PRESENTATION: Record<EntitySupportStatus, SupportStatusPresentation> = {
  verified_mechanical: {
    label: 'Механика проверена',
    tone: 'success',
    verified: true,
  },
  verified_partial: {
    label: 'Частично поддержано и проверено',
    tone: 'info',
    verified: true,
  },
  verified_narrative: {
    label: 'Проверено как нарративное',
    tone: 'info',
    verified: true,
  },
  partial: {
    label: 'Поддержано частично',
    tone: 'warning',
    verified: false,
  },
  untested: {
    label: 'Не проверено',
    tone: 'neutral',
    verified: false,
  },
  known_mismatch: {
    label: 'Есть известное несоответствие',
    tone: 'danger',
    verified: false,
  },
};

export function supportStatusPresentation(status: EntitySupportStatus): SupportStatusPresentation {
  return PRESENTATION[status];
}

export function supportStatusOf(entity: SupportableEntity | null | undefined): EntitySupportStatus {
  const support = entity?.support;
  if (!support) return 'untested';
  if (support.certification_version === MICRO_MVP_V3_CERTIFICATION
    && certificationContractIssues(support).length > 0) {
    return 'untested';
  }
  return support.status;
}

export function isDefaultVisibleSupportStatus(status: EntitySupportStatus): boolean {
  return DEFAULT_VISIBLE_SUPPORT_STATUSES.has(status);
}

export function isEntityVisibleBySupport(
  entity: SupportableEntity | null | undefined,
  showAll: boolean,
): boolean {
  return showAll || isDefaultVisibleSupportStatus(supportStatusOf(entity));
}

export function filterEntitiesBySupport<T extends SupportableEntity & { id: string }>(
  entities: T[],
  showAll: boolean,
  alwaysIncludeIds: Iterable<string> = [],
): T[] {
  const included = new Set(alwaysIncludeIds);
  return entities.filter((entity) =>
    included.has(entity.id) || isEntityVisibleBySupport(entity, showAll));
}

export function supportSelectionWarning(
  entity: SupportableEntity | null | undefined,
): string | null {
  const status = supportStatusOf(entity);
  if (isDefaultVisibleSupportStatus(status)) return null;
  const presentation = supportStatusPresentation(status);
  const note = entity?.support?.note?.trim();
  const limitations = entity?.support?.limitations?.filter((item) => item.trim()) ?? [];
  return [
    `${presentation.label}. Эта сущность не входит в проверенный каталог.`,
    note,
    limitations.length ? `Ограничения: ${limitations.join('; ')}` : null,
    'Вы всё равно хотите её выбрать?',
  ].filter(Boolean).join('\n\n');
}

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
    || (certification?.certification_version === MICRO_MVP_V3_CERTIFICATION
      && certificationContractIssues(certification).length > 0)) {
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
  issues.push(...microMvpV3EvidenceIssues(certification));
  return issues;
}
