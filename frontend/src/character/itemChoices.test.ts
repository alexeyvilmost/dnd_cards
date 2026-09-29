import {describe,expect,it} from 'vitest';
import {collectRuntimeItemChoices} from './itemChoices';
import {collectItemMechanics} from './attunement';
import {resolveCharacterRules} from './rules/resolveCharacterRules';
import {emptyDraft} from './types';
import type {AssembledCharacter} from './assemble';
import type {Card} from '../types';
import type {RuntimeRuleSource} from './rules/types';
const assembled={race:{id:'race',name:'race',speed:30},klass:null,subclass:null,background:null,feats:[],effects:[],actions:[],spells:[],pendingChoices:[],featAbilityIncreases:[],derived:{}} as unknown as AssembledCharacter;
const cards=[
  {id:'amulet',name:'Amulet',slot:'necklace',mechanics:{activation:{mode:'passive',while:'equipped'},effects:[{resolution:'auto',result:[{kind:'choice',id:'training',prompt:'Weapon',count:1,context:'in_play',options:{source:'weapon'},apply:{kind:'weapon_mastery'}}]}]}},
  {id:'ring',name:'Ring',slot:'ring',mechanics:{activation:{mode:'passive',while:'equipped'},effects:[{resolution:'auto',result:[{kind:'choice',id:'training',prompt:'Ability',count:2,options:{source:'ability',items:['str','dex','con'].map(id=>({id,name:id,grants:[{kind:'grant_ability_score',ability:id,amount:2}]}))}}]}]}},
] as unknown as Card[];
const map=new Map(cards.map(c=>[c.id,c]));
function sources(equipment:Record<string,string|null>):RuntimeRuleSource[]{return collectItemMechanics(equipment,map,{},[]).map(({card,mechanics})=>({source:{type:'item',id:card.id,name:card.name},mechanics}));}
describe('item-owned persistent choices',()=>{
  it('uses the same scoped key for existing picker and authoritative rules, including after reload',()=>{
    const runtimeSources=sources({necklace:'amulet',ring_1:'ring'});
    const choices=collectRuntimeItemChoices(runtimeSources,{});
    expect(choices.map(c=>c.id)).toEqual(['amulet:training','ring:training']);expect(choices.every(c=>c.context==='in_play')).toBe(true);
    expect(choices[0].grantKind).toBe('weapon_mastery');
    const persisted=JSON.parse(JSON.stringify({'amulet:training':['dagger'],'ring:training':['str','dex']}));
    const draft={...emptyDraft(),abilities:{str:10,dex:10,con:10,int:10,wis:10,cha:10},resolvedChoices:persisted};
    const rules=resolveCharacterRules({draft,assembled,runtimeSources});
    expect(rules.weaponMasteries).toContain('dagger');expect(rules.abilities.str).toBe(draft.abilities.str+2);expect(rules.abilities.dex).toBe(draft.abilities.dex+2);
    const unequipped=resolveCharacterRules({draft,assembled,runtimeSources:sources({})});
    expect(unequipped.weaponMasteries).not.toContain('dagger');expect(unequipped.abilities.str).toBe(draft.abilities.str);
    expect(persisted['ring:training']).toEqual(['str','dex']);
  });
  it.each([[['str','dex','con']],[['str','str']],[['str','foreign']]])('rejects saved selections outside current item declaration %j',selection=>{
    const draft={...emptyDraft(),abilities:{str:10,dex:10,con:10,int:10,wis:10,cha:10},resolvedChoices:{'ring:training':selection}};
    expect(resolveCharacterRules({draft,assembled,runtimeSources:sources({ring_1:'ring'})}).abilities).toEqual(draft.abilities);
  });
});
