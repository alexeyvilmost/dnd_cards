import {describe,it,expect} from 'vitest';
import {projectRuntimeCharacter} from '../engine/runtimeCharacterProjection';
import {resolveCharacterRules} from './rules/resolveCharacterRules';
import {buildCharacterContext} from './runtime';
import {emptyDraft} from './types';
import type {AssembledCharacter,OriginEffect} from './assemble';
import type {Card} from '../types';
import type {RuntimeState} from '../mvp/contracts';
const clone=<T,>(v:T):T=>JSON.parse(JSON.stringify(v));
describe('revocable item feat static grants',()=>{
 it.each([{ability:'str',base:19,amount:3,cap:20},{ability:'dex',base:21,amount:2,cap:24}])('recomputes $ability cap and overlapping proficiency after drop, reload and re-equipping',({ability,base,amount,cap})=>{
  const draft={...emptyDraft(),level:5,abilities:{str:10,dex:10,con:10,int:10,wis:10,cha:10,[ability]:base}};
  const effect=(id:string,result:Record<string,unknown>[],bound=false)=>({origin:{kind:'feat',id:'origin-'+id,name:id},effect:{id,name:id,mechanics:{...(bound?{requires_any_item_source:['provider']}:{}),activation:{mode:'passive'},effects:[{resolution:'auto',result}]}}});
  const skill={kind:'grant_proficiency',prof:'skill',value:'perception'};
  const assembled={race:{id:'race',name:'Race',speed:30},klass:{id:'klass',name:'Class',hit_die:'d10'},feats:[],actions:[],spells:[],pendingChoices:[],featAbilityIncreases:[],derived:{},effects:[effect('base',[skill]),effect('item',[{kind:'grant_ability_score',ability,amount,cap},skill,{kind:'grant_expertise',prof:'skill',value:'perception'},{kind:'grant_proficiency',prof:'skill',value:'stealth'}],true)] as unknown as OriginEffect[]} as unknown as AssembledCharacter;
  const rules=resolveCharacterRules({draft,assembled});
  const card={id:'provider',name:'Provider',mechanics:{activation:{mode:'passive',while:'equipped'}}} as unknown as Card;
  const character={...buildCharacterContext(rules,draft,[card]),knownCards:[card]};
  const state:RuntimeState={hp:{current:30,max:30,temp:0},resources:{},maxResources:{},equipment:{main_hand:'provider'},inventory:[],activeEffects:[]};
  const live=projectRuntimeCharacter(character,state);expect(live.abilityScores?.[ability as 'str']).toBe(Math.min(cap,base+amount));expect(live.skillProficiencies).toContain('stealth');expect(live.skillExpertise).toContain('perception');
  state.equipment={};const removed=projectRuntimeCharacter(clone(live),state);expect(removed.abilityScores?.[ability as 'str']).toBe(base);expect(removed.skillProficiencies).toContain('perception');expect(removed.skillProficiencies).not.toContain('stealth');expect(removed.skillExpertise).not.toContain('perception');
  state.equipment={main_hand:'provider'};const restored=projectRuntimeCharacter(clone(removed),state);expect(restored.abilityScores?.[ability as 'str']).toBe(Math.min(cap,base+amount));expect(restored.skillExpertise).toContain('perception');
 });
 it('persists the real ability baseline while applying one captured damage delta on repeated and restored projections',()=>{
  const character={abilityScores:{str:15},abilityMods:{str:2,dex:0,con:0,int:0,wis:0,cha:0},profBonus:2,level:1};
  const state:RuntimeState={hp:{current:10,max:10,temp:0},resources:{},maxResources:{},equipment:{},inventory:[],activeEffects:[{id:'drain',name:'Drain',source:'Shadow',mechanics:{kind:'modifier',op:'add',value:-3,applies_to:{roll:'ability_score',filter:{ability:'str'}}}}]};
  const projected=projectRuntimeCharacter(character,state);expect(projected.abilityScores?.str).toBe(12);
  expect(projectRuntimeCharacter(clone(projected),state).abilityScores?.str).toBe(12);
  state.activeEffects=[];expect(projectRuntimeCharacter(clone(projected),state).abilityScores?.str).toBe(15);
 });
});
