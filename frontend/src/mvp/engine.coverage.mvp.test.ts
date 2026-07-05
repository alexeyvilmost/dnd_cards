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

// ─── Payload-ы исполнителя: condition / temp_hp / resource / scaling (E5+) ──
describe('payload-ы исполнителя: condition / temp_hp / resource / scaling', () => {
  const noCost = { mode: 'active', cost: [] };

  it('save.on_fail: наложение состояния condition (ошеломление)', () => {
    const mech: Mech = {
      activation: noCost,
      effects: [{
        resolution: 'save', ability: 'con', dc: '30', who: 'target',
        on_fail: [{ kind: 'condition', value: 'stunned', op: 'apply', duration: { type: 'rounds', amount: 1 } }],
      }],
    };
    const { state: next, events } = executeAction(freshFighterState(), mech, {
      character: FIGHTER_CTX, target: { saveMods: { con: 0 } }, rng: seededRng(7),
    });
    expect(events.some((e) => e.type === 'condition_applied' && e.condition === 'stunned')).toBe(true);
    const entry = next.activeEffects.find((e) => e.name === 'stunned');
    expect(entry).toBeTruthy();
    expect(entry?.roundsLeft).toBe(1);
  });

  it('auto: temp_hp применяются к hp.temp и не суммируются (остаётся большее)', () => {
    const mk = (amount: string): Mech => ({
      activation: noCost,
      effects: [{ resolution: 'auto', result: [{ kind: 'temp_hp', amount }] }],
    });
    const first = executeAction(freshFighterState(), mk('5'), { character: FIGHTER_CTX, rng: seededRng(1) });
    expect(first.state.hp.temp).toBe(5);
    expect(first.events.some((e) => e.type === 'temp_hp' && e.amount === 5)).toBe(true);
    const second = executeAction(first.state, mk('3'), { character: FIGHTER_CTX, rng: seededRng(1) });
    expect(second.state.hp.temp).toBe(5);
  });

  it('auto: resource op:grant даёт действие сверх максимума (Прилив действий)', () => {
    const surge: Mech = {
      activation: noCost,
      effects: [{ resolution: 'auto', result: [{ kind: 'resource', op: 'grant', id: 'action', amount: 1 }] }],
    };
    const { state: next, events } = executeAction(freshFighterState(), surge, { character: FIGHTER_CTX, rng: seededRng(1) });
    expect(next.resources.action).toBe(2); // максимум 1 — grant идёт сверх
    expect(events.some((e) => e.type === 'resource_restored' && e.resource === 'action')).toBe(true);
  });

  it('cost: канон схемы {resource:"spell_slot", level:1} списывает spell_slot_1', () => {
    const base = freshFighterState();
    const state: RuntimeState = {
      ...base,
      resources: { ...base.resources, spell_slot_1: 2 },
      maxResources: { ...base.maxResources, spell_slot_1: 2 },
    };
    const spellMech: Mech = {
      activation: { mode: 'active', cost: [{ resource: 'spell_slot', level: 1, amount: 1 }] },
      effects: [{ resolution: 'auto', result: [{ kind: 'narrative', description: 'тест' }] }],
    };
    const { state: next } = executeAction(state, spellMech, { character: FIGHTER_CTX, rng: seededRng(1) });
    expect(next.resources.spell_slot_1).toBe(1);
  });

  it('auto: resource op:restore восстанавливает ячейку заклинаний до максимума', () => {
    const base = freshFighterState();
    const state: RuntimeState = {
      ...base,
      resources: { ...base.resources, spell_slot_1: 0 },
      maxResources: { ...base.maxResources, spell_slot_1: 2 },
    };
    const restore: Mech = {
      activation: noCost,
      effects: [{ resolution: 'auto', result: [{ kind: 'resource', op: 'restore', id: 'spell_slot', level: 1, amount: 5 }] }],
    };
    const { state: next } = executeAction(state, restore, { character: FIGHTER_CTX, rng: seededRng(1) });
    expect(next.resources.spell_slot_1).toBe(2); // кламп по максимуму
  });

  it('scaling per character_level: заговор получает вторую кость на 5 уровне', () => {
    const fireBolt: Mech = {
      activation: noCost,
      effects: [{
        resolution: 'attack_roll', ability: 'spellcasting', vs: 'ac',
        on_hit: [{ kind: 'damage', dice: '1d10', type: 'fire', scaling: { per: 'character_level', dice: '1d10' } }],
      }],
    };
    const run = (level: number) => executeAction(freshFighterState(), fireBolt, {
      character: { ...FIGHTER_CTX, level, spellcastingMod: 3 }, target: { ac: 1 }, rng: seededRng(30),
    });
    const diceAt = (level: number) => {
      const dmg = run(level).events.find((e) => e.type === 'damage');
      return dmg?.type === 'damage' ? dmg.roll?.dice.length : undefined;
    };
    expect(diceAt(1)).toBe(1);
    expect(diceAt(5)).toBe(2);
  });

  it('scaling per spell_slot_above: апкаст лечения добавляет кости по уровню слота', () => {
    const cure: Mech = {
      activation: noCost,
      effects: [{ resolution: 'auto', result: [{ kind: 'healing', amount: '2d8', scaling: { per: 'spell_slot_above', dice: '1d8' } }] }],
    };
    const state = freshFighterState();
    state.hp.current = 1;
    const { events } = executeAction(state, cure, {
      character: FIGHTER_CTX, rng: seededRng(31), spell: { baseLevel: 1, castLevel: 3 },
    });
    const heal = events.find((e) => e.type === 'healing');
    expect(heal?.type === 'healing' ? heal.roll?.dice.length : 0).toBe(4); // 2d8 + 1d8 + 1d8
  });
});

