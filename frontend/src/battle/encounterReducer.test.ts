import { describe, expect, it } from 'vitest';
import { applyEncounterEvent, normalizeState, type Combatant, type EncounterState } from './encounterTypes';

const c = (actorId: string, hp: number): Combatant => ({ actorId, name: actorId, hp, maxHp: hp });
const st = (combatants: Combatant[], round = 1, activeIndex = 0): EncounterState => ({ combatants, round, activeIndex });

describe('applyEncounterEvent (зеркало серверного applyOps)', () => {
  it('add — добавляет комбатантов', () => {
    const r = applyEncounterEvent(st([]), { seq: 1, add: [c('a', 20), c('b', 30)] });
    expect(r.combatants.map((x) => x.actorId)).toEqual(['a', 'b']);
  });

  it('patch — shallow-merge set по actor_id, прочие поля сохранены', () => {
    const r = applyEncounterEvent(st([c('a', 20)]), { seq: 1, patches: [{ actor_id: 'a', set: { hp: 12 } }] });
    expect(r.combatants[0].hp).toBe(12);
    expect(r.combatants[0].maxHp).toBe(20);
    expect(r.combatants[0].name).toBe('a');
  });

  it('patch неизвестного актора — no-op', () => {
    const r = applyEncounterEvent(st([c('a', 20)]), { seq: 1, patches: [{ actor_id: 'ghost', set: { hp: 1 } }] });
    expect(r.combatants[0].hp).toBe(20);
  });

  it('remove — удаляет по actorId', () => {
    const r = applyEncounterEvent(st([c('a', 20), c('b', 30)]), { seq: 1, remove: ['a'] });
    expect(r.combatants.map((x) => x.actorId)).toEqual(['b']);
  });

  it('round/active_index обновляются', () => {
    const r = applyEncounterEvent(st([]), { seq: 1, round: 3, active_index: 2 });
    expect(r.round).toBe(3);
    expect(r.activeIndex).toBe(2);
  });

  it('комбинированное событие: remove → patch → add + round', () => {
    const r = applyEncounterEvent(st([c('a', 20), c('b', 30)]), {
      seq: 1, remove: ['a'], patches: [{ actor_id: 'b', set: { hp: 5 } }], add: [c('cc', 10)], round: 2,
    });
    expect(r.combatants.map((x) => x.actorId)).toEqual(['b', 'cc']);
    expect(r.combatants[0].hp).toBe(5);
    expect(r.round).toBe(2);
  });

  it('normalizeState — дефолты при кривом jsonb', () => {
    expect(normalizeState(null)).toEqual({ combatants: [], round: 1, activeIndex: 0 });
    expect(normalizeState({ combatants: [c('a', 5)] }).round).toBe(1);
  });
});
