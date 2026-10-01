import {describe,expect,it} from 'vitest';
import manifest from '../../../scripts/content/data/spell-grant-abilities-20261001.json';
import publicSpells from './__fixtures__/repaired-subclass-spells-20261001.json';
import {resolveSpellAccess} from '../rules-core/spellcastingAccess';
import type {CharacterClass,PassiveEffect,Spell} from '../types';
import {assemble} from './assemble';
import {resolveCharacterRules} from './rules/resolveCharacterRules';
import {buildCharacterContext} from './runtime';
import {syncRuntimeResources} from './resourceInit';
import {collectSheetActions} from './actionSheet';
import {buildSheetCanonicalRuntime} from './sheetCanonicalWorld';
import {emptyDraft} from './types';
import type {RuntimeState} from '../mvp/contracts';

const catalogSpells=publicSpells as unknown as Spell[];

describe('reviewed subclass grants compile into authoritative spell access',()=>{
 it.each([
  {card:'EFFECT-0165',ability:'cha',classCard:'CLASS-paladin',expectedCount:2},
  {card:'EFFECT-0110',ability:'wis',classCard:'CLASS-cleric',expectedCount:4},
 ])('$card uses its own declared ability even when primary caster metadata differs',({card,ability,classCard,expectedCount})=>{
  const row=manifest.entities.find(row=>row.card_number===card)!;
  const klass={id:'parent',card_number:classCard,name:'Renamed parent',description:'Data-driven test parent',rarity:'common',created_at:'',updated_at:'',hit_die:'d8',resources:{spell_slot_1:{count:4,per:'long_rest'},spell_slot_2:{count:2,per:'long_rest'}}} as CharacterClass;
  const draft={...emptyDraft(),classId:klass.id,classLevels:{[klass.id]:3},level:3,abilities:{str:10,dex:10,con:12,int:18,wis:16,cha:14}};
  const primary={id:'primary-caster',card_number:'EFF-primary',name:'Primary caster',mechanics:{effects:[{resolution:'auto',result:[{kind:'spellcasting_ability',role:'primary',ability:'int'}]}]}} as unknown as PassiveEffect;
  const effect={id:row.id,card_number:row.card_number,name:row.name,mechanics:row.mechanics} as unknown as PassiveEffect;
  const effects=[{effect:primary,origin:{kind:'class' as const,id:klass.id,name:klass.name,owningClassLevel:3}},
   {effect,origin:{kind:'class' as const,id:'subclass',name:'Renamed subclass',owningClassLevel:3}}];
  const base={race:null,klass,background:null,feats:[],actions:[],effects,spells:[] as Spell[]};
  const initial=assemble(base,draft),initialRules=resolveCharacterRules({draft,assembled:initial});
  const refs=initialRules.appliedGrants.filter(grant=>grant.kind==='spell').map(grant=>grant.value);
  const spells=refs.map(ref=>catalogSpells.find(spell=>spell.id===ref||spell.card_number===ref)!);
  expect(spells).toHaveLength(expectedCount);expect(spells.every(Boolean)).toBe(true);
  const assembled=assemble({...base,spells},draft),ruleState=resolveCharacterRules({draft,assembled});
  const characterContext=buildCharacterContext(ruleState,draft,[],klass);
  const resources=syncRuntimeResources(characterContext,assembled,undefined,ruleState.freeuseSpells);
  const runtime:RuntimeState={hp:{current:ruleState.maxHP,max:ruleState.maxHP,temp:0},...resources,equipment:{},inventory:[],activeEffects:[],firedThisTurn:[],firedThisRest:[]};
  const canonical=buildSheetCanonicalRuntime({character:{id:'test-actor',name:'Renamed hero',system_id:'dnd5e-2024',ruleset_version:'2024',resolved_choices:{},turn_state:null},
   assembled,ruleState,characterContext,runtime,sheetActions:collectSheetActions(assembled),ac:ruleState.armorClass,spellVariants:catalogSpells.filter(spell=>!!spell.mechanics?.variant_of_spell_id)});
  const access=canonical.world.actors[canonical.actorId].spellcastingAccess!;
  expect(access.grants.length).toBeGreaterThanOrEqual(expectedCount);
  for(const grant of access.grants){
   expect(grant.spellcastingAbility).toBe(ability);expect(grant.access).toBe('always_prepared');
   expect(resolveSpellAccess({state:access,actionId:grant.actionId,grantId:grant.grantId,resources:runtime.resources}).status).toBe('allowed');
  }
  expect(ruleState.spellcasting?.ability).toBe('int');
 });
});
