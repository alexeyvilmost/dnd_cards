import { describe, expect, it } from 'vitest';
import { executeAction, applyIncomingDamage } from './execute';
import { startTurn } from './turn';
import { startConcentration } from './concentration';
import type { CharacterContext, EngineEvent, ExecuteContext, RuntimeState } from '../mvp/contracts';

type Dict = Record<string, unknown>;
type Ctx = ExecuteContext & { passives?: Dict[] };

const character: CharacterContext = {
  abilityMods: { str: 3, dex: 1, con: 2, int: 0, wis: 1, cha: 0 },
  profBonus: 2, level: 5,
};

function freshState(activeEffects: RuntimeState['activeEffects'] = []): RuntimeState {
  return {
    hp: { current: 20, max: 20, temp: 0 },
    resources: { reaction: 1, spell_slot_1: 2 },
    maxResources: { reaction: 1, spell_slot_1: 2 },
    equipment: {}, inventory: [], activeEffects,
  };
}

const HIT = () => 0.5;  // natural 11
const MISS = () => 0;   // natural 1 → промах

const attackAction: Dict = {
  name: 'Атака', activation: { cost: [] },
  effects: [{ resolution: 'attack_roll', ability: 'str', on_hit: [{ kind: 'damage', dice: '1d6', type: 'weapon', ability: 'none' }] }],
};
const sneak: Dict = {
  id: 'sneak', name: 'Скрытая атака',
  activation: { mode: 'triggered', trigger: { event: 'hit' } },
  uses: { count: 1, per: 'turn' },
  effects: [{ resolution: 'auto', result: [{ kind: 'damage', dice: '2d6', type: 'weapon' }] }],
};
const smite: Dict = {
  id: 'smite', name: 'Божественная кара',
  activation: { mode: 'triggered', cost: [{ resource: 'spell_slot', level: 1 }], trigger: { event: 'hit' } },
  effects: [{ resolution: 'auto', result: [{ kind: 'damage', dice: '2d8', type: 'radiant' }] }],
};
const rebuke: Dict = {
  id: 'rebuke', name: 'Адское возмездие',
  activation: { mode: 'reaction', cost: [{ resource: 'reaction' }], trigger: { event: 'damage_taken' } },
  effects: [{ resolution: 'save', ability: 'dex', dc: '13', on_fail: [{ kind: 'damage', dice: '2d10', type: 'fire' }] }],
};

const narratives = (events: EngineEvent[]) => events.filter((e) => e.type === 'narrative').map((e) => (e as { text: string }).text);
const damages = (events: EngineEvent[]) => events.filter((e) => e.type === 'damage');
const rollEv = (events: EngineEvent[], label: string) =>
  events.filter((e): e is Extract<EngineEvent, { type: 'roll' }> => e.type === 'roll').find((e) => e.label.startsWith(label));
const isConcentrating = (s: RuntimeState) => s.activeEffects.some((e) => (e.mechanics as Dict)?.kind === 'concentration');

describe('Фаза A — triggered он-хит-райдеры', () => {
  it('Скрытая атака (авто) срабатывает при попадании и даёт доп. урон', () => {
    const ctx: Ctx = { character, rng: HIT, target: { ac: 1 }, passives: [sneak] };
    const { events, state } = executeAction(freshState(), attackAction, ctx);
    const atk = rollEv(events, 'Атака')!;
    expect(atk.roll.outcome === 'hit' || atk.roll.outcome === 'crit').toBe(true);
    expect(narratives(events)).toContain('Сработало: Скрытая атака');
    expect(damages(events).length).toBeGreaterThanOrEqual(2); // урон оружия + скрытая
    expect(state.firedThisTurn).toContain('sneak');
  });

  it('Скрытая атака не срабатывает при промахе', () => {
    const ctx: Ctx = { character, rng: MISS, target: { ac: 1 }, passives: [sneak] };
    const { events } = executeAction(freshState(), attackAction, ctx);
    expect(narratives(events)).not.toContain('Сработало: Скрытая атака');
  });

  it('Скрытая атака — раз за ход; после startTurn снова доступна', () => {
    const ctx: Ctx = { character, rng: HIT, target: { ac: 1 }, passives: [sneak] };
    const r1 = executeAction(freshState(), attackAction, ctx);
    expect(narratives(r1.events)).toContain('Сработало: Скрытая атака');
    const r2 = executeAction(r1.state, attackAction, ctx);
    expect(narratives(r2.events)).not.toContain('Сработало: Скрытая атака');
    const turn = startTurn(r2.state);
    const r3 = executeAction(turn.state, attackAction, ctx);
    expect(narratives(r3.events)).toContain('Сработало: Скрытая атака');
  });

  it('Божественная кара (со стоимостью) предлагается как реакция при попадании', () => {
    const ctx: Ctx = { character, rng: HIT, target: { ac: 1 }, passives: [smite] };
    const res = executeAction(freshState(), attackAction, ctx);
    expect(res.pendingReactions?.map((r) => r.listenerId)).toContain('smite');
    // авто-урона кары нет — ждёт решения игрока (только урон оружия)
    expect(damages(res.events)).toHaveLength(1);
  });
});

