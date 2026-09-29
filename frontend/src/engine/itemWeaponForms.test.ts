import {describe,it,expect} from 'vitest';
import items from '../../../scripts/content/data/item-completion-high-20260929.json';
import related from '../../../scripts/content/data/item-completion-high-related-20260929.json';
import {executeAction} from './execute';
import {projectRuntimeCharacter} from './runtimeCharacterProjection';
import {weaponContext} from './weapon';
import type {CharacterContext,RuntimeState} from '../mvp/contracts';
import type {Card} from '../types';

const source=items['CARD-0853'];
const forms=related.entities.filter(row=>row.card_number?.startsWith('ACT-item-completion-high-853-form-'));
type FormPayload={item_id:string;profile:{enchantment:{attack_bonus:number;damage_bonus:number;extra_damage_lines:unknown[]};mastery_effect_id:string}};
const payload=(entry:(typeof forms)[number]):FormPayload=>(entry.patch.mechanics as unknown as {effects:{result:FormPayload[]}[]}).effects[0].result[0];
const card={id:payload(forms[0]).item_id,name:'Sphere',type:'weapon',mechanics:source.mechanics} as unknown as Card;
const form=(type:string)=>forms.find(row=>row.card_number?.endsWith(`-${type}`))!.patch.mechanics;
function setup():{state:RuntimeState;character:CharacterContext}{
 const owner={...card};
 return {state:{hp:{current:20,max:20,temp:0},resources:{},maxResources:{},inventory:[{cardId:owner.id,qty:1}],equipment:{},activeEffects:[]},
  character:{abilityMods:{str:3,dex:2,con:0,int:0,wis:0,cha:0},profBonus:2,level:5,knownCards:[owner],attunedIds:[owner.id]}};
}
describe('a shapechanging item projects catalog profiles onto one physical instance',()=>{
 it('offers each base type exactly once with a +2 property and its mastery identity',()=>{
  expect(forms.length).toBeGreaterThan(30);
  expect(new Set(forms.map(row=>row.card_number))).toHaveProperty('size',forms.length);
  for(const row of forms){
   const result=payload(row);
   expect(result.item_id).toBe(card.id);
   expect(result.profile.enchantment).toMatchObject({attack_bonus:2,damage_bonus:2,extra_damage_lines:[]});
   expect(result.profile.mastery_effect_id).toBeTruthy();
  }
 });
 it('changes one carried sphere between two distinct forms and restores its base after effect loss',()=>{
  const {state,character}=setup();
  const actualId=character.knownCards![0].id;
  expect(state.inventory).toContainEqual({cardId:payload(forms.find(row=>row.card_number?.endsWith('-longsword'))!).item_id,qty:1});
  const use=(base:RuntimeState,type:string)=>executeAction(base,{...form(type),requires_item_source:actualId},
   {character,selfId:'hero',rng:()=>{throw Error('No RNG');},nextId:()=>`form:${type}`});
  const long=use(state,'longsword').state;
  expect(long.inventory).toContainEqual({cardId:actualId,qty:1});
  const projected=projectRuntimeCharacter(character,long);
  expect(projected.knownCards![0].mechanics?.weapon_profile).toMatchObject({weapon_type:'longsword',enchantment:{attack_bonus:2,damage_bonus:2}});
  expect(projected.knownCards![0].mechanics?.weapon_mastery_granted).toBe(true);
  expect(()=>use(long,'greatsword')).toThrow(/один раз/);
  const next={...long,firedThisTurn:[],equipment:{main_hand:actualId}};
  const two=use(next,'greatsword').state;
  expect(two.equipment).toMatchObject({main_hand:actualId,off_hand:actualId});
  const reloaded=JSON.parse(JSON.stringify(two)) as RuntimeState;
  const transformed=projectRuntimeCharacter(character,reloaded);
  expect(weaponContext(transformed,'main',reloaded.equipment,reloaded)).toMatchObject({weaponType:'greatsword',attackEnchant:2,damageEnchant:2,masteryGranted:true});
  const removed={...reloaded,activeEffects:[]};
  expect(projectRuntimeCharacter(character,removed).knownCards![0].mechanics?.weapon_profile).toBeUndefined();
 });
});
