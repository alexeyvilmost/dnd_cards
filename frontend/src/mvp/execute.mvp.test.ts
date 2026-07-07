/**
 * Фаза E — единый исполнитель действий и заклинаний (E1–E5).
 * Зелёный набор = «базовые действия и действия классов/видов работают,
 * новые эффекты того же типа не требуют изменений кода» (данные-ориентированность).
 */
import { describe, expect, it } from 'vitest';
import type { EngineEvent, RollLog } from './contracts';
import { executeAction } from './contracts';
import {
  CARD_FROST_HAMMER, CARD_LEATHER_ARMOR,
  equippedFighterState, FIGHTER_CTX, FIGHTER_CTX_EQUIPPED, freshFighterState,
  MECH_ATTACK_BONUS_2, MECH_BREATH_WEAPON, MECH_NEXT_ATTACK_ADVANTAGE, MECH_OFFHAND_ATTACK,
  MECH_SECOND_WIND, MECH_SHOVE, MECH_UNARMED_STRIKE, MECH_WEAPON_ATTACK, seededRng,
} from './fixtures';

const rollEvents = (events: EngineEvent[]) =>
  events.filter((e): e is Extract<EngineEvent, { type: 'roll' }> => e.type === 'roll');

const attackRoll = (events: EngineEvent[]): RollLog => {
  const d20 = rollEvents(events).find((e) => e.roll.kind === 'd20');
  expect(d20, 'должен быть d20-бросок атаки').toBeTruthy();
  return d20!.roll;
};

