/**
 * Ярус 0 (дешёвая корректность движка) — регрессионные тесты на пакет правок.
 * Каждый describe = пункт роадмапа docs/engine-roadmap-2026-07-09.md. Тесты ДИСКРИМИНИРУЮЩИЕ:
 * упали бы до соответствующей правки по правильной причине (проверено адверсариальным ревью).
 *
 * Детерминизм: rng → к20 = floor(0.5×20)+1 = 11.
 */
import { describe, expect, it } from 'vitest';
import { executeAction, applyIncomingDamage } from './execute';
import { breakdownValue } from './breakdown';
import { collectRollModifiers } from './modifiers';
import type { ActiveEffectEntry, CharacterContext, EngineEvent, ExecuteContext, RuntimeState } from '../mvp/contracts';

type Dict = Record<string, unknown>;
type Ctx = ExecuteContext & { passives?: Dict[] };

const character: CharacterContext = {
  abilityMods: { str: 3, dex: 1, con: 2, int: 0, wis: 1, cha: 0 }, profBonus: 2, level: 5,
};
const HIT = () => 0.5; // к20 = 11

function fresh(activeEffects: ActiveEffectEntry[] = []): RuntimeState {
  return { hp: { current: 20, max: 20, temp: 0 }, resources: {}, maxResources: {}, equipment: {}, inventory: [], activeEffects };
}
function conditionEffect(value: string): ActiveEffectEntry {
  return { id: `c-${value}`, name: value, mechanics: { kind: 'condition', value }, source: 'test' };
}
const rolls = (events: EngineEvent[], label: string) =>
  events.filter((e): e is Extract<EngineEvent, { type: 'roll' }> => e.type === 'roll').filter((e) => e.label.startsWith(label));
const rollEv = (events: EngineEvent[], label: string) => rolls(events, label)[0];
const hasProne = (res: { targetState?: RuntimeState }) =>
  !!res.targetState?.activeEffects.some((e) => (e.mechanics as Dict).value === 'prone');

const attack: Dict = {
  name: 'Атака', activation: { cost: [] },
  effects: [{ resolution: 'attack_roll', ability: 'str', on_hit: [] }],
};
const shove: Dict = {
  name: 'Толчок', activation: { cost: [] },
  effects: [{ resolution: 'ability_check', ability: 'str', skill: 'athletics', who: 'target', on_success: [{ kind: 'condition', value: 'prone' }] }],
};

// ─── 0.4: сопротивление, выданное действием, режет входящий урон ────────────────
describe('Ярус0 0.4 — case resistance в роутере payload-ов (Ярость)', () => {
  const rageAction: Dict = {
    name: 'Ярость', activation: { cost: [] },
    effects: [{ resolution: 'auto', result: [{ kind: 'resistance', damage_type: 'bludgeoning', value: 'resistance' }] }],
  };
  it('после активации resistance попадает в activeEffects и половинит урон', () => {
    const ctx: Ctx = { character, rng: HIT };
    const { state } = executeAction(fresh(), rageAction, ctx);
    expect(state.activeEffects.some((e) => (e.mechanics as Dict).kind === 'resistance')).toBe(true);
    expect(applyIncomingDamage(state, 10, ctx, { damageType: 'bludgeoning' }).state.hp.current).toBe(15); // 10 → 5
  });
  it('до активации тот же урон — полный (регрессия: не было case resistance)', () => {
    const after = applyIncomingDamage(fresh(), 10, { character, rng: HIT } as Ctx, { damageType: 'bludgeoning' });
    expect(after.state.hp.current).toBe(10);
  });
  it('три резиста Ярости → все три в activeEffects, каждый режет свой тип', () => {
    const rage3: Dict = {
      name: 'Ярость', activation: { cost: [] },
      effects: [{ resolution: 'auto', result: [
        { kind: 'resistance', damage_type: 'bludgeoning', value: 'resistance' },
        { kind: 'resistance', damage_type: 'piercing', value: 'resistance' },
        { kind: 'resistance', damage_type: 'slashing', value: 'resistance' },
      ] }],
    };
    const ctx: Ctx = { character, rng: HIT };
    const { state } = executeAction(fresh(), rage3, ctx);
    expect(state.activeEffects.filter((e) => (e.mechanics as Dict).kind === 'resistance').length).toBe(3);
    for (const t of ['bludgeoning', 'piercing', 'slashing']) {
      expect(applyIncomingDamage(state, 10, ctx, { damageType: t }).state.hp.current).toBe(15);
    }
  });
  it('immunity/vulnerability из того же роутера работают', () => {
    const ctx: Ctx = { character, rng: HIT };
    const immune = executeAction(fresh(), { name: 'X', activation: { cost: [] }, effects: [{ resolution: 'auto', result: [{ kind: 'resistance', damage_type: 'fire', value: 'immunity' }] }] } as Dict, ctx);
    expect(applyIncomingDamage(immune.state, 10, ctx, { damageType: 'fire' }).state.hp.current).toBe(20);
    const vuln = executeAction(fresh(), { name: 'Y', activation: { cost: [] }, effects: [{ resolution: 'auto', result: [{ kind: 'resistance', damage_type: 'cold', value: 'vulnerability' }] }] } as Dict, ctx);
    expect(applyIncomingDamage(vuln.state, 5, ctx, { damageType: 'cold' }).state.hp.current).toBe(10);
  });
});

