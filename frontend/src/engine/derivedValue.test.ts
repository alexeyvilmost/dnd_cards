import { describe, expect, it } from 'vitest';
import { pickBestMethod } from './derivedValue';
import { computeAC } from './ac';
import type { CharacterContext, RuntimeState } from '../mvp/contracts';
import type { Card } from '../types';

it('gates AC methods by content predicates, including an unrelated ward', () => {
  const shield = {id:'shield',type:'shield',defense_type:'shield',bonus_value:'2',name:'Щит'} as Card;
  const ctx = {...character,abilityMods:{...character.abilityMods,wis:4},knownCards:[shield]};
  const passive = {effects:[{result:[{kind:'set_value',target:'ac_base',formula:'10 + dex + wis',when:[{kind:'not',of:{kind:'wielding_shield'}}]}]}]};
  expect(computeAC(ctx,freshState(),[passive]).value).toBe(17);
  expect(computeAC(ctx,{...freshState(),equipment:{off_hand:shield.id}},[passive]).value).toBe(15);
  const ward = {kind:'set_value',target:'ac_base',formula:'19',when:[{kind:'you_have_effect_stack',value:'test-ward'}]};
  expect(computeAC(ctx,freshState(),[ward]).value).toBe(13);
  const active = {...freshState(),activeEffects:[{id:'ward',name:'Ward',source:'Test',mechanics:{stack_id:'test-ward'}}]};
  expect(computeAC(ctx,active,[ward]).value).toBe(19);
});

describe('pickBestMethod (парадигма №3)', () => {
  it('берёт максимум применимого метода + аддитив', () => {
    const bd = pickBestMethod(
      [{ name: 'a', value: 12, parts: [] }, { name: 'b', value: 15, parts: [] }],
      [{ value: 2, source: 'Щит' }],
    );
    expect(bd.value).toBe(17);
    expect(bd.rejected).toEqual([{ name: 'a', value: 12 }]);
  });

  it('неприменимые методы игнорируются даже при большем значении', () => {
    const bd = pickBestMethod([
      { name: 'a', value: 99, parts: [], applicable: false },
      { name: 'b', value: 10, parts: [] },
    ]);
    expect(bd.value).toBe(10);
    expect(bd.rejected ?? []).toEqual([]);
  });

  it('пустой набор методов → 0', () => {
    expect(pickBestMethod([]).value).toBe(0);
  });
});

const character: CharacterContext = {
  abilityMods: { str: 0, dex: 3, con: 1, int: 0, wis: 0, cha: 0 },
  profBonus: 2,
  level: 1,
};

function freshState(): RuntimeState {
  return {
    hp: { current: 10, max: 10, temp: 0 },
    resources: {}, maxResources: {}, equipment: {}, inventory: [], activeEffects: [],
  };
}

const override = (formula: string) => ({
  effects: [{ result: [{ kind: 'set_value', target: 'ac_base', formula }] }],
});

describe('computeAC как методы-кандидаты', () => {
  it('из двух безбронных методов берётся больший (фикс «первый vs максимум»)', () => {
    const bd = computeAC(character, freshState(), [override('10+dex+con'), override('13+dex')]);
    // 10+3+1=14 vs 13+3=16 → 16
    expect(bd.value).toBe(16);
    expect(bd.rejected?.some((r) => r.value === 14)).toBe(true);
  });

  it('без доспеха и без override → 10+ЛВК', () => {
    expect(computeAC(character, freshState(), []).value).toBe(13);
  });

  it('#8: активный эффект ac_base (Доспех мага) — метод-кандидат наравне с пассивками', () => {
    const state = freshState();
    state.activeEffects = [{
      id: 'ac-1', name: 'Доспех мага', source: 'Доспех мага', expiry: 'manual',
      mechanics: { kind: 'set_value', target: 'ac_base', formula: '13+dex' },
    }];
    // 13+3=16 vs база 10+3=13 → 16
    expect(computeAC(character, state, []).value).toBe(16);
  });
});
