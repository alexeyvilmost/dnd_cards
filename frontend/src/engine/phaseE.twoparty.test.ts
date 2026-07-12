import { describe, expect, it } from 'vitest';
import { executeAction, applyIncomingDamage, readTargetSave } from './execute';
import type { ActiveEffectEntry, CharacterContext, EngineEvent, ExecuteContext, RuntimeState } from '../mvp/contracts';

type Dict = Record<string, unknown>;
type Ctx = ExecuteContext & { passives?: Dict[] };

const character: CharacterContext = {
  abilityMods: { str: 3, dex: 1, con: 2, int: 0, wis: 1, cha: 0 }, profBonus: 2, level: 5,
};
const HIT = () => 0.5;

function fresh(activeEffects: ActiveEffectEntry[] = []): RuntimeState {
  return { hp: { current: 20, max: 20, temp: 0 }, resources: {}, maxResources: {}, equipment: {}, inventory: [], activeEffects };
}
function conditionEffect(value: string): ActiveEffectEntry {
  return { id: `c-${value}`, name: value, mechanics: { kind: 'condition', value }, source: 'test' };
}
function resistanceEffect(damage_type: string, value: string): ActiveEffectEntry {
  return { id: `r-${damage_type}`, name: value, mechanics: { kind: 'resistance', damage_type, value }, source: 'test' };
}
const attackAction: Dict = {
  name: 'Атака', activation: { cost: [] },
  effects: [{ resolution: 'attack_roll', ability: 'str', on_hit: [{ kind: 'damage', dice: '1d6', type: 'weapon', ability: 'none' }] }],
};
const rollEv = (events: EngineEvent[], label: string) =>
  events.filter((e): e is Extract<EngineEvent, { type: 'roll' }> => e.type === 'roll').find((e) => e.label.startsWith(label));

describe('Фаза E — проекция состояний цели на атакующего (scope:target, данные)', () => {
  it('атака по опутанной цели — с преимуществом', () => {
    const ctx: Ctx = { character, rng: HIT, target: { ac: 5, runtimeState: fresh([conditionEffect('restrained')]) } };
    const { events } = executeAction(fresh(), attackAction, ctx);
    expect(rollEv(events, 'Атака')!.roll.advantage).toBe('advantage');
  });

  it('атака по невидимой цели — с помехой (проекция disadvantage)', () => {
    const ctx: Ctx = { character, rng: HIT, target: { ac: 5, runtimeState: fresh([conditionEffect('invisible')]) } };
    const { events } = executeAction(fresh(), attackAction, ctx);
    expect(rollEv(events, 'Атака')!.roll.advantage).toBe('disadvantage');
  });

  it('без состояний цели проекции нет', () => {
    const ctx: Ctx = { character, rng: HIT, target: { ac: 5, runtimeState: fresh() } };
    const { events } = executeAction(fresh(), attackAction, ctx);
    expect(rollEv(events, 'Атака')!.roll.advantage).toBe('none');
  });

  it('урон по выбранной цели списывает её HP и возвращается в targetState', () => {
    const ctx: Ctx = { character, rng: HIT, target: { ac: 5, runtimeState: fresh() } };
    const r = executeAction(fresh(), attackAction, ctx);
    expect(r.targetState, 'targetState должен вернуться при уроне по цели').toBeDefined();
    expect(r.targetState!.hp.current).toBeLessThan(20); // HP цели уменьшился
    expect(r.state.hp.current).toBe(20); // HP исполнителя не тронут
  });

  it('сопротивление цели уменьшает урон по ней вдвое', () => {
    const full = executeAction(fresh(), attackAction,
      { character, rng: HIT, target: { ac: 5, runtimeState: fresh() } } as Ctx).targetState!.hp.current;
    const resisted = executeAction(fresh(), attackAction,
      { character, rng: HIT, target: { ac: 5, runtimeState: fresh([resistanceEffect('bludgeoning', 'resistance')]) } } as Ctx).targetState!.hp.current;
    const dmgFull = 20 - full;
    const dmgResisted = 20 - resisted;
    expect(dmgResisted).toBe(Math.floor(dmgFull / 2));
  });

  it('состояние на носителе (self) не даёт носителю преимущество на свои атаки', () => {
    // oputan self: помеха на свои атаки; преимущество — только атакующему по нему.
    const { events } = executeAction(fresh([conditionEffect('restrained')]), attackAction, { character, rng: HIT, target: { ac: 5 } } as Ctx);
    expect(rollEv(events, 'Атака')!.roll.advantage).toBe('disadvantage');
  });
});

