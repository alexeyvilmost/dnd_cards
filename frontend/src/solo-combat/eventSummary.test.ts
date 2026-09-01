import { describe, expect, it } from 'vitest';
import type { EngineEvent } from '../mvp/contracts';
import { eventSummary } from './engine';
import type { CombatLogEventRecord } from './types';

function record(event: EngineEvent, ordinal: number): CombatLogEventRecord {
  return {
    kind: 'engine',
    ordinal,
    sourceActorId: 'actor',
    actorId: 'actor',
    targetIds: [],
    event,
  };
}

describe('solo combat event summary', () => {
  it('distinguishes teleportation from forced push movement', () => {
    expect(eventSummary([
      record({ type: 'movement', mode: 'teleport', distanceFt: 30 }, 0),
      record({ type: 'movement', mode: 'push', distanceFt: 10 }, 1),
    ])).toBe('телепортация 30 фт.; отталкивание 10 фт.');
  });

  it('uses player-facing labels for action economy and feature charges', () => {
    expect(eventSummary([
      record({ type: 'resource_spent', resource: 'bonus_action', amount: 1, remaining: 0 }, 0),
      record({ type: 'resource_spent', resource: 'giant_legacy', amount: 1, remaining: 1 }, 1),
      record({ type: 'resource_spent', resource: 'uses_ACT-breath-lightning', amount: 1, remaining: 1 }, 2),
    ])).toBe('потрачено: Бонусное действие; потрачено: Наследие великанов; потрачено: Заряд способности');
  });

  it('localizes damage and condition ids in the combat summary', () => {
    expect(eventSummary([
      record({ type: 'damage', amount: 3, damageType: 'necrotic' }, 0),
      record({ type: 'condition_applied', condition: 'poisoned' }, 1),
    ])).toBe('урон 3 (некротический); состояние: Отравлен');
  });
});
