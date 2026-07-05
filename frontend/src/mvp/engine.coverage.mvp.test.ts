/**
 * Расширенное покрытие рантайм-движка (фазы D–E): краевые случаи сбора
 * модификаторов, стоимости, инициализации ресурсов, хода/отдыха и маршрутизации
 * исполнителя. Плюс карта нереализованных payload-ов унифицированной схемы —
 * помечены `it.todo`, чтобы явно фиксировать пробелы до MVP, не ломая набор.
 */
import { describe, expect, it } from 'vitest';
import type { ActiveEffectEntry, RuntimeState } from './contracts';
import {
  canPay, collectRollModifiers, executeAction, initResources, longRest, pay, startTurn,
} from './contracts';
import { FIGHTER_CTX, freshFighterState, seededRng } from './fixtures';

type Mech = Record<string, unknown>;

function withEffects(effects: ActiveEffectEntry[]): RuntimeState {
  return { ...freshFighterState(), activeEffects: effects };
}
const modEffect = (id: string, payload: Mech): ActiveEffectEntry =>
  ({ id, name: id, source: 'тест', mechanics: payload });

describe('collectRollModifiers — комбинация преимущества/помехи и фильтры', () => {
  it('преимущество + помеха на один бросок взаимно гасятся до none', () => {
    const state = withEffects([
      modEffect('adv', { kind: 'modifier', applies_to: { roll: 'attack' }, op: 'advantage' }),
      modEffect('dis', { kind: 'modifier', applies_to: { roll: 'attack' }, op: 'disadvantage' }),
    ]);
    expect(collectRollModifiers(state, [], { roll: 'attack' }).advantage).toBe('none');
  });

  it('несколько плоских бонусов складываются в список модификаторов с источниками', () => {
    const state = withEffects([
      modEffect('bless', { kind: 'modifier', applies_to: { roll: 'attack' }, op: 'add', value: '+2', source: 'Благословение' }),
      modEffect('guide', { kind: 'modifier', applies_to: { roll: 'attack' }, op: 'add', value: '+1', source: 'Указание' }),
    ]);
    const out = collectRollModifiers(state, [], { roll: 'attack' });
    expect(out.modifiers).toHaveLength(2);
    expect(out.modifiers.reduce((s, m) => s + m.value, 0)).toBe(3);
    expect(out.modifiers.map((m) => m.source)).toContain('Благословение');
  });

  it('пассивная механика и активный эффект собираются вместе', () => {
    const passive: Mech = { activation: { mode: 'passive' }, effects: [{ resolution: 'auto', result: [
      { kind: 'modifier', applies_to: { roll: 'attack' }, op: 'add', value: '+1', source: 'пассивка' },
    ] }] };
    const state = withEffects([
      modEffect('a', { kind: 'modifier', applies_to: { roll: 'attack' }, op: 'add', value: '+2', source: 'эффект' }),
    ]);
    const out = collectRollModifiers(state, [passive], { roll: 'attack' });
    expect(out.modifiers.reduce((s, m) => s + m.value, 0)).toBe(3);
  });

  it('фильтр эффекта учитывается: str-бонус не попадает в dex-спасбросок (R2)', () => {
    const state = withEffects([
      modEffect('rage', { kind: 'modifier', applies_to: { roll: 'saving_throw', filter: { ability: 'str' } }, op: 'advantage' }),
    ]);
    expect(collectRollModifiers(state, [], { roll: 'saving_throw', filter: { ability: 'dex' } }).advantage).toBe('none');
    expect(collectRollModifiers(state, [], { roll: 'saving_throw', filter: { ability: 'str' } }).advantage).toBe('advantage');
  });
});

describe('cost — мультиресурс и атомарность', () => {
  it('canPay возвращает все нехватающие ресурсы', () => {
    const state = { ...freshFighterState(), resources: { action: 1, bonus_action: 0, second_wind: 0 } } as RuntimeState;
    const res = canPay(state, [{ resource: 'bonus_action' }, { resource: 'second_wind', amount: 1 }]);
    expect(res.ok).toBe(false);
    expect(res.missing.sort()).toEqual(['bonus_action', 'second_wind']);
  });

  it('pay при нехватке не меняет состояние и не генерирует событий', () => {
    const state = { ...freshFighterState(), resources: { ...freshFighterState().resources, bonus_action: 0 } } as RuntimeState;
    const { state: next, events } = pay(state, [{ resource: 'bonus_action' }]);
    expect(next.resources.bonus_action).toBe(0);
    expect(events).toHaveLength(0);
  });
});

