import { describe, expect, it } from 'vitest';
import {
  parseFreeuse, freeuseKey, isFreeusePoolKey, FREEUSE_SHOWCASE_KEY,
  findFreeusePoolKey, applyFreeuseCost, collectFreeuseRecharge, collectFreeuseRecovery,
  resolveFreeusePoolKey, freeuseSpellReferences, type FreeuseSpec,
} from './freeuse';
import {syncRuntimeResources} from '../character/resourceInit';
import type {AssembledCharacter} from '../character/assemble';
import { canPay, pay } from './cost';
import { longRest, shortRest } from './turn';
import { freshFighterState, FIGHTER_CTX } from '../mvp/fixtures';

type Dict = Record<string, unknown>;

describe('freeuse — нормализация параметра', () => {
  it('explicit at_will has no usage pool or recharge schedule', () => {
    const spec = parseFreeuse({ at_will: true });
    expect(spec).toEqual({ count: 0, recharge: '', atWill: true });
    expect(collectFreeuseRecharge([{ spell: 'test-spell', ...spec! }])).toEqual({});
  });
  it('true → 1 раз, долгий отдых', () => {
    expect(parseFreeuse(true)).toEqual({ count: 1, recharge: 'long_rest' });
  });
  it('число → столько раз, долгий отдых', () => {
    expect(parseFreeuse(3)).toEqual({ count: 3, recharge: 'long_rest' });
  });
  it('объект → count/recharge/level', () => {
    expect(parseFreeuse({ count: 2, recharge: 'short_rest', level: 2 }))
      .toEqual({ count: 2, recharge: 'short_rest', level: 2 });
  });
  it('дефолты объекта: count=1, recharge=long_rest', () => {
    expect(parseFreeuse({})).toEqual({ count: 1, recharge: 'long_rest' });
  });
  it('false/null → undefined (нет freeuse)', () => {
    expect(parseFreeuse(false)).toBeUndefined();
    expect(parseFreeuse(null)).toBeUndefined();
    expect(parseFreeuse(undefined)).toBeUndefined();
  });
});

describe('freeuse — ключи пула', () => {
  it('keeps independently chosen spells in separate generic pools through payment and JSON reload',()=>{
    const template=parseFreeuse({count:2,recharge:'long_rest'})!;
    const specs=['selected-ward','selected-healing'].map(spell=>({spell,...template}));
    const assembled={actions:[],effects:[],spells:[]} as unknown as AssembledCharacter;
    const before=syncRuntimeResources(FIGHTER_CTX,assembled,undefined,specs);
    expect(before.maxResources).toMatchObject({'freeuse-selected-ward':2,'freeuse-selected-healing':2});
    const paid=pay({...freshFighterState(),...before},[{resource:freeuseKey(specs[0].spell),amount:1}]).state;
    const after=syncRuntimeResources(FIGHTER_CTX,assembled,JSON.parse(JSON.stringify(paid)),specs);
    expect(after.resources).toMatchObject({'freeuse-selected-ward':1,'freeuse-selected-healing':2});
  });
  it.each([
    {name_en:'Dragon’s Breath',card_number:'SPELL-ward',id:'ward-id',legacy:'dragons_breath'},
    {name_en:'Misty Step',card_number:'SPELL-step',id:'step-id',legacy:'step-id'},
  ])('preserves the saved $legacy pool after a grant reference repair, including payment and rest',spell=>{
    const key=freeuseKey(spell.legacy),raw={count:3,recharge:'short_rest',level:2};
    const spec:FreeuseSpec={spell:spell.card_number,...parseFreeuse(raw)!};
    const base=freshFighterState(),existing={...base,resources:{...base.resources,[key]:1},maxResources:{...base.maxResources,[key]:3}};
    const assembled={actions:[],effects:[],spells:[spell]} as unknown as AssembledCharacter;
    const synced=syncRuntimeResources(FIGHTER_CTX,assembled,JSON.parse(JSON.stringify(existing)),[spec]);
    expect(synced.resources[key]).toBe(1);expect(synced.maxResources[key]).toBe(3);
    expect(synced.resources).not.toHaveProperty(freeuseKey(spec.spell));
    const bindings={spells:[spell],resources:synced.maxResources};
    expect(resolveFreeusePoolKey(spec,bindings)).toBe(key);
    expect(collectFreeuseRecharge([spec],bindings)).toEqual({[key]:'short_rest'});
    expect(findFreeusePoolKey(synced.resources,{aliases:freeuseSpellReferences(spell)})).toBe(key);
    const cost=((applyFreeuseCost({activation:{cost:[{resource:'action'},{resource:'spell_slot',level:1}]}},key).activation as Dict).cost as Dict[]);
    const paid=pay({...existing,...synced},cost).state;
    expect(paid.resources[key]).toBe(0);
    const reloaded=JSON.parse(JSON.stringify(paid));
    expect(syncRuntimeResources(FIGHTER_CTX,assembled,reloaded,[spec]).resources[key]).toBe(0);
    const rested=shortRest(reloaded,{...FIGHTER_CTX,resourceRecharge:collectFreeuseRecharge([spec],bindings)}).state;
    expect(rested.resources[key]).toBe(3);
    expect(longRest(reloaded,FIGHTER_CTX).state.resources[key]).toBe(3);
    expect(raw).toEqual({count:3,recharge:'short_rest',level:2});
  });
  it('recognizes both previous punctuation aliases without creating a catalog resource',()=>{
    const spell={id:'breath-id',card_number:'SPELL-breath',name_en:'Dragon’s Breath'};
    expect(freeuseSpellReferences(spell)).toContain('dragons_breath');
    expect(freeuseSpellReferences(spell)).toContain('dragon_s_breath');
    expect(resolveFreeusePoolKey({spell:spell.card_number},{spells:[spell],resources:{'freeuse-dragon_s_breath':0}}))
      .toBe('freeuse-dragon_s_breath');
    expect(parseFreeuse({count:2,resource_id:'old-annotation',resource_id_prefix:'old-prefix-'}))
      .toEqual({count:2,recharge:'long_rest',level:undefined});
  });
  it('binds explicit rest recovery to the saved generic alias as well',()=>{
    const spell={id:'recovery-id',card_number:'SPELL-recovery',name_en:'Healing Word'};
    const recovery={short_rest:{mode:'fixed' as const,amount:1},long_rest:{mode:'full' as const}};
    const spec={spell:spell.card_number,...parseFreeuse({count:3,recovery})!};
    expect(collectFreeuseRecovery([spec],{spells:[spell],resources:{'freeuse-healing_word':0}}))
      .toEqual({'freeuse-healing_word':recovery});
  });
  it('freeuseKey → freeuse-<spell>', () => {
    expect(freeuseKey('misty_step')).toBe('freeuse-misty_step');
  });
  it('isFreeusePoolKey: пул да, витрина нет, uses_ нет', () => {
    expect(isFreeusePoolKey('freeuse-misty_step')).toBe(true);
    expect(isFreeusePoolKey(FREEUSE_SHOWCASE_KEY)).toBe(false); // freeuse-spells — витрина
    expect(isFreeusePoolKey('uses_ACT-rage')).toBe(false);
    expect(isFreeusePoolKey('spell_slot_2')).toBe(false);
  });
  it('findFreeusePoolKey ищет по slug ИЛИ uuid (контент ссылается по-разному)', () => {
    const res = { 'freeuse-misty_step': 1 };
    expect(findFreeusePoolKey(res, { cardNumber: 'misty_step', id: 'uuid-1' })).toBe('freeuse-misty_step');
    const byId = { 'freeuse-uuid-1': 1 };
    expect(findFreeusePoolKey(byId, { cardNumber: 'misty_step', id: 'uuid-1' })).toBe('freeuse-uuid-1');
    expect(findFreeusePoolKey({}, { cardNumber: 'misty_step', id: 'uuid-1' })).toBeNull();
  });
});

