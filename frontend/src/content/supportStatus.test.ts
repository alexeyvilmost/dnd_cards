import { describe, expect, it } from 'vitest';
import {
  certificationContractIssues,
  effectiveSupportStatus,
  filterEntitiesBySupport,
  isDefaultVisibleSupportStatus,
  isEntityVisibleBySupport,
  supportSelectionWarning,
  supportStatusOf,
  supportStatusPresentation,
  type EntitySupportCertification,
} from './supportStatus';

describe('content support status', () => {
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
      'micro-MVP v3 требует evidence_id UUID',
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

  it('фильтр сохраняет выбранную неподтверждённую сущность', () => {
    const entities = [
      { id: 'verified', support: { status: 'verified_narrative' as const } },
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