describe('E2: attack_roll — три вариации атаки', () => {
  it('безоружная: к20 + СИЛ + БМ против КЗ; урон 1+СИЛ при попадании', () => {
    const { events } = executeAction(freshFighterState(), MECH_UNARMED_STRIKE, {
      character: FIGHTER_CTX, target: { ac: 5 }, rng: seededRng(3),
    });
    const roll = attackRoll(events);
    // модификаторы: +2 СИЛ + 2 БМ
    const modSum = roll.modifiers.reduce((s, m) => s + m.value, 0);
    expect(modSum).toBe(4);
    expect(roll.target).toEqual({ type: 'ac', value: 5 });
    // КЗ 5 — почти гарантированное попадание; проверяем ветку on_hit
    if (roll.outcome === 'hit' || roll.outcome === 'crit') {
      const dmg = events.find((e) => e.type === 'damage');
      expect(dmg).toBeTruthy();
      if (dmg?.type === 'damage') {
        expect(dmg.damageType).toBe('bludgeoning');
        expect(dmg.amount).toBe(3); // 1 + СИЛ(2), без костей
      }
    }
  });

  it('атака оружием: dice:"weapon"→1d8 меча, ability:"auto"→СИЛ; урон = кость + СИЛ', () => {
    const { events } = executeAction(equippedFighterState(), MECH_WEAPON_ATTACK, {
      character: FIGHTER_CTX_EQUIPPED, target: { ac: 1 }, rng: seededRng(8),
    });
    const dmg = events.find((e) => e.type === 'damage');
    expect(dmg).toBeTruthy();
    if (dmg?.type === 'damage') {
      expect(dmg.damageType).toBe('slashing'); // тип от оружия
      expect(dmg.roll?.dice).toHaveLength(1);
      expect(dmg.roll?.dice[0].sides).toBe(8);
      expect(dmg.amount).toBe(dmg.roll!.dice[0].result + 2); // + СИЛ
    }
  });

  it('Молот мороза +1: два события урона (осн. 2d6+СИЛ+зач., стих. 1d6 без бонуса); +1 к атаке', () => {
    const state = {
      ...freshFighterState(),
      equipment: { body: CARD_LEATHER_ARMOR.id, main_hand: CARD_FROST_HAMMER.id, off_hand: CARD_FROST_HAMMER.id },
    };
    const ctx = { ...FIGHTER_CTX, equippedCards: [CARD_LEATHER_ARMOR, CARD_FROST_HAMMER] };
    const { events } = executeAction(state, MECH_WEAPON_ATTACK, { character: ctx, target: { ac: 1 }, rng: seededRng(8) });

    // Зачарование +1 попадает в модификаторы броска атаки.
    const atk = attackRoll(events);
    expect(atk.modifiers.some((m) => m.value === 1)).toBe(true);

    const dmgs = events.filter((e): e is Extract<EngineEvent, { type: 'damage' }> => e.type === 'damage');
    expect(dmgs).toHaveLength(2); // основной + стихийный

    const bludg = dmgs.find((d) => d.damageType === 'bludgeoning')!;
    const cold = dmgs.find((d) => d.damageType === 'cold')!;
    expect(bludg.roll!.dice).toHaveLength(2); // 2d6
    expect(bludg.amount).toBe(bludg.roll!.dice.reduce((s, d) => s + d.result, 0) + 2 + 1); // + СИЛ(2) + зач.(1)
    expect(cold.roll!.dice).toHaveLength(1); // 1d6
    expect(cold.amount).toBe(cold.roll!.dice.reduce((s, d) => s + d.result, 0)); // без мода и зачарования
  });

  it('вторая рука: кость кинжала БЕЗ модификатора характеристики; тратит бонусное действие', () => {
    const { state, events } = executeAction(equippedFighterState(), MECH_OFFHAND_ATTACK, {
      character: FIGHTER_CTX_EQUIPPED, target: { ac: 1 }, rng: seededRng(9),
    });
    expect(state.resources.bonus_action).toBe(0);
    const dmg = events.find((e) => e.type === 'damage');
    if (dmg?.type === 'damage') {
      expect(dmg.roll?.dice[0].sides).toBe(4);
      expect(dmg.amount).toBe(dmg.roll!.dice[0].result); // ability:"none"
    }
  });

  it('КЛЮЧЕВОЙ ТЕСТ УНИФИКАЦИИ: эффект «преимущество на атаки» действует на ВСЕ три вариации', () => {
    for (const mech of [MECH_UNARMED_STRIKE, MECH_WEAPON_ATTACK, MECH_OFFHAND_ATTACK]) {
      const state = equippedFighterState();
      state.activeEffects.push({
        id: 'buff-adv', name: 'Преимущество на атаку',
        mechanics: MECH_NEXT_ATTACK_ADVANTAGE, source: 'тест',
      });
      const { events } = executeAction(state, mech, {
        character: FIGHTER_CTX_EQUIPPED, target: { ac: 10 }, rng: seededRng(21),
      });
      const roll = attackRoll(events);
      expect(roll.advantage, `преимущество не применилось к ${JSON.stringify(mech.effects)}`).toBe('advantage');
      expect(roll.dice).toHaveLength(2);
    }
  });

  it('плоский бафф +2 к атаке попадает в модификаторы с источником', () => {
    const state = equippedFighterState();
    state.activeEffects.push({
      id: 'buff-2', name: 'Бафф атаки', mechanics: MECH_ATTACK_BONUS_2, source: 'тест',
    });
    const { events } = executeAction(state, MECH_WEAPON_ATTACK, {
      character: FIGHTER_CTX_EQUIPPED, target: { ac: 10 }, rng: seededRng(4),
    });
    const roll = attackRoll(events);
    expect(roll.modifiers.some((m) => m.value === 2 && m.source !== 'БМ' && m.source !== 'СИЛ')).toBe(true);
  });

  it('стоимость: атака тратит действие; вторая подряд не проходит', () => {
    const state = equippedFighterState();
    const first = executeAction(state, MECH_WEAPON_ATTACK, {
      character: FIGHTER_CTX_EQUIPPED, target: { ac: 10 }, rng: seededRng(2),
    });
    expect(first.state.resources.action).toBe(0);
    expect(() => executeAction(first.state, MECH_WEAPON_ATTACK, {
      character: FIGHTER_CTX_EQUIPPED, target: { ac: 10 }, rng: seededRng(2),
    })).toThrow(); // недостаточно ресурса action
  });
});

describe('E3: save и ability_check', () => {
  it('Оружие дыхания: спасбросок ЛВК цели против 8+БМ+ТЕЛ; урон полный/половина', () => {
    const { events } = executeAction(freshFighterState(), MECH_BREATH_WEAPON, {
      character: FIGHTER_CTX, target: { ac: 0, saveMods: { dex: 0 } }, rng: seededRng(13),
    });
    const save = rollEvents(events).find((e) => e.roll.kind === 'save');
    expect(save).toBeTruthy();
    expect(save!.roll.target).toEqual({ type: 'dc', value: 11 }); // 8 + 2 БМ + 1 ТЕЛ
    const dmg = events.find((e) => e.type === 'damage');
    expect(dmg).toBeTruthy();
    if (dmg?.type === 'damage' && save!.roll.outcome === 'success') {
      // half on success: урон = floor(кость/2)
      expect(dmg.amount).toBe(Math.floor(dmg.roll!.dice[0].result / 2));
    }
  });

  it('Толкнуть: состязание атлетики против цели; on_success даёт события', () => {
    const { state, events } = executeAction(freshFighterState(), MECH_SHOVE, {
      character: FIGHTER_CTX, target: { checkMods: { athletics: -5 } }, rng: seededRng(17),
    });
    expect(state.resources.bonus_action).toBe(0);
    const checks = rollEvents(events).filter((e) => e.roll.kind === 'check');
    expect(checks.length).toBeGreaterThanOrEqual(2); // бросок атакующего и цели
  });
});