// ─── 0.5: предикат target_has_condition гейтится состоянием ЦЕЛИ ─────────────────
describe('Ярус0 0.5 — targetConditions в evalCtxOf', () => {
  // grappled = modifiers:[ATTACK()] scope:self, БЕЗ ADV_AGAINST → сам по себе преимущества
  // атакующему не проецирует. Значит advantage ниже приходит ТОЛЬКО от предиката (не от проекции).
  const predatorMod: ActiveEffectEntry = {
    id: 'm-pred', name: 'Хищник', source: 'test',
    mechanics: { kind: 'modifier', applies_to: { roll: 'attack' }, op: 'advantage', when: [{ kind: 'target_has_condition', value: 'grappled' }] },
  };
  it('цель схвачена → преимущество на атаку (предикат сработал)', () => {
    const ctx: Ctx = { character, rng: HIT, target: { ac: 5, runtimeState: fresh([conditionEffect('grappled')]) } };
    expect(rollEv(executeAction(fresh([predatorMod]), attack, ctx).events, 'Атака').roll.advantage).toBe('advantage');
  });
  it('цель без состояния → без преимущества', () => {
    const ctx: Ctx = { character, rng: HIT, target: { ac: 5, runtimeState: fresh() } };
    expect(rollEv(executeAction(fresh([predatorMod]), attack, ctx).events, 'Атака').roll.advantage).toBe('none');
  });
});

// ─── 0.5b: нераспознанный предикат-гейт → модификатор НЕ применяется (default false) ─
describe('Ярус0 0.5b — неизвестный предикат-гейт closed-by-default', () => {
  const gatedMod: ActiveEffectEntry = {
    id: 'm-gate', name: 'Щитовой', source: 'test',
    mechanics: { kind: 'modifier', applies_to: { roll: 'attack' }, op: 'advantage', when: [{ kind: 'shield_equipped' }] },
  };
  it('пока движок не умеет проверить условие — преимущество не даётся (раньше давалось всегда)', () => {
    const ctx: Ctx = { character, rng: HIT, target: { ac: 5, runtimeState: fresh() } };
    expect(rollEv(executeAction(fresh([gatedMod]), attack, ctx).events, 'Атака').roll.advantage).toBe('none');
  });
});

