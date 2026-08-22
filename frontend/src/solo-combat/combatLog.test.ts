import { describe, expect, it } from 'vitest';
import type { RollLog } from '../mvp/contracts';
import type { UncommittedRuleEvent } from '../rules-core/domain';
import {
  combatLogDetails,
  combatLogTone,
  projectCombatLogRecords,
} from './combatLog';
import type { CombatLogEntry, CombatLogEventRecord, SoloCombatState } from './types';

const roll = (overrides: Partial<RollLog> = {}): RollLog => ({
  kind: 'd20',
  dice: [{ sides: 20, result: 18 }, { sides: 20, result: 4, discarded: true }],
  advantage: 'advantage',
  modifiers: [{ value: 5, source: 'ЛОВ', reason: 'атака' }],
  total: 23,
  target: { type: 'ac', value: 15 },
  outcome: 'hit',
  text: 'к20: 18 +5 = 23 против КЗ 15',
  ...overrides,
});

const state = {
  characterId: 'hero',
  sideByActorId: { hero: 'party', ally: 'party', enemy: 'opposition' },
  world: {
    actors: {
      hero: { name: 'Герой' },
      ally: { name: 'Союзник' },
      enemy: { name: 'Противник' },
    },
  },
} as unknown as SoloCombatState;

function entry(records: CombatLogEventRecord[]): CombatLogEntry {
  return { id: 'entry', round: 1, actorId: records[0]?.sourceActorId ?? 'hero', text: 'Тест', records };
}

function engineRecord(
  sourceActorId: string,
  targetIds: string[],
  event: NonNullable<CombatLogEventRecord['event']>,
): CombatLogEventRecord {
  return { kind: 'engine', ordinal: 1, sourceActorId, actorId: sourceActorId, targetIds, event };
}

describe('structured solo-combat log', () => {
  it('retains source, targets, roll detail, and discarded dice from rule envelopes', () => {
    const records = projectCombatLogRecords([{
      ordinal: 7,
      sourceActorId: 'enemy',
      obligationIds: ['attack:1'],
      payload: {
        type: 'EngineEventRecorded',
        actorId: 'enemy',
        targetIds: ['hero'],
        event: { type: 'roll', label: 'Атака', roll: roll() },
      },
    } as UncommittedRuleEvent]);

    expect(records[0]).toMatchObject({
      ordinal: 7,
      sourceActorId: 'enemy',
      actorId: 'enemy',
      targetIds: ['hero'],
    });
    expect(records[0].event?.type === 'roll' && records[0].event.roll.dice)
      .toContainEqual({ sides: 20, result: 4, discarded: true });
    expect(combatLogDetails(records[0], state)[0]).toMatchObject({
      kind: 'roll',
      label: 'Атака против КЗ 15',
    });
  });

  it.each([
    ['enemy-damage', engineRecord('enemy', ['hero'], { type: 'damage', amount: 5, damageType: 'fire' })],
    ['ally-damage', engineRecord('hero', ['enemy'], { type: 'damage', amount: 5, damageType: 'cold' })],
    ['ally-healing', engineRecord('ally', ['hero'], { type: 'healing', amount: 4 })],
    ['ally-critical', engineRecord('hero', ['enemy'], { type: 'roll', label: 'Атака', roll: roll({ outcome: 'crit' }) })],
    ['hostile-critical', engineRecord('enemy', ['hero'], { type: 'roll', label: 'Атака', roll: roll({ outcome: 'crit' }) })],
    ['hostile-critical', engineRecord('ally', ['enemy'], { type: 'roll', label: 'Атака', roll: roll({ outcome: 'crit_miss' }) })],
  ] as const)('classifies %s from structured allegiance and outcomes', (tone, record) => {
    expect(combatLogTone(entry([record]), state)).toBe(tone);
  });

  it('marks an adjudicated ally death black with highest precedence', () => {
    expect(combatLogTone(entry([
      engineRecord('enemy', ['ally'], { type: 'damage', amount: 50, damageType: 'necrotic' }),
      { kind: 'death', ordinal: 2, sourceActorId: 'enemy', actorId: 'ally', targetIds: ['ally'] },
    ]), state)).toBe('ally-death');
  });

  it('projects damage formula and applied damage as separate rows', () => {
    const details = combatLogDetails(engineRecord('hero', ['enemy'], {
      type: 'damage', amount: 9, damageType: 'force', roll: roll({ kind: 'damage', target: undefined, outcome: undefined }),
    }), state);
    expect(details.map((detail) => detail.label)).toEqual(['Бросок урона', 'Урон']);
    expect(details[1].text).toContain('Противник');
  });

  it('keeps actor-owned resource payments off the action target', () => {
    const details = combatLogDetails(engineRecord('enemy', ['hero'], {
      type: 'resource_spent', resource: 'action', amount: 1, remaining: 0,
    }), state);
    expect(details[0].text).toBe('Потрачено action: 1 (осталось 0)');
    expect(details[0].text).not.toContain('Герой');
  });
});
