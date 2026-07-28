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
}

export interface SupportableEntity {
  support?: EntitySupportCertification | null;
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
  return entity?.support?.status ?? 'untested';
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
  if (!isCertificationFresh(certification, currentContentHash, currentDependencyHash)) {
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
  return issues;
}