// ─── 0.3: C12 — Толчок; БМ по владению/экспертизе; состязание один бросок; mode:dc ──
describe('Ярус0 0.3 — runAbilityCheck (Толчок/Подножка)', () => {
  it('успех состязания → цель получает prone (раньше on_success игнорировал condition)', () => {
    const athlete: CharacterContext = { ...character, skillProficiencies: ['athletics'] };
    const ctx: Ctx = { character: athlete, rng: HIT, target: { ac: 5, checkMods: { athletics: 0 }, runtimeState: fresh() } };
    expect(hasProne(executeAction(fresh(), shove, ctx))).toBe(true);
  });
  it('проигрыш состязания → prone НЕ накладывается', () => {
    const athlete: CharacterContext = { ...character, skillProficiencies: ['athletics'] };
    const ctx: Ctx = { character: athlete, rng: HIT, target: { ac: 5, checkMods: { athletics: 20 }, runtimeState: fresh() } }; // защита 11+20=31 > 16
    expect(hasProne(executeAction(fresh(), shove, ctx))).toBe(false);
  });
  it('БМ добавляется только при владении навыком; экспертиза → ×2', () => {
    const noProf: Ctx = { character, rng: HIT, target: { ac: 5, checkMods: { athletics: 0 }, runtimeState: fresh() } };
    const m0 = rollEv(executeAction(fresh(), shove, noProf).events, 'Проверка').roll.modifiers;
    expect(m0.some((m) => m.value === 3)).toBe(true);   // СИЛ 3, без БМ
    expect(m0.some((m) => m.value === 5)).toBe(false);

    const athlete: CharacterContext = { ...character, skillProficiencies: ['athletics'] };
    const m1 = rollEv(executeAction(fresh(), shove, { character: athlete, rng: HIT, target: { ac: 5, checkMods: { athletics: 0 }, runtimeState: fresh() } }).events, 'Проверка').roll.modifiers;
    expect(m1.some((m) => m.value === 5)).toBe(true);    // СИЛ 3 + БМ 2

    const expert: CharacterContext = { ...character, skillProficiencies: ['athletics'], skillExpertise: ['athletics'] };
    const m2 = rollEv(executeAction(fresh(), shove, { character: expert, rng: HIT, target: { ac: 5, checkMods: { athletics: 0 }, runtimeState: fresh() } }).events, 'Проверка').roll.modifiers;
    expect(m2.some((m) => m.value === 7)).toBe(true);    // СИЛ 3 + БМ×2 (4)
  });
  it('состязание: ОДИН бросок защиты по выгоднейшему навыку, не максимум из нескольких', () => {
    const athlete: CharacterContext = { ...character, skillProficiencies: ['athletics'] };
    const shove2: Dict = {
      name: 'Толчок', activation: { cost: [] },
      effects: [{ resolution: 'ability_check', ability: 'str', skill: 'athletics', who: 'target', contest_vs: ['athletics', 'acrobatics'], on_success: [{ kind: 'condition', value: 'prone' }] }],
    };
    const ctx: Ctx = { character: athlete, rng: HIT, target: { ac: 5, checkMods: { athletics: 0, acrobatics: 2 }, runtimeState: fresh() } };
    const answers = rolls(executeAction(fresh(), shove2, ctx).events, 'Ответ');
    expect(answers.length).toBe(1);                       // один бросок защиты, не два
    expect(answers[0].label).toBe('Ответ (acrobatics)');  // выбрана выгоднейшая (мод +2 > +0)
  });
  it('mode:dc — успех при total ≥ DC накладывает исход', () => {
    const dcCheck: Dict = {
      name: 'ПроверкаDC', activation: { cost: [] },
      effects: [{ resolution: 'ability_check', ability: 'str', dc: '10', who: 'target', on_success: [{ kind: 'condition', value: 'prone' }] }],
    };
    const ctx: Ctx = { character, rng: HIT, target: { ac: 5, runtimeState: fresh() } }; // к20 11 + СИЛ 3 = 14 ≥ 10
    expect(hasProne(executeAction(fresh(), dcCheck, ctx))).toBe(true);
  });
  it('mode:dc — провал при total < DC: prone НЕ накладывается (contest-фолбэк дал бы ложный успех)', () => {
    const dcCheck: Dict = {
      name: 'ПроверкаDC', activation: { cost: [] },
      effects: [{ resolution: 'ability_check', ability: 'str', dc: '20', who: 'target', on_success: [{ kind: 'condition', value: 'prone' }] }],
    };
    const ctx: Ctx = { character, rng: HIT, target: { ac: 5, checkMods: { athletics: 0 }, runtimeState: fresh() } }; // 14 < 20
    expect(hasProne(executeAction(fresh(), dcCheck, ctx))).toBe(false);
  });
});

// ─── 0.2: проецируемый цель→атакующий модификатор — formula-aware ────────────────
describe('Ярус0 0.2 — projectedAgainst через evaluate(), не Number()', () => {
  const projMod: ActiveEffectEntry = {
    id: 'm-proj', name: 'Метка', source: 'test',
    mechanics: { kind: 'modifier', applies_to: { roll: 'attack' }, op: 'add', scope: 'target', value: 'prof' },
  };
  it('формульное значение (prof цели) разворачивается в число, а не теряется', () => {
    const targetCC: CharacterContext = { abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }, profBonus: 3, level: 5 };
    const ctx: Ctx = { character, rng: HIT, target: { ac: 30, characterContext: targetCC, runtimeState: fresh([projMod]) } };
    expect(rollEv(executeAction(fresh(), attack, ctx).events, 'Атака').roll.modifiers.some((m) => m.value === 3 && m.source === 'Метка')).toBe(true);
  });
});

// ─── 0.1: инвариант против двойного счёта ────────────────────────────────────────
describe('Ярус0 0.1 — breakdown И collectRollModifiers оба несут эффект-мод (лист берёт только parts)', () => {
  it('оба источника содержат +2 → их сумма задвоила бы; правка листа обязана брать только parts', () => {
    const blessMod: ActiveEffectEntry = {
      id: 'm-bless', name: 'Благословение', source: 'test',
      mechanics: { kind: 'modifier', applies_to: { roll: 'saving_throw', filter: { ability: 'dex' } }, op: 'add', value: '2' },
    };
    const state = fresh([blessMod]);
    const bd = breakdownValue('save:dex', character, state, []);
    const collected = collectRollModifiers(state, [], { roll: 'saving_throw', filter: { ability: 'dex' } });
    // parts (breakdown) УЖЕ включает эффект-мод; collected его ДУБЛИРУЕТ. [...parts, ...collected] → задвоение.
    expect(bd.parts.filter((p) => p.value === 2).length).toBe(1);
    expect(collected.modifiers.filter((m) => m.value === 2).length).toBe(1);
    expect(bd.value).toBe((character.abilityMods.dex ?? 0) + 2); // ЛВК 1 + 2 = 3 (владения нет)
  });
});
