/**
 * C3 (слайс 1) — новые эмиссии шины: miss / spell_cast / reduced_to_0_hp реально будят
 * data-driven слушателя (triggered) и остаются аддитивными (без слушателя — no-op).
 */
import { describe, expect, it } from 'vitest';
import { executeAction, applyIncomingDamage } from './execute';
import type { CharacterContext, EngineEvent, ExecuteContext, RuntimeState } from '../mvp/contracts';

type Dict = Record<string, unknown>;
type Ctx = ExecuteContext & { passives?: Dict[] };

const character: CharacterContext = {
  abilityMods: { str: 3, dex: 1, con: 2, int: 0, wis: 1, cha: 0 },
  profBonus: 2, level: 5,
};

function freshState(): RuntimeState {
  return {
    hp: { current: 20, max: 20, temp: 0 },
    resources: { reaction: 1, spell_slot_1: 2 },
    maxResources: { reaction: 1, spell_slot_1: 2 },
    equipment: {}, inventory: [], activeEffects: [],
  };
}

const HIT = () => 0.5; // natural 11 → попадание против ac:1
const MISS = () => 0;  // natural 1 → промах

const narratives = (events: EngineEvent[]) => events.filter((e) => e.type === 'narrative').map((e) => (e as { text: string }).text);

const attackAction: Dict = {
  name: 'Атака', activation: { cost: [] },
  effects: [{ resolution: 'attack_roll', ability: 'str', on_hit: [{ kind: 'damage', dice: '1d6', type: 'weapon', ability: 'none' }] }],
};
const castAction: Dict = {
  name: 'Огненный снаряд', activation: { cost: [] },
  effects: [{ resolution: 'auto', result: [{ kind: 'narrative', text: 'бабах' }] }],
};

const auto = (id: string, name: string, event: string): Dict => ({
  id, name,
  activation: { mode: 'triggered', trigger: { event } },
  effects: [{ resolution: 'auto', result: [{ kind: 'temp_hp', amount: '1' }] }],
});

describe('C3 — событие miss', () => {
  it('промах будит triggered-слушателя на miss', () => {
    const ctx: Ctx = { character, rng: MISS, target: { ac: 1 }, passives: [auto('graze', 'Скользящий удар', 'miss')] };
    const { events } = executeAction(freshState(), attackAction, ctx);
    expect(narratives(events)).toContain('Сработало: Скользящий удар');
  });

  it('попадание НЕ будит слушателя miss', () => {
    const ctx: Ctx = { character, rng: HIT, target: { ac: 1 }, passives: [auto('graze', 'Скользящий удар', 'miss')] };
    const { events } = executeAction(freshState(), attackAction, ctx);
    expect(narratives(events)).not.toContain('Сработало: Скользящий удар');
  });
});

describe('C3 — событие spell_cast', () => {
  it('каст с ctx.spell будит triggered-слушателя на spell_cast', () => {
    const ctx: Ctx = { character, rng: HIT, spell: { baseLevel: 1 }, passives: [auto('echo', 'Отклик', 'spell_cast')] };
    const { events } = executeAction(freshState(), castAction, ctx);
    expect(narratives(events)).toContain('Сработало: Отклик');
  });

  it('без ctx.spell слушатель spell_cast молчит (аддитивно)', () => {
    const ctx: Ctx = { character, rng: HIT, passives: [auto('echo', 'Отклик', 'spell_cast')] };
    const { events } = executeAction(freshState(), castAction, ctx);
    expect(narratives(events)).not.toContain('Сработало: Отклик');
  });
});

describe('C3 — событие reduced_to_0_hp', () => {
  it('урон до 0 HP будит triggered-слушателя ровно один раз', () => {
    const ctx: Ctx = { character, rng: HIT, passives: [auto('stand', 'Отчаянная стойкость', 'reduced_to_0_hp')] };
    const res = applyIncomingDamage(freshState(), 25, ctx); // 20 → 0
    expect(res.state.hp.current).toBe(0);
    expect(narratives(res.events).filter((t) => t === 'Сработало: Отчаянная стойкость')).toHaveLength(1);
  });

  it('урон НЕ до нуля не будит слушателя', () => {
    const ctx: Ctx = { character, rng: HIT, passives: [auto('stand', 'Отчаянная стойкость', 'reduced_to_0_hp')] };
    const res = applyIncomingDamage(freshState(), 5, ctx); // 20 → 15
    expect(narratives(res.events)).not.toContain('Сработало: Отчаянная стойкость');
  });

  it('добивание уже-бессознательного (0 HP) не эмитит повторно', () => {
    const zero = freshState(); zero.hp.current = 0;
    const ctx: Ctx = { character, rng: HIT, passives: [auto('stand', 'Отчаянная стойкость', 'reduced_to_0_hp')] };
    const res = applyIncomingDamage(zero, 5, ctx);
    expect(narratives(res.events)).not.toContain('Сработало: Отчаянная стойкость');
  });
});