describe('E4: auto-эффекты', () => {
  it('Второе дыхание: лечит 1к10+уровень, тратит бонусное действие и заряд', () => {
    const state = freshFighterState();
    state.hp.current = 1;
    const { state: next, events } = executeAction(state, MECH_SECOND_WIND, {
      character: FIGHTER_CTX, rng: seededRng(6),
    });
    expect(next.resources.bonus_action).toBe(0);
    expect(next.resources.second_wind).toBe(1);
    const heal = events.find((e) => e.type === 'healing');
    expect(heal).toBeTruthy();
    if (heal?.type === 'healing') {
      expect(heal.roll?.dice[0].sides).toBe(10);
      expect(heal.amount).toBe(heal.roll!.dice[0].result + 1);
      expect(next.hp.current).toBe(Math.min(11, 1 + heal.amount));
    }
  });

  it('лечение не поднимает HP выше максимума', () => {
    const state = freshFighterState(); // full hp
    const { state: next } = executeAction(state, MECH_SECOND_WIND, {
      character: FIGHTER_CTX, rng: seededRng(6),
    });
    expect(next.hp.current).toBe(next.hp.max);
  });
});

describe('E5: заклинания через тот же исполнитель', () => {
  it('заговор с уроном (attack_roll, spell) исполняется без слота', () => {
    // Огненная стрела (упрощённо): заговор — атака заклинанием, 1d10 огня
    const fireBolt = {
      activation: { mode: 'active', cost: [{ resource: 'action' }] },
      effects: [{
        resolution: 'attack_roll', attack_kind: 'spell_ranged', ability: 'spellcasting', vs: 'ac',
        on_hit: [{ kind: 'damage', dice: '1d10', type: 'fire' }],
      }],
    };
    const ctx = { ...FIGHTER_CTX, spellcastingMod: 3 };
    const { events } = executeAction(freshFighterState(), fireBolt, {
      character: ctx, target: { ac: 1 }, rng: seededRng(30),
    });
    const roll = attackRoll(events);
    // + spellcasting(3) + БМ(2)
    expect(roll.modifiers.reduce((s, m) => s + m.value, 0)).toBe(5);
    const dmg = events.find((e) => e.type === 'damage');
    if (dmg?.type === 'damage') expect(dmg.damageType).toBe('fire');
  });

  it('заклинание 1 уровня тратит слот (ресурс spell_slot_1)', () => {
    const cureWounds = {
      activation: { mode: 'active', cost: [{ resource: 'action' }, { resource: 'spell_slot_1', amount: 1 }] },
      effects: [{ resolution: 'auto', result: [{ kind: 'healing', amount: '2d8 + spellcasting' }] }],
    };
    const state = freshFighterState();
    state.hp.current = 1;
    state.resources.spell_slot_1 = 2;
    state.maxResources.spell_slot_1 = 2;
    const ctx = { ...FIGHTER_CTX, spellcastingMod: 3 };
    const { state: next, events } = executeAction(state, cureWounds, {
      character: ctx, rng: seededRng(31),
    });
    expect(next.resources.spell_slot_1).toBe(1);
    const heal = events.find((e) => e.type === 'healing');
    expect(heal).toBeTruthy();
    if (heal?.type === 'healing') {
      expect(heal.roll?.dice).toHaveLength(2);
      expect(heal.amount).toBe(heal.roll!.dice[0].result + heal.roll!.dice[1].result + 3);
    }
  });

  it('narrative-payload не падает и даёт событие narrative', () => {
    const disengage = {
      activation: { mode: 'active', cost: [{ resource: 'action' }] },
      effects: [{ resolution: 'auto', result: [{ kind: 'narrative', description: 'Перемещение не провоцирует атак.' }] }],
    };
    const { events } = executeAction(freshFighterState(), disengage, {
      character: FIGHTER_CTX, rng: seededRng(1),
    });
    expect(events.some((e) => e.type === 'narrative')).toBe(true);
  });
});
