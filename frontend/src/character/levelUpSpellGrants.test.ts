import {describe, expect, it} from 'vitest';
import type {CharacterClass, PassiveEffect, Spell} from '../types';
import {assemble} from './assemble';
import {emptyDraft} from './types';
import {resolveCharacterRules} from './rules/resolveCharacterRules';
import {buildCharacterContext} from './runtime';
import {levelUpSpellGrantRefs, levelUpSpellGrants, type LevelUpSpellGrantSnapshot} from './levelUpPresentation';

const spells = [
  {id:'spell-a',card_number:'SPELL-alpha',name:'Alpha',level:1,mechanics:{}},
  {id:'spell-b',card_number:'SPELL-beta',name:'Beta',level:2,mechanics:{}},
  {id:'spell-child',card_number:'SPELL-child',name:'Child',level:1,mechanics:{variant_of_spell_id:'spell-a'}},
] as Spell[];
const byRef = new Map(spells.flatMap(spell => [[spell.id,spell],[spell.card_number,spell]]));
function snapshot(level:number, declarations:Array<{origin:string;feature:string;results:Record<string,unknown>[]}>) {
  const klass = {id:'class-a',card_number:'CLASS-a',name:'Class A',hit_die:'d10'} as CharacterClass;
  const draft = {...emptyDraft(),classId:klass.id,level,classLevels:{[klass.id]:level},abilities:{str:10,dex:10,con:12,int:10,wis:10,cha:16}};
  const assembled = assemble({race:null,klass,background:null,feats:[],spells:[],actions:[],effects:declarations.map(declaration=>({
    origin:{kind:'class' as const,id:declaration.origin,name:`Source ${declaration.origin}`},
    effect:{id:declaration.feature,card_number:`EFF-${declaration.feature}`,name:declaration.feature,
      mechanics:{effects:[{resolution:'auto',result:declaration.results}]}} as unknown as PassiveEffect,
  }))},draft);
  const rules = resolveCharacterRules({draft,assembled});
  return {assembled,grants:rules.appliedGrants,context:buildCharacterContext(rules,draft,[],klass)} satisfies LevelUpSpellGrantSnapshot;
}
const granted=(value:string,extra:Record<string,unknown>={})=>({kind:'grant_spell',value,label:'always_prepared',...extra});

describe('level-up automatic spell grant projection',()=>{
  it('discovers a data-owned free cast without learning it or adding it to assembled spells',()=>{
    const before=snapshot(1,[]),after=snapshot(2,[{origin:'class-a',feature:'first',results:[granted('SPELL-alpha',{freeuse:{count:1,recharge:'long_rest'}})]}]);
    const copy=JSON.stringify(after);
    expect(levelUpSpellGrantRefs(before,after)).toEqual(['SPELL-alpha']);
    expect(levelUpSpellGrants(before,after,byRef)).toMatchObject([{spell:{id:'spell-a'},access:'always_prepared',freeUses:1,change:'added',grant:{source:{name:'Source class-a: first'}}}]);
    expect(after.assembled.spells).toEqual([]);
    expect(JSON.stringify(after)).toBe(copy);
  });
  it('compares two separately declared always-prepared subclass spells and drops an obsolete live selection',()=>{
    const before=snapshot(2,[]);
    const first=snapshot(3,[{origin:'subclass-first',feature:'oath-first',results:[granted('SPELL-alpha'),granted('SPELL-beta')]}]);
    const replacement=snapshot(3,[{origin:'subclass-other',feature:'oath-other',results:[granted('SPELL-beta')]}]);
    expect(levelUpSpellGrants(before,first,byRef).map(entry=>[entry.spell.id,entry.access])).toEqual([
      ['spell-a','always_prepared'],['spell-b','always_prepared'],
    ]);
    expect(levelUpSpellGrants(before,replacement,byRef)).toMatchObject([{spell:{id:'spell-b'},grant:{source:{originEntityId:'subclass-other'}}}]);
    expect(levelUpSpellGrants(before,replacement,byRef)).toHaveLength(1);
  });
  it('shows a changed evaluated free-use allowance, but not unchanged or aliased grants',()=>{
    const declarations=[{origin:'class-a',feature:'scaling',results:[granted('SPELL-alpha',{label:'known',freeuse:{count:'prof_bonus',recharge:'short_rest'}})]}];
    const before=snapshot(4,declarations),after=snapshot(5,declarations);
    expect(levelUpSpellGrants(before,after,byRef)).toMatchObject([{change:'changed',freeUses:3,access:'known'}]);
    expect(levelUpSpellGrants(after,after,byRef)).toEqual([]);
    const alias=snapshot(5,[{...declarations[0],results:[granted('spell-a',{label:'known',freeuse:{count:'prof_bonus',recharge:'short_rest'}})]}]);
    expect(levelUpSpellGrants(after,alias,byRef)).toEqual([]);
  });
  it('preserves additional source grants to an already-owned spell and excludes child versions',()=>{
    const existing={origin:'class-a',feature:'old',results:[granted('SPELL-alpha')]};
    const before=snapshot(2,[existing]);
    const after=snapshot(3,[existing,{origin:'subclass-other',feature:'new',results:[granted('spell-a',{freeuse:true}),granted('SPELL-child')]}]);
    const gains=levelUpSpellGrants(before,after,byRef);
    expect(gains).toHaveLength(1);
    expect(gains[0]).toMatchObject({spell:{id:'spell-a'},freeUses:1,grant:{source:{originEntityId:'subclass-other'}}});
  });
});
