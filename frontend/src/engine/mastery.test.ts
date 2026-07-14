/**
 * Искусность оружия (Weapon Mastery, PHB 2024).
 * Проверяем связку «оружие в руке → его мастерство → исход броска» и гейт по выбору персонажа:
 * свойство искусности работает ТОЛЬКО для видов оружия, выбранных особенностью «Искусное владение».
 */
import { describe, expect, it } from 'vitest';
import { executeAction } from './execute';
import { knowsMastery, masteryEvent } from './mastery';
import type { Card } from '../types';
import type { CharacterContext, EngineEvent, ExecuteContext, RuntimeState } from '../mvp/contracts';

type Dict = Record<string, unknown>;

const SAP = 'eff-sap';
const GRAZE = 'eff-graze';

const longsword = {
  id: 'w-longsword', name: 'Длинный меч', type: 'weapon', weapon_type: 'longsword',
  bonus_value: '1d8', damage_type: 'slashing', mastery: SAP,
} as unknown as Card;
// Глефа: Задевающее (на промахе), СИЛ. Фехтовального нет → weapon_mod = СИЛ.
const glaive = {
  id: 'w-glaive', name: 'Глефа', type: 'weapon', weapon_type: 'glaive',
  bonus_value: '1d10', damage_type: 'slashing', mastery: GRAZE,
} as unknown as Card;

const MASTERY_EFFECTS = {
  [SAP]: {
    name: 'Ослабляющее',
    mechanics: {
      activation: { mode: 'triggered', trigger: { event: 'hit' } },
      // who:'target' на ВЗАИМОДЕЙСТВИИ — так эффект ложится на цель (прецедент «Морозная поступь»).
      effects: [{ resolution: 'auto', who: 'target', result: [{
        kind: 'modifier', applies_to: { roll: 'attack' }, op: 'disadvantage',
        duration: { type: 'until_start_of_next_turn' }, stack_id: 'mastery-sap',
      }] }],
    },
  },
  [GRAZE]: {
    name: 'Задевающее',
    mechanics: {
      activation: { mode: 'triggered', trigger: { event: 'miss' } },
      effects: [{ resolution: 'auto', who: 'target', result: [{ kind: 'damage', amount: 'weapon_mod', type: 'weapon' }] }],
    },
  },
} as Record<string, { name: string; mechanics: Dict }>;

const character = (weaponMasteries?: string[], cards: Card[] = [longsword]): CharacterContext => ({
  abilityMods: { str: 3, dex: 1, con: 0, int: 0, wis: 0, cha: 0 },
  profBonus: 2, level: 5, equippedCards: cards, knownCards: cards, weaponMasteries,
});

const fresh = (): RuntimeState => ({
  hp: { current: 20, max: 20, temp: 0 }, resources: {}, maxResources: {},
  equipment: {}, inventory: [], activeEffects: [],
});
const withWeapon = (cardId: string): RuntimeState => ({ ...fresh(), equipment: { main_hand: cardId } });

// Оружейная атака: маркер dice:'weapon' связывает действие с оружием в руке.
const WEAPON_ATTACK: Dict = {
  name: 'Атака оружием',
  effects: [{ resolution: 'attack_roll', on_hit: [{ kind: 'damage', dice: 'weapon', type: 'weapon' }] }],
};

const HIT = () => 0.5;   // к20 = 11 → попадание по КЗ 5
const MISS = () => 0.0;  // к20 = 1 → промах по КЗ 30

function run(rng: () => number, ac: number, ctxPatch: Partial<ExecuteContext> = {}, weaponId = 'w-longsword') {
  const ctx = {
    character: character(['longsword']),
    rng,
    target: { ac, runtimeState: fresh() },
    masteryEffects: MASTERY_EFFECTS,
    ...ctxPatch,
  } as ExecuteContext;
  return executeAction(withWeapon(weaponId), WEAPON_ATTACK, ctx);
}

const narratives = (events: EngineEvent[]) =>
  events.filter((e) => e.type === 'narrative').map((e) => (e as { text: string }).text);