describe('Фаза A — damage_taken: авто-концентрация и реакции', () => {
  it('провал проверки концентрации снимает концентрацию', () => {
    const conc = startConcentration(freshState(), 'Благословение');
    const ctx: Ctx = { character, rng: HIT, passives: [] };
    const res = applyIncomingDamage(conc.state, 40, ctx); // СЛ 20; 11+ТЕЛ2=13 < 20 → провал
    const save = rollEv(res.events, 'Концентрация')!;
    expect(save.roll.outcome).toBe('fail');
    expect(narratives(res.events).some((t) => /Концентрация потеряна/.test(t))).toBe(true);
    expect(isConcentrating(res.state)).toBe(false);
  });

  it('успех проверки концентрации сохраняет концентрацию', () => {
    const conc = startConcentration(freshState(), 'Благословение');
    const ctx: Ctx = { character, rng: HIT, passives: [] };
    const res = applyIncomingDamage(conc.state, 6, ctx); // СЛ 10; 13 ≥ 10 → успех
    expect(rollEv(res.events, 'Концентрация')!.roll.outcome).toBe('success');
    expect(isConcentrating(res.state)).toBe(true);
  });

  it('урон применяется к хитам (временные, затем текущие)', () => {
    const s = freshState();
    s.hp.temp = 3;
    const res = applyIncomingDamage(s, 8, { character, rng: HIT } as Ctx);
    expect(res.state.hp.temp).toBe(0);
    expect(res.state.hp.current).toBe(20 - 5); // 3 поглощены темпом
  });

  it('Адское возмездие предлагается как реакция при получении урона', () => {
    const ctx: Ctx = { character, rng: HIT, passives: [rebuke] };
    const res = applyIncomingDamage(freshState(), 5, ctx);
    expect(res.pendingReactions?.map((r) => r.listenerId)).toContain('rebuke');
  });
});

describe('Фаза A — interrupt-триггеры: optional и ctx.triggers', () => {
  const giantFree: Dict = {
    id: 'giant', name: 'Пламя великана',
    activation: { mode: 'triggered', optional: true, trigger: { event: 'hit' } },
    uses: { per: 'turn' },
    effects: [{ resolution: 'auto', result: [{ kind: 'damage', dice: '1d10', type: 'fire' }] }],
  };
  it('свободный OPTIONAL-триггер (Голиаф) ПРЕДЛАГАЕТСЯ, а не срабатывает сам', () => {
    const ctx: Ctx = { character, rng: HIT, target: { ac: 1 }, passives: [giantFree] };
    const res = executeAction(freshState(), attackAction, ctx);
    expect(res.pendingReactions?.map((r) => r.listenerId)).toContain('giant');
    expect(damages(res.events)).toHaveLength(1); // авто-урона нет — только оружие
  });
  it('свободный НЕ-optional триггер срабатывает сам (как Скрытая атака)', () => {
    const nonOpt: Dict = { ...giantFree, id: 'g2', activation: { mode: 'triggered', trigger: { event: 'hit' } } };
    const ctx: Ctx = { character, rng: HIT, target: { ac: 1 }, passives: [nonOpt] };
    const res = executeAction(freshState(), attackAction, ctx);
    expect(res.pendingReactions ?? []).toHaveLength(0);
    expect(damages(res.events).length).toBeGreaterThanOrEqual(2); // оружие + авто-огонь
  });
  it('ctx.triggers — отдельный пул слушателей (заклинание-реакция), не пассивка', () => {
    const ctx = { character, rng: HIT, target: { ac: 1 }, triggers: [smite] } as ExecuteContext & { triggers: Dict[] };
    const res = executeAction(freshState(), attackAction, ctx);
    expect(res.pendingReactions?.map((r) => r.listenerId)).toContain('smite');
  });
});
