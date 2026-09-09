import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {assemble, multiclassSpellSlotCounts, type EntityBundle} from './assemble';
import {emptyDraft} from './types';
import {resolveCharacterRules} from './rules/resolveCharacterRules';
import {buildCharacterContext} from './runtime';
import {syncRuntimeResources} from './resourceInit';
import {materializeMicroMvpL1ContentPatch} from '../canon/declarativeMechanicsPatch';
import {readProdSnapshotCatalogs} from '../canon/prodSnapshotL1Fixtures';
import type {CharacterClass, PassiveEffect} from '../types';

const catalogs=materializeMicroMvpL1ContentPatch(readProdSnapshotCatalogs()).catalogs;
const migration=readFileSync(new URL('../../../backend/migrations/eldritch_knight_casting_236.go',import.meta.url),'utf8');
const mechanics=JSON.parse(migration.match(/const eldritchKnightCasting236 = `([^`]+)`/)![1]);
const fighter={id:'fighter',card_number:'CLASS-warrior',name:'Воин',hit_die:'d10',resources:{}} as unknown as CharacterClass;
const subclass={id:'ek',card_number:'fighter_eldritch_knight',name:'Мистический рыцарь',is_subclass:true,parent_class_id:fighter.id,resources:{spell_slot_1:{by_level:{3:2,4:3},level_source:'warrior',per:'long_rest',multiclass_divisor:3}}} as unknown as CharacterClass;
const effect={id:'0dd9473b-6b99-47cc-a1b3-890238a30ada',card_number:'EFFECT-0047',name:'Сотворение заклинаний',mechanics} as unknown as PassiveEffect;

describe('Eldritch Knight casting through level five',()=>{
 it.each([[3,0,3,2],[4,0,4,3],[5,0,4,3],[3,2,3,2]])('Fighter %i + other %i prepares %i spells with %i slots', (level,otherLevel,preparedCount,slots)=>{
  const draft={...emptyDraft(),classId:fighter.id,subclassId:subclass.id,subclassIds:{[fighter.id]:subclass.id},level:level+otherLevel,classLevels:{[fighter.id]:level,...(otherLevel?{other:otherLevel}:{})},abilities:{str:16,dex:12,con:14,int:18,wis:8,cha:10}};
  const other={id:'other',card_number:'CLASS-rogue',name:'Плут',hit_die:'d8',resources:{}} as unknown as CharacterClass;
  const bundle:EntityBundle={race:null,klass:{...fighter,resources:subclass.resources},classes:otherLevel?[fighter,other]:[fighter],subclass,subclasses:[subclass],subclassOwnerClassIds:{[subclass.id]:fighter.id},background:null,feats:[],effects:[{effect,origin:{kind:'class',id:subclass.id,name:subclass.name}}],actions:[],spells:[]};
  const initial=assemble(bundle,draft);const cantrips=initial.pendingChoices.find(choice=>choice.rawId==='ek_cantrips')!;const prepared=initial.pendingChoices.find(choice=>choice.rawId==='ek_spells_l1')!;
  expect(cantrips.count).toBe(2);expect(prepared.count).toBe(preparedCount);
  const wizardSpells=catalogs.spells.filter(spell=>spell.classes?.includes('волшебник'));
  const selectedCantrips=wizardSpells.filter(spell=>spell.level===0).slice(0,2);const selectedSpells=wizardSpells.filter(spell=>spell.level===1).slice(0,preparedCount);
  expect(selectedSpells.length).toBe(preparedCount);expect(selectedCantrips.length).toBe(2);
  draft.resolvedChoices={[cantrips.id]:selectedCantrips.map(spell=>spell.id),[prepared.id]:selectedSpells.map(spell=>spell.id)};
  const assembled=assemble({...bundle,spells:[...selectedCantrips,...selectedSpells]},draft);const rules=resolveCharacterRules({draft,assembled});
  expect(rules.spellcasting).toMatchObject({ability:'int'});
  const context=buildCharacterContext(rules,{level:draft.level,abilities:draft.abilities},[],fighter);
  expect(context.spellcastingAbility).toBe('int');
  const resources=syncRuntimeResources(context,assembled);
  expect(resources.maxResources.spell_slot_1).toBe(slots);
 });
});


it('uses the subclass table alone and rounds down third-caster levels only when combining casters',()=>{
 const wizard={id:'wizard',card_number:'CLASS-wizard'} as CharacterClass;
 const rogue={id:'rogue',card_number:'CLASS-rogue'} as CharacterClass;
 expect(multiclassSpellSlotCounts([fighter],{fighter:3},[subclass])).toEqual([2]);
 expect(multiclassSpellSlotCounts([fighter],{fighter:4},[subclass])).toEqual([3]);
 expect(multiclassSpellSlotCounts([fighter,rogue],{fighter:4,rogue:3},[subclass])).toEqual([3]);
 expect(multiclassSpellSlotCounts([fighter,wizard],{fighter:5,wizard:2},[subclass])).toEqual([4,2]);
 expect(multiclassSpellSlotCounts([fighter,wizard],{fighter:2,wizard:2},[subclass])).toEqual([3]);
 expect(multiclassSpellSlotCounts([fighter],{fighter:5})).toEqual([]);
});