describe('Фаза E — сопротивления при получении урона', () => {
  const ctx: Ctx = { character, rng: HIT };
  it('сопротивление огню — половина урона', () => {
    const res = applyIncomingDamage(fresh([resistanceEffect('fire', 'resistance')]), 10, ctx, { damageType: 'fire' });
    expect(res.events.find((e) => e.type === 'damage')).toMatchObject({ amount: 5 });
    expect(res.state.hp.current).toBe(15);
  });
  it('иммунитет — ноль урона', () => {
    const res = applyIncomingDamage(fresh([resistanceEffect('fire', 'immunity')]), 10, ctx, { damageType: 'fire' });
    expect(res.state.hp.current).toBe(20);
  });
  it('уязвимость — двойной урон', () => {
    const res = applyIncomingDamage(fresh([resistanceEffect('fire', 'vulnerability')]), 5, ctx, { damageType: 'fire' });
    expect(res.state.hp.current).toBe(10);
  });
  it('другой тип урона — без сопротивления', () => {
    const res = applyIncomingDamage(fresh([resistanceEffect('fire', 'resistance')]), 10, ctx, { damageType: 'cold' });
    expect(res.state.hp.current).toBe(10);
  });
});

describe('Фаза E — динамические спасброски цели', () => {
  it('спасбросок цели считается из её характеристик + владения', () => {
    const targetCC: CharacterContext = {
      abilityMods: { str: 0, dex: 4, con: 0, int: 0, wis: 0, cha: 0 }, profBonus: 2, level: 5, saveProficiencies: ['dex'],
    };
    const saveAction: Dict = {
      name: 'Спелл', activation: { cost: [] },
      effects: [{ resolution: 'save', ability: 'dex', dc: '13', on_fail: [{ kind: 'damage', dice: '2d6', type: 'fire' }] }],
    };
    const ctx: Ctx = { character, rng: HIT, target: { ac: 10, characterContext: targetCC } };
    const { events } = executeAction(fresh(), saveAction, ctx);
    const save = rollEv(events, 'Спасбросок')!;
    // мод цели = ЛВК 4 + БМ 2 (владение) = 6
    expect(save.roll.modifiers.some((m) => m.value === 6 && m.source === 'цель')).toBe(true);
  });
});

