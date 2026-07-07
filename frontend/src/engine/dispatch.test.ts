import { describe, expect, it } from 'vitest';
import { collectListeners, isAuto } from './dispatch';
import type { ActiveEffectEntry, RuntimeState } from '../mvp/contracts';

function state(activeEffects: ActiveEffectEntry[] = []): RuntimeState {
  return { hp: { current: 10, max: 10, temp: 0 }, resources: {}, maxResources: {}, equipment: {}, inventory: [], activeEffects };
}

const sneak = {
  id: 'sneak', name: 'Скрытая атака',
  activation: { mode: 'triggered', trigger: { event: 'hit', timing: 'during' } },
  uses: { count: 1, per: 'turn' },
  effects: [{ resolution: 'auto', result: [{ kind: 'damage', dice: '2d6', type: 'weapon' }] }],
};
const smite = {
  id: 'smite', name: 'Божественная кара',
  activation: { mode: 'triggered', cost: [{ resource: 'spell_slot', level: 1 }], trigger: { event: 'hit' } },
  effects: [],
};
const rebuke = {
  id: 'rebuke', name: 'Адское возмездие',
  activation: { mode: 'reaction', cost: [{ resource: 'reaction' }], trigger: { event: 'damage_taken', timing: 'after' } },
  effects: [],
};
const passiveBonus = {
  name: 'бонус', activation: { mode: 'passive' },
  effects: [{ resolution: 'auto', result: [{ kind: 'modifier', applies_to: { roll: 'attack' }, op: 'add', value: '+1' }] }],
};

describe('collectListeners (фаза A)', () => {
  it('находит triggered/reaction по событию, игнорирует passive', () => {
    const passives = [sneak, smite, rebuke, passiveBonus];
    expect(collectListeners({ kind: 'hit' }, state(), passives).map((l) => l.id).sort()).toEqual(['smite', 'sneak']);
    expect(collectListeners({ kind: 'damage_taken' }, state(), passives).map((l) => l.id)).toEqual(['rebuke']);
  });

  it('isAuto: triggered без стоимости — авто; со стоимостью — нет', () => {
    expect(isAuto(collectListeners({ kind: 'hit' }, state(), [sneak])[0])).toBe(true);
    expect(isAuto(collectListeners({ kind: 'hit' }, state(), [smite])[0])).toBe(false);
    expect(isAuto(collectListeners({ kind: 'damage_taken' }, state(), [rebuke])[0])).toBe(false);
  });

  it('circumstances гейтят слушателя', () => {
    const gated = { id: 'g', name: 'g', activation: { mode: 'triggered', trigger: { event: 'hit', circumstances: [{ kind: 'target_has_condition', value: 'prone' }] } }, effects: [] };
    expect(collectListeners({ kind: 'hit' }, state(), [gated], { targetConditions: new Set() })).toHaveLength(0);
    expect(collectListeners({ kind: 'hit' }, state(), [gated], { targetConditions: new Set(['prone']) })).toHaveLength(1);
  });

  it('timing совпадает; иной timing отсекается', () => {
    expect(collectListeners({ kind: 'hit', timing: 'during' }, state(), [sneak])).toHaveLength(1);
    expect(collectListeners({ kind: 'hit', timing: 'after' }, state(), [sneak])).toHaveLength(0);
  });

  it('слушатель из активного эффекта тоже находится', () => {
    const eff: ActiveEffectEntry = { id: 'x', name: 'Скрытая атака', mechanics: sneak, source: 'x' };
    expect(collectListeners({ kind: 'hit' }, state([eff]), [])).toHaveLength(1);
  });
});
