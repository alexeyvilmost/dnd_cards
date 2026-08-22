import { describe, expect, it } from 'vitest';
import {
  certificationContractIssues,
  effectiveSupportStatus,
  filterEntitiesBySupport,
  isDefaultVisibleSupportStatus,
  isEntityVisibleBySupport,
  isMechanicsLocked,
  supportSelectionWarning,
  supportStatusOf,
  supportStatusPresentation,
  testCoverageOf,
  type EntitySupportCertification,
} from './supportStatus';

describe('content support status', () => {
  it('fails closed for the superseded basic-action certificate', () => {
    expect(supportStatusOf({
      support: {
        status: 'verified_mechanical',
        certification_version: 'micro-mvp-basic-actions-v1',
      },
    })).toBe('untested');
  });

  it('по умолчанию показывает три проверенных статуса', () => {
    expect(isDefaultVisibleSupportStatus('verified_mechanical')).toBe(true);
    expect(isDefaultVisibleSupportStatus('verified_partial')).toBe(true);
    expect(isDefaultVisibleSupportStatus('verified_narrative')).toBe(true);
    expect(isDefaultVisibleSupportStatus('partial')).toBe(false);
    expect(isDefaultVisibleSupportStatus('untested')).toBe(false);
    expect(isDefaultVisibleSupportStatus('known_mismatch')).toBe(false);
  });

  it('галочка «показать всё» раскрывает неподтверждённую сущность', () => {
    const entity = { support: { status: 'known_mismatch' as const } };
    expect(isEntityVisibleBySupport(entity, false)).toBe(false);
    expect(isEntityVisibleBySupport(entity, true)).toBe(true);
  });

  it('сущность без certification считается untested', () => {
    expect(supportStatusOf({})).toBe('untested');
    expect(supportStatusPresentation('untested').verified).toBe(false);
  });

  it('изменение содержимого или зависимости сбрасывает эффективный статус', () => {
    const certification: EntitySupportCertification = {
      status: 'verified_mechanical',
      content_hash: 'content-v1',
      dependency_hash: 'deps-v1',
      certification_version: 'micro-micro-v1',
    };
    expect(effectiveSupportStatus(certification, 'content-v1', 'deps-v1')).toBe('verified_mechanical');
    expect(effectiveSupportStatus(certification, 'content-v2', 'deps-v1')).toBe('untested');
    expect(effectiveSupportStatus(certification, 'content-v1', 'deps-v2')).toBe('untested');
  });

  it('verified_partial требует явно перечисленных ограничений', () => {
    const incomplete: EntitySupportCertification = {
      status: 'verified_partial',
      certification_version: 'micro-micro-v1',
    };
    expect(certificationContractIssues(incomplete)).toContain(
      'verified_partial требует непустой список limitations',
    );
    expect(certificationContractIssues({
      ...incomplete,
      content_hash: 'content-v1',
      dependency_hash: 'deps-v1',
      limitations: ['Перемещение выполняется вручную'],
    })).toEqual([]);
  });

  it('не активирует неполную release-evidence certification v3', () => {
    const hash = `sha256:${'a'.repeat(64)}`;
    const incomplete: EntitySupportCertification = {
      status: 'verified_mechanical',
      certification_version: 'micro-mvp-l1-rules-core-v3',
      content_hash: hash,
      dependency_hash: hash,
      certified_at: '2026-08-05T00:00:00Z',
    };
    expect(supportStatusOf({ support: incomplete })).toBe('untested');
    expect(effectiveSupportStatus(incomplete, hash, hash)).toBe('untested');
    expect(certificationContractIssues(incomplete)).toContain(
      'release evidence требует evidence_id UUID',
    );

    const complete: EntitySupportCertification = {
      ...incomplete,
      evidence_id: '00000000-0000-4000-8000-000000000001',
      evidence_completed_at: '2026-08-05T00:01:00Z',
      evidence_hash: hash,
      gate_source_hash: hash,
      source_content_hash: hash,
      rules_hash: hash,
      release_content_hash: hash,
      release_hash: hash,
      patch_hash: hash,
      catalog_hash: hash,
    };
    expect(certificationContractIssues(complete)).toEqual([]);
    expect(supportStatusOf({ support: complete })).toBe('verified_mechanical');
  });

  it('не доверяет legacy verified-флагу без версии и хэшей', () => {
    const legacy: EntitySupportCertification = {
      status: 'verified_partial',
      limitations: ['legacy'],
    };
    expect(supportStatusOf({ support: legacy })).toBe('untested');
    expect(effectiveSupportStatus(legacy)).toBe('untested');
  });

  it('mini-MVP certificate requires its exact scope before exposing or locking an entity', () => {
    const hash = `sha256:${'c'.repeat(64)}`;
    const certificate: EntitySupportCertification = {
      status: 'verified_mechanical',
      certification_version: 'mini-mvp-l1-v1',
      content_hash: hash,
      dependency_hash: hash,
      certified_at: '2026-08-20T07:00:00Z',
      evidence_id: '00000000-0000-4000-8000-000000000003',
      evidence_completed_at: '2026-08-20T06:59:00Z',
      evidence_hash: hash,
      gate_source_hash: hash,
      source_content_hash: hash,
      rules_hash: hash,
      release_content_hash: hash,
      release_hash: hash,
      patch_hash: hash,
      catalog_hash: hash,
      test_coverage: {
        schema_version: 1, scope: 'mini-mvp-l1', required: 24, passed: 24, percent: 100,
      },
      mechanics_locked: true,
    };
    expect(certificationContractIssues(certificate)).toEqual([]);
    expect(supportStatusOf({ support: certificate })).toBe('verified_mechanical');
    expect(isMechanicsLocked({ support: certificate })).toBe(true);
    expect(supportStatusOf({
      support: {
        ...certificate,
        test_coverage: { ...certificate.test_coverage!, scope: 'micro-mvp-l1' },
      },
    })).toBe('untested');
  });

  it('v4 публикует точное покрытие и закрепляет только полностью покрытую механику', () => {
    const hash = `sha256:${'a'.repeat(64)}`;
    const complete: EntitySupportCertification = {
      status: 'verified_partial',
      certification_version: 'micro-mvp-l1-rules-core-v4',
      content_hash: hash,
      dependency_hash: hash,
      certified_at: '2026-08-05T00:00:00Z',
      evidence_id: '00000000-0000-4000-8000-000000000001',
      evidence_completed_at: '2026-08-05T00:01:00Z',
      evidence_hash: hash,
      gate_source_hash: hash,
      source_content_hash: hash,
      rules_hash: hash,
      release_content_hash: hash,
      release_hash: hash,
      patch_hash: hash,
      catalog_hash: hash,
      limitations: ['Сертифицирован только scope первого уровня'],
      test_coverage: {
        schema_version: 1, scope: 'micro-mvp-l1', required: 12, passed: 12, percent: 100,
      },
      mechanics_locked: true,
    };
    expect(certificationContractIssues(complete)).toEqual([]);
    expect(testCoverageOf({ support: complete })?.percent).toBe(100);
    expect(isMechanicsLocked({ support: complete })).toBe(true);

    const partial = {
      ...complete,
      test_coverage: { ...complete.test_coverage!, passed: 11, percent: 91 },
    };
    expect(certificationContractIssues(partial)).toContain(
      'mechanics_locked требует 100% покрытия заявленного scope',
    );
    expect(isMechanicsLocked({ support: partial })).toBe(false);
  });

  it('basic-actions certificate fails closed without its exact browser evidence', () => {
    const hash = `sha256:${'b'.repeat(64)}`;
    const certificate: EntitySupportCertification = {
      status: 'verified_mechanical',
      certification_version: 'micro-mvp-basic-actions-v2',
      content_hash: hash,
      dependency_hash: hash,
      certified_at: '2026-08-19T07:00:00Z',
      evidence_id: '00000000-0000-4000-8000-000000000002',
      evidence_hash: hash,
      evidence_completed_at: '2026-08-19T06:59:00Z',
      test_coverage: {
        schema_version: 1,
        scope: 'micro-mvp-basic-actions-v2',
        required: 3,
        passed: 3,
        percent: 100,
      },
      mechanics_locked: true,
    };
    expect(certificationContractIssues(certificate)).toEqual([]);
    expect(supportStatusOf({ support: certificate })).toBe('verified_mechanical');
    expect(isMechanicsLocked({ support: certificate })).toBe(true);
    expect(supportStatusOf({
      support: { ...certificate, evidence_hash: 'missing' },
    })).toBe('untested');
  });

  it('фильтр сохраняет выбранную неподтверждённую сущность', () => {
    const entities = [
      {
        id: 'verified',
        support: {
          status: 'verified_narrative' as const,
          certification_version: 'test-v1',
          content_hash: 'content-v1',
          dependency_hash: 'deps-v1',
        },
      },
      { id: 'broken', support: { status: 'known_mismatch' as const } },
      { id: 'untested' },
    ];
    expect(filterEntitiesBySupport(entities, false).map((entity) => entity.id)).toEqual(['verified']);
    expect(filterEntitiesBySupport(entities, false, ['broken']).map((entity) => entity.id))
      .toEqual(['verified', 'broken']);
    expect(filterEntitiesBySupport(entities, true).map((entity) => entity.id))
      .toEqual(['verified', 'broken', 'untested']);
  });

  it('для неподтверждённого выбора формирует предупреждение', () => {
    expect(supportSelectionWarning({
      support: {
        status: 'verified_partial',
        certification_version: 'test-v1',
        content_hash: 'content-v1',
        dependency_hash: 'deps-v1',
        limitations: ['Без автоматического выбора цели'],
      },
    })).toBeNull();
    expect(supportSelectionWarning({
      support: {
        status: 'partial',
        note: 'Работает только урон',
      },
    })).toContain('Работает только урон');
  });
});