// ─── boon / reroll / transform / состояния (глубина боёвки) ─────────────────
describe('payload-ы боёвки: boon / reroll / transform / модификаторы состояний', () => {
  const noCost = { mode: 'active', cost: [] };
  const autoMech = (...result: Mech[]): Mech => ({
    activation: noCost,
    effects: [{ resolution: 'auto', result }],
  });

  it('boon: талон (Вдохновение барда) вешает чип с костью и пишет инструкцию', () => {
    const { state: next, events } = executeAction(
      freshFighterState(),
      { name: 'Вдохновение барда', ...autoMech({ kind: 'boon', id: 'bardic_inspiration', die: '1d6' }) },
      { character: FIGHTER_CTX, rng: seededRng(1) },
    );
    const chip = next.activeEffects.find((e) => e.name.includes('Талон'));
    expect(chip).toBeTruthy();
    expect(chip?.expiry).toBe('manual');
    expect(events.some((e) => e.type === 'narrative' && e.text.includes('1к6'))).toBe(true);
  });

  it('reroll (Везунчик): нарратив-инструкция переброса, состояние не мутирует', () => {
    const before = freshFighterState();
    const { state: next, events } = executeAction(
      before,
      autoMech({ kind: 'reroll', which: 'd20', keep: 'either' }),
      { character: FIGHTER_CTX, rng: seededRng(1) },
    );
    expect(events.some((e) => e.type === 'narrative' && /Переброс к20/.test(e.text))).toBe(true);
    expect(next.activeEffects).toHaveLength(before.activeEffects.length);
  });

  it('transform (Дикий облик): чип облика + напоминание про стат-блок', () => {
    const { state: next, events } = executeAction(
      freshFighterState(),
      { name: 'Дикий облик', ...autoMech({ kind: 'transform', max_cr: 0.25 }) },
      { character: FIGHTER_CTX, rng: seededRng(1) },
    );
    expect(next.activeEffects.some((e) => e.name.startsWith('Облик:'))).toBe(true);
    expect(events.some((e) => e.type === 'narrative' && e.text.includes('стат-блок'))).toBe(true);
  });

  it('состояние «отравлен» даёт помеху атакам и проверкам, но не спасброскам', () => {
    const state = withEffects([
      modEffect('poisoned', { kind: 'condition', value: 'poisoned', op: 'apply' }),
    ]);
    expect(collectRollModifiers(state, [], { roll: 'attack' }).advantage).toBe('disadvantage');
    expect(collectRollModifiers(state, [], { roll: 'ability_check' }).advantage).toBe('disadvantage');
    expect(collectRollModifiers(state, [], { roll: 'saving_throw', filter: { ability: 'con' } }).advantage).toBe('none');
  });

  it('состояние «опутан»: помеха на спасброски ЛВК, но не ТЕЛ', () => {
    const state = withEffects([
      modEffect('restrained', { kind: 'condition', value: 'restrained', op: 'apply' }),
    ]);
    expect(collectRollModifiers(state, [], { roll: 'saving_throw', filter: { ability: 'dex' } }).advantage).toBe('disadvantage');
    expect(collectRollModifiers(state, [], { roll: 'saving_throw', filter: { ability: 'con' } }).advantage).toBe('none');
  });
});

// ─── Карта пробелов унифицированной схемы (payload-kind → рантайм) ───────────
// Помечено it.todo: конструкции схемы, ещё не исполняемые движком. Снимать
// пометку по мере реализации соответствующего исхода в engine/execute.ts.
describe('НЕреализованные payload-ы исполнителя (roadmap до MVP)', () => {
  it.todo('set_die: подмена кубика заранее (Предсказание)');
  it.todo('grant_action во время исполнения (Хитрое действие → варианты бонусного действия)');
  it.todo('movement: применяет фактическое перемещение цели, а не только лог');
  it.todo('resistance: сопротивление/иммунитет учитываются при расчёте урона');
});
