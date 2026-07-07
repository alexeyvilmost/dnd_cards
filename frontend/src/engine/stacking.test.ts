import { describe, expect, it } from 'vitest';
import { executeAction } from './execute';
import type { CharacterContext, ExecuteContext, RuntimeState } from '../mvp/contracts';

type Dict = Record<string, unknown>;

const character: CharacterContext = {
  abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }, profBonus: 2, level: 1,
};
const ctx: ExecuteContext = { character, rng: () => 0.5 };

function fresh(): RuntimeState {
  return { hp: { current: 10, max: 10, temp: 0 }, resources: {}, maxResources: {}, equipment: {}, inventory: [], activeEffects: [] };
}
function auto(payload: Dict): Dict {
  return { name: 'Тест', activation: { cost: [] }, effects: [{ resolution: 'auto', result: [payload] }] };
}
const mods = (s: RuntimeState) => s.activeEffects.filter((e) => (e.mechanics as Dict)?.kind === 'modifier');
const conds = (s: RuntimeState, v: string) => s.activeEffects.filter((e) => {
  const m = e.mechanics as Dict; return m?.kind === 'condition' && m.value === v;
});

describe('Фаза D — стекинг активных эффектов', () => {
  it('без stack_id модификаторы независимы (обратная совместимость)', () => {
    const m = auto({ kind: 'modifier', applies_to: { roll: 'attack' }, op: 'add', value: '+1' });
    const r2 = executeAction(executeAction(fresh(), m, ctx).state, m, ctx);
    expect(mods(r2.state)).toHaveLength(2);
  });

  it('stack_id overwrite (дефолт): одноимённое не удваивается', () => {
    const m = auto({ kind: 'modifier', applies_to: { roll: 'attack' }, op: 'add', value: '+1', stack_id: 'bless' });
    const r2 = executeAction(executeAction(fresh(), m, ctx).state, m, ctx);
    expect(mods(r2.state)).toHaveLength(1);
  });

  it('stack_type ignore: остаётся первый', () => {
    const m = auto({ kind: 'modifier', applies_to: { roll: 'attack' }, op: 'add', value: '+1', stack_id: 'x', stack_type: 'ignore' });
    const r2 = executeAction(executeAction(fresh(), m, ctx).state, m, ctx);
    expect(mods(r2.state)).toHaveLength(1);
  });

  it('stack_type stack: независимые экземпляры', () => {
    const m = auto({ kind: 'modifier', applies_to: { roll: 'attack' }, op: 'add', value: '+1', stack_id: 'x', stack_type: 'stack' });
    const r2 = executeAction(executeAction(fresh(), m, ctx).state, m, ctx);
    expect(mods(r2.state)).toHaveLength(2);
  });

  it('priority: потентнейший остаётся; слабый не вытесняет сильного, сильный вытесняет слабого', () => {
    const strong = auto({ kind: 'modifier', applies_to: { roll: 'attack' }, op: 'add', value: '+3', stack_id: 'x', stack_priority: 2 });
    const weak = auto({ kind: 'modifier', applies_to: { roll: 'attack' }, op: 'add', value: '+1', stack_id: 'x', stack_priority: 1 });
    const a = executeAction(executeAction(fresh(), strong, ctx).state, weak, ctx);
    expect(mods(a.state)).toHaveLength(1);
    expect((a.state.activeEffects[0].mechanics as Dict).value).toBe('+3');
    const b = executeAction(executeAction(fresh(), weak, ctx).state, strong, ctx);
    expect((b.state.activeEffects[0].mechanics as Dict).value).toBe('+3');
  });

  it('condition additive: длительности складываются в один экземпляр', () => {
    const m = auto({ kind: 'condition', value: 'burning', op: 'apply', duration: { type: 'rounds', amount: 2 }, stack_type: 'additive' });
    const r2 = executeAction(executeAction(fresh(), m, ctx).state, m, ctx);
    const es = conds(r2.state, 'burning');
    expect(es).toHaveLength(1);
    expect(es[0].roundsLeft).toBe(4);
  });

  it('состояние по умолчанию бинарно — не дублируется', () => {
    const m = auto({ kind: 'condition', value: 'stunned', op: 'apply', duration: { type: 'rounds', amount: 1 } });
    const r2 = executeAction(executeAction(fresh(), m, ctx).state, m, ctx);
    expect(conds(r2.state, 'stunned')).toHaveLength(1);
  });
});