const damageTotal = (events: EngineEvent[]) =>
  events.filter((e) => e.type === 'damage').reduce((s, e) => s + ((e as { amount?: number }).amount ?? 0), 0);

describe('Искусность: гейт по выбранным видам оружия', () => {
  it('вид оружия выбран → мастерство активно', () => {
    expect(knowsMastery({ mastery: SAP, weaponType: 'longsword' } as never, ['longsword'])).toBe(true);
  });
  it('вид НЕ выбран → мастерство не работает', () => {
    expect(knowsMastery({ mastery: SAP, weaponType: 'longsword' } as never, ['dagger'])).toBe(false);
  });
  it('нет особенности (пустой список) → не работает', () => {
    expect(knowsMastery({ mastery: SAP, weaponType: 'longsword' } as never, undefined)).toBe(false);
  });
  it('у оружия нет мастерства → не работает', () => {
    expect(knowsMastery({ mastery: null, weaponType: 'longsword' } as never, ['longsword'])).toBe(false);
  });
  it('оружие без weapon_type сматчить нельзя → не работает', () => {
    expect(knowsMastery({ mastery: SAP, weaponType: null } as never, ['longsword'])).toBe(false);
  });
});

describe('Искусность: событие срабатывания из данных эффекта', () => {
  it('по умолчанию — на попадании', () => {
    expect(masteryEvent({ activation: { mode: 'triggered' } })).toBe('hit');
  });
  it('trigger.event:miss → на промахе', () => {
    expect(masteryEvent(MASTERY_EFFECTS[GRAZE].mechanics)).toBe('miss');
  });
});

describe('Ослабляющее (Sap) — на попадании кладёт помеху на цель', () => {
  it('попадание выбранным оружием → эффект на ЦЕЛИ', () => {
    const res = run(HIT, 5);
    expect(narratives(res.events)).toContain('Искусность: Ослабляющее');
    const fx = res.targetState?.activeEffects ?? [];
    expect(fx.map((e) => e.name)).toContain('Ослабляющее');
    expect((fx[0].mechanics as Dict).op).toBe('disadvantage');
  });

  it('вид оружия НЕ выбран → мастерство не срабатывает', () => {
    const res = run(HIT, 5, { character: character(['dagger']) });
    expect(narratives(res.events)).not.toContain('Искусность: Ослабляющее');
    expect(res.targetState?.activeEffects ?? []).toHaveLength(0);
  });

  it('механика не догружена (masteryEffects пуст) → тихо ничего', () => {
    const res = run(HIT, 5, { masteryEffects: {} });
    expect(narratives(res.events)).not.toContain('Искусность: Ослабляющее');
  });

  it('на ПРОМАХЕ hit-мастерство не срабатывает', () => {
    const res = run(MISS, 30);
    expect(narratives(res.events)).not.toContain('Искусность: Ослабляющее');
  });
});

describe('Задевающее (Graze) — на промахе урон = модификатор характеристики атаки', () => {
  const glaiveCtx = { character: character(['glaive'], [glaive]), masteryEffects: MASTERY_EFFECTS };

  it('промах → урон weapon_mod (СИЛ 3), тип оружия', () => {
    const res = run(MISS, 30, glaiveCtx, 'w-glaive');
    expect(narratives(res.events)).toContain('Искусность: Задевающее');
    // Атака промахнулась → единственный урон это Задевающее = СИЛ(3).
    expect(damageTotal(res.events)).toBe(3);
    expect(res.targetState!.hp.current).toBe(17);
  });

  it('попадание → Задевающее НЕ срабатывает (только на промахе)', () => {
    const res = run(HIT, 5, glaiveCtx, 'w-glaive');
    expect(narratives(res.events)).not.toContain('Искусность: Задевающее');
  });

  it('вид не выбран → на промахе ничего', () => {
    const res = run(MISS, 30, { ...glaiveCtx, character: character(['longsword'], [glaive]) }, 'w-glaive');
    expect(damageTotal(res.events)).toBe(0);
  });
});