describe('freeuse — подмена стоимости', () => {
  it('applyFreeuseCost убирает spell_slot, добавляет freeuse-пул, СОХРАНЯЕТ действие', () => {
    const mech: Dict = { activation: { mode: 'active', cost: [{ resource: 'bonus_action' }, { resource: 'spell_slot', level: 2 }] } };
    const out = applyFreeuseCost(mech, 'freeuse-misty_step');
    const cost = ((out.activation as Dict).cost as Dict[]);
    expect(cost.some((c) => c.resource === 'spell_slot')).toBe(false);
    expect(cost.some((c) => c.resource === 'bonus_action')).toBe(true); // действие остаётся
    expect(cost.find((c) => c.resource === 'freeuse-misty_step')).toEqual({ resource: 'freeuse-misty_step', amount: 1 });
  });
});

describe('freeuse — оплата пулом (generic canPay/pay)', () => {
  it('трата пула decrement-ит; при нуле не платит', () => {
    const state = { ...freshFighterState(), resources: { 'freeuse-misty_step': 1 } } as ReturnType<typeof freshFighterState>;
    const cost = [{ resource: 'freeuse-misty_step', amount: 1 }];
    expect(canPay(state, cost).ok).toBe(true);
    const { state: after } = pay(state, cost);
    expect(after.resources['freeuse-misty_step']).toBe(0);
    expect(canPay(after, cost).ok).toBe(false); // пул исчерпан
  });
});

describe('freeuse — перезарядка', () => {
  const specs: FreeuseSpec[] = [{ spell: 'misty_step', count: 2, recharge: 'long_rest' }];

  it('collectFreeuseRecharge → freeuse-<spell> → per', () => {
    expect(collectFreeuseRecharge(specs)).toEqual({ 'freeuse-misty_step': 'long_rest' });
  });

  it('долгий отдых восстанавливает пул до max (даже без recharge-карты)', () => {
    const base = freshFighterState();
    const state = {
      ...base,
      resources: { ...base.resources, 'freeuse-misty_step': 0 },
      maxResources: { ...base.maxResources, 'freeuse-misty_step': 2 },
    };
    const { state: next } = longRest(state, FIGHTER_CTX);
    expect(next.resources['freeuse-misty_step']).toBe(2);
  });

  it('короткий отдых восстанавливает freeuse ТОЛЬКО при recharge:short_rest в карте', () => {
    const base = freshFighterState();
    const mk = () => ({
      ...base,
      resources: { ...base.resources, 'freeuse-misty_step': 0 },
      maxResources: { ...base.maxResources, 'freeuse-misty_step': 2 },
    });
    // long_rest-пул на коротком отдыхе НЕ восстанавливается
    const long = shortRest(mk(), { ...FIGHTER_CTX, resourceRecharge: { 'freeuse-misty_step': 'long_rest' } });
    expect(long.state.resources['freeuse-misty_step']).toBe(0);
    // short_rest-пул восстанавливается
    const short = shortRest(mk(), { ...FIGHTER_CTX, resourceRecharge: { 'freeuse-misty_step': 'short_rest' } });
    expect(short.state.resources['freeuse-misty_step']).toBe(2);
  });
});
