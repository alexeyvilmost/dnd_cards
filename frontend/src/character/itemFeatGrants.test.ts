import {describe,expect,it,vi} from 'vitest';
import type {Card,Action,PassiveEffect,Feat} from '../types';
import type {AssembledCharacter} from './assemble';
import {emptyDraft,type ForgeCharacter} from './types';
import {itemFeatReferences,loadItemFeatAssembly,bindItemFeatSources,withItemFeatAssembly} from './itemFeatGrants';
import {collectItemMechanics} from './attunement';
import {createSheetCombatRuntime} from './sheetCombatRuntimeFactory';
import {auditedRow,featEffects} from '../testing/featAuditFixtures';
import {ownsGeneralFeatCapability} from '../rules-core/generalFeatDamageRuntime';
import {migrateWorldState} from '../rules-core/worldMigration';
import {itemSourceRequirementIssue} from '../engine/actionRequirements';
import {matchesWhen} from '../engine/circumstances';

function fixtures(n:number){
 const feat=auditedRow(`FEAT-${String(n).padStart(4,'0')}`) as Feat;
 const card={id:`item-${n}`,card_number:`ITEM-${n}`,name:'Item feat source',type:'ring',requires_attunement:true,
   mechanics:{activation:{mode:'passive',while:'equipped'},effects:[{resolution:'auto',result:[{kind:'grant_feat',value:feat.id}]}]}} as unknown as Card;
 const base={race:{id:'species',name:'Human',speed:30},klass:null,subclass:null,background:null,feats:[],effects:[],actions:[],spells:[],resources:[],pendingChoices:[],featAbilityIncreases:[],derived:{}} as unknown as AssembledCharacter;
 const loaded={...base,feats:[feat],effects:featEffects(n).map(effect=>({effect:effect as PassiveEffect,origin:{kind:'feat' as const,id:feat.id,name:feat.name}}))};
 const character={id:'hero',name:'Hero',user_id:'qa',access_mode:'owner',system_id:'dnd5e-2024',ruleset_version:'2024',level:5,race_id:'species',
  abilities:{str:15,dex:13,con:12,int:12,wis:12,cha:12},runtime_revision:0,current_hp:10,max_hp:10,
  resources:{action:1,bonus_action:1,reaction:1},max_resources:{action:1,bonus_action:1,reaction:1},active_effects:[],resolved_choices:{},
  equipment:{ring_left:card.id},inventory_items:[],turn_state:{attuned_ids:[card.id]}} as unknown as ForgeCharacter;
 const load=vi.fn(async(draft:ReturnType<typeof emptyDraft>)=>draft.featIds?.includes(feat.id)?loaded:base);
 const factory=createSheetCombatRuntime({loadAssembly:load,cardsApi:{getCard:async()=>card},
  actionsApi:{getAction:async ref=>auditedRow(ref) as Action},effectsApi:{getEffect:async ref=>auditedRow(ref) as PassiveEffect},loadMasteryEffectsStrict:async()=>[]});
 return {feat,card,base,loaded,character,load,factory};
}

describe('item-owned feats use the canonical assembly and current source authority',()=>{
 it.each([[45,'general_feat.sentinel'],[17,'general_feat.mounted_combatant']])('loads feat %i and revokes its capabilities after item loss/reload',async(n,capability)=>{
  const {card,feat,character,load,factory}=fixtures(Number(n));
  const {canonical}=await factory.loadSheetCombatParticipant({character,cards:new Map()});
  expect(load).toHaveBeenCalledTimes(2);
  expect(load.mock.calls[1][0].featIds).toContain(feat.id);
  expect(character.feat_ids??[]).not.toContain(feat.id);
  const world=migrateWorldState(JSON.parse(JSON.stringify(canonical.world)));
  const actor=world.actors.hero;
  expect(actor.capabilities.featureItemSources?.[capability]).toEqual([card.id]);
  expect(ownsGeneralFeatCapability(actor,String(capability))).toBe(true);
  const guarded=actor.passives!.flatMap(m=>(m.effects as Record<string,unknown>[]??[]).flatMap(e=>e.result as Record<string,unknown>[]??[]))
   .find(p=>Array.isArray(p.when));
  expect(guarded).toBeDefined();
  expect(matchesWhen(guarded!.when as Record<string,unknown>[],{state:actor.runtime,character:actor.character})).toBe(true);
  actor.runtime.equipment={};
  actor.runtime.inventory=[{cardId:card.id,qty:1}];
  expect(ownsGeneralFeatCapability(actor,String(capability))).toBe(false);
  expect(matchesWhen(guarded!.when as Record<string,unknown>[],{state:actor.runtime,character:actor.character})).toBe(false);
  actor.runtime.equipment={ring_left:card.id};actor.character.attunedIds=[];
  expect(ownsGeneralFeatCapability(actor,String(capability))).toBe(false);
 });
 it('binds the feat’s granted action to its item, including the canonical action entity',async()=>{
  const {card,character,factory}=fixtures(45);
  const {canonical}=await factory.loadSheetCombatParticipant({character,cards:new Map()});
  const actor=canonical.world.actors.hero;
  const action=actor.capabilities.actionIds.map(id=>canonical.catalog.getAction(id)).find(row=>row?.sourceEntityIds.includes(auditedRow('ACT-general-sentinel-stop').id));
  expect(action).toBeDefined();
  expect(action!.mechanics.requires_any_item_source).toEqual([card.id]);
  expect(itemSourceRequirementIssue(action!.mechanics,actor.runtime,actor.character)).toBeNull();
  actor.runtime.equipment={};
  expect(itemSourceRequirementIssue(action!.mechanics,actor.runtime,actor.character)).not.toBeNull();
 });
 it('does not convert temporary grants into draft picks or replace a native feat',async()=>{
  const {card,feat,base,loaded}=fixtures(45),draft=emptyDraft();
  const items=collectItemMechanics({ring_left:card.id},new Map([[card.id,card]]),{attuned_ids:[card.id]});
  const refs=itemFeatReferences(base,draft,items);
  expect(refs).toEqual([feat.id]);
  const resolver=vi.fn(async()=>loaded);
  await loadItemFeatAssembly(base,draft,refs,resolver);
  expect(draft.featIds).not.toContain(feat.id);
  expect(itemFeatReferences(loaded,draft,items)).toEqual([]);
  expect(bindItemFeatSources(loaded,loaded,draft,items).effects[0].effect.mechanics?.requires_any_item_source).toBeUndefined();
  expect(withItemFeatAssembly(base,{base,key:JSON.stringify(refs),assembly:loaded},[])).toBe(base);
  expect(withItemFeatAssembly({...base},{base,key:JSON.stringify(refs),assembly:loaded},refs)).not.toBe(loaded);
 });
});