describe('Спасбросок бросает цель (онлайн-бой): forceSaveOutcome + readTargetSave', () => {
  const halfSaveAction: Dict = {
    name: 'Огненный шар', activation: { cost: [] },
    effects: [{ resolution: 'save', ability: 'dex', dc: '15',
      on_fail: [{ kind: 'damage', dice: '8d6', type: 'fire' }],
      on_success: [{ kind: 'damage', dice: '8d6', type: 'fire', on_success: 'half' }] }],
  };

  it('forceSaveOutcome:fail — d20 спаса НЕ катится (нет события), урон применён полностью', () => {
    const ctx: Ctx = { character, rng: HIT, target: { ac: 10, runtimeState: fresh() }, forceSaveOutcome: 'fail' };
    const r = executeAction(fresh(), halfSaveAction, ctx);
    expect(rollEv(r.events, 'Спасбросок'), 'при форсе спас не катится').toBeUndefined();
    expect(r.targetState!.hp.current).toBeLessThan(20); // урон применён (провал)
  });

  it('forceSaveOutcome:success + half — цель получает половину урона', () => {
    // Высокий HP, чтобы урон не упёрся в 0 (иначе половина считалась бы неверно).
    const big = (): RuntimeState => ({ hp: { current: 200, max: 200, temp: 0 }, resources: {}, maxResources: {}, equipment: {}, inventory: [], activeEffects: [] });
    const failHp = executeAction(fresh(), halfSaveAction,
      { character, rng: HIT, target: { ac: 10, runtimeState: big() }, forceSaveOutcome: 'fail' } as Ctx).targetState!.hp.current;
    const okHp = executeAction(fresh(), halfSaveAction,
      { character, rng: HIT, target: { ac: 10, runtimeState: big() }, forceSaveOutcome: 'success' } as Ctx).targetState!.hp.current;
    const dmgFail = 200 - failHp;
    const dmgOk = 200 - okHp;
    expect(dmgFail).toBeGreaterThan(0);
    expect(dmgOk).toBe(Math.floor(dmgFail / 2)); // успех = половина от урона провала (те же кости)
  });

  it('readTargetSave — извлекает ability/dc/half/avoidsConditions из механики', () => {
    const s = readTargetSave(halfSaveAction, { character, rng: HIT } as Ctx);
    expect(s).toEqual({ ability: 'dex', dc: 15, half: true, avoidsConditions: [] });
    // действие без спаса цели → null
    expect(readTargetSave(attackAction, { character, rng: HIT } as Ctx)).toBeNull();
    // спас, налагающий состояние → avoidsConditions несёт его id
    const charmAction: Dict = { name: 'Очарование', activation: { cost: [] },
      effects: [{ resolution: 'save', ability: 'wis', dc: '13', on_fail: [{ kind: 'condition', value: 'charmed', op: 'apply' }] }] };
    expect(readTargetSave(charmAction, { character, rng: HIT } as Ctx)!.avoidsConditions).toEqual(['charmed']);
  });
});

describe('save_avoids_condition — condition-scoped модификатор спасброска (Происхождение фей)', () => {
  const charmAction: Dict = {
    name: 'Очарование', activation: { cost: [] },
    effects: [{ resolution: 'save', ability: 'wis', dc: '13', on_fail: [{ kind: 'condition', value: 'charmed', op: 'apply' }] }],
  };
  // Пассивка «Происхождение фей»: преимущество на спас против Очарования (charmed).
  const feyAncestry: ActiveEffectEntry = {
    id: 'fey', name: 'Происхождение фей',
    mechanics: { kind: 'modifier', applies_to: { roll: 'saving_throw' }, op: 'advantage', when: [{ kind: 'save_avoids_condition', value: 'charmed' }] },
    source: 'race',
  };
  const targetCC: CharacterContext = { abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 1, cha: 0 }, profBonus: 2, level: 5 };

  it('преимущество на спас против налагаемого состояния', () => {
    const ctx: Ctx = { character, rng: HIT, target: { ac: 10, characterContext: targetCC, runtimeState: fresh([feyAncestry]) } };
    const save = rollEv(executeAction(fresh(), charmAction, ctx).events, 'Спасбросок')!;
    expect(save.roll.advantage).toBe('advantage');
  });

  it('нет преимущества, если сейв налагает ДРУГОЕ состояние', () => {
    const poisonAction: Dict = { name: 'Яд', activation: { cost: [] },
      effects: [{ resolution: 'save', ability: 'wis', dc: '13', on_fail: [{ kind: 'condition', value: 'poisoned', op: 'apply' }] }] };
    const ctx: Ctx = { character, rng: HIT, target: { ac: 10, characterContext: targetCC, runtimeState: fresh([feyAncestry]) } };
    const save = rollEv(executeAction(fresh(), poisonAction, ctx).events, 'Спасбросок')!;
    expect(save.roll.advantage).toBe('none');
  });

  it('нет преимущества на сейв БЕЗ состояния (только урон)', () => {
    const damageOnly: Dict = { name: 'Огонь', activation: { cost: [] },
      effects: [{ resolution: 'save', ability: 'wis', dc: '13', on_fail: [{ kind: 'damage', dice: '2d6', type: 'fire' }] }] };
    const ctx: Ctx = { character, rng: HIT, target: { ac: 10, characterContext: targetCC, runtimeState: fresh([feyAncestry]) } };
    const save = rollEv(executeAction(fresh(), damageOnly, ctx).events, 'Спасбросок')!;
    expect(save.roll.advantage).toBe('none');
  });
});