describe('initResources — формулы и базовые ресурсы хода', () => {
  it('count-формула ресурса класса вычисляется через движок формул', () => {
    const { maxResources } = initResources(FIGHTER_CTX, { rage: { count: 'prof_bonus', per: 'long_rest' } }, []);
    expect(maxResources.rage).toBe(FIGHTER_CTX.profBonus); // 2
  });

  it('action/bonus_action/reaction всегда присутствуют даже без ресурсов класса', () => {
    const { maxResources } = initResources(FIGHTER_CTX, null, []);
    expect(maxResources.action).toBe(1);
    expect(maxResources.bonus_action).toBe(1);
    expect(maxResources.reaction).toBe(1);
  });
});

describe('ход/отдых — истечение эффектов и восстановление слотов', () => {
  it('startTurn снимает эффект start_of_next_turn, но сохраняет manual', () => {
    const state = withEffects([
      { id: 'dodge', name: 'Уклонение', source: 't', mechanics: {}, expiry: 'start_of_next_turn' },
      { id: 'bless', name: 'Благословение', source: 't', mechanics: {}, expiry: 'manual' },
    ]);
    const { state: next } = startTurn(state);
    expect(next.activeEffects.map((e) => e.id)).toEqual(['bless']);
  });

  it('longRest восстанавливает ячейки заклинаний и снимает все эффекты', () => {
    const base = freshFighterState();
    const state: RuntimeState = {
      ...base,
      resources: { ...base.resources, spell_slot_1: 0 },
      maxResources: { ...base.maxResources, spell_slot_1: 2 },
      activeEffects: [{ id: 'x', name: 'бафф', source: 't', mechanics: {} }],
    };
    const { state: next } = longRest(state, FIGHTER_CTX);
    expect(next.resources.spell_slot_1).toBe(2);
    expect(next.activeEffects).toHaveLength(0);
  });
});

describe('executeAction — маршрутизация и устойчивость', () => {
  it('неизвестный resolution не роняет исполнитель, а логирует NOT_IMPLEMENTED', () => {
    const weird: Mech = { activation: { mode: 'active', cost: [] }, effects: [{ resolution: 'summon' }] };
    const { events } = executeAction(freshFighterState(), weird, { character: FIGHTER_CTX, rng: seededRng(1) });
    expect(events.some((e) => e.type === 'narrative' && /NOT_IMPLEMENTED/.test(e.text))).toBe(true);
  });

  it('несколько auto-исходов (модификатор + лечение) применяются за один вызов', () => {
    const state = freshFighterState();
    state.hp.current = 1;
    const mech: Mech = { activation: { mode: 'active', cost: [] }, effects: [{ resolution: 'auto', result: [
      { kind: 'modifier', applies_to: { roll: 'attack' }, op: 'advantage' },
      { kind: 'healing', amount: '1d4' },
    ] }] };
    const { state: next, events } = executeAction(state, mech, { character: FIGHTER_CTX, rng: seededRng(5) });
    expect(next.activeEffects.length).toBeGreaterThan(0);
    expect(events.some((e) => e.type === 'healing')).toBe(true);
  });
});

// ─── Карта пробелов унифицированной схемы (payload-kind → рантайм) ───────────
// Помечено it.todo: конструкции схемы, ещё не исполняемые движком. Снимать
// пометку по мере реализации соответствующего исхода в engine/execute.ts.
describe('НЕреализованные payload-ы исполнителя (roadmap до MVP)', () => {
  it.todo('save.on_fail: наложение состояния condition (Внезапный удар → ошеломление)');
  it.todo('auto: temp_hp (временные хиты) применяются к hp.temp');
  it.todo('auto: resource op:grant/restore во время исполнения (Прилив действий, восстановление ячейки)');
  it.todo('boon: «талон» союзнику (Вдохновение барда)');
  it.todo('reroll / set_die: переброс и подмена кубика (Удача, Предсказание)');
  it.todo('transform: превращение в стат-блок (Дикий облик)');
  it.todo('grant_action во время исполнения (Хитрое действие → варианты бонусного действия)');
  it.todo('scaling: апкаст заклинаний и рост заговора по уровню персонажа');
  it.todo('movement: применяет фактическое перемещение цели, а не только лог');
  it.todo('resistance: сопротивление/иммунитет учитываются при расчёте урона');
});
