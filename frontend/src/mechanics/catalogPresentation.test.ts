import {describe,expect,it,vi,afterEach} from 'vitest';
import manifest from '../../../backend/migrations/presentation_catalog_307_manifest.json';
import {collectChoices} from './collectChoices';
import {collectEffectGrantRefs} from '../character/assemble';
import {emptyDraft} from '../character/types';
import {actionUsesKey,bindActionUsesCost} from '../engine/actionUses';
import {getSettings} from '../settings';
import {createPaperSheet} from '../paper-sheet/model';
import {paperIdentityEntries,paperIdentitySourceKey} from '../paper-sheet/identity';

afterEach(()=>vi.unstubAllGlobals());
describe('catalog presentation preserves data-owned choices',()=>{
 it('marks everyday interactions and communication narrative in combat while retaining tactical light and attacks',()=>{
  const actions=new Map(manifest.actions.map(action=>[action.card_number,action.is_narrative]));
  const spells=new Map(manifest.spells.map(spell=>[spell.card_number,spell.is_narrative]));
  for(const slug of ['ACT-item-completion-high-750-dig','ACT-item-completion-high-814-light','ACT-item-completion-high-814-extinguish','ACT-item-completion-high-820-ignite-slow']) expect(actions.get(slug)).toBe(true);
  for(const slug of ['ACT-item-completion-high-823-light','ACT-item-completion-high-773-lightning']) expect(actions.get(slug)).toBe(false);
  for(const slug of ['SPELL-0294','SPELL-0298']) expect(spells.get(slug)).toBe(true);
  expect(spells.get('SPELL-0204')).toBe(false);
 });
 it('keeps meaningful passive features visible even when they are implemented with variables or spell choices',()=>{
  const technical=new Set(manifest.technical_effects.map(effect=>effect.card_number));
  for(const slug of ['EFF-extra-attack','EFF-invoc-thirsting-blade','RE-sub-high_elf','magic_initiate_wizard','magic_initiate_cleric','EFFECT-0006']) expect(technical.has(slug)).toBe(false);
  for(const slug of ['VAR-martial-arts-die-5','VAR-rage-damage-modifier-1','caster-cleric-spells','pf_1']) expect(technical.has(slug)).toBe(true);
 });
 it.each(['EFF-primal-order','EFF-divine-order'])('%s retains selections and nested cantrip keys',slug=>{
  const row=manifest.parents.find(parent=>parent.card_number===slug)!;
  const origin={kind:'class' as const,id:'synthetic-class',name:'Class',featureId:row.id};
  const before=collectChoices(row.before,origin);
  const after=collectChoices(row.after,origin);
  expect(after.map(choice=>choice.id)).toEqual(before.map(choice=>choice.id));
  const choice=before[0];
  for(const item of choice.items!) {
   const resolved={[choice.id]:[item.id]};
   const afterChoices=collectChoices(row.after,origin,resolved);
   expect(afterChoices.map(c=>c.id)).toEqual(collectChoices(row.before,origin,resolved).map(c=>c.id));
   const draft={...emptyDraft(),resolvedChoices:resolved};
   const refs=collectEffectGrantRefs(row.after,row.id,origin,draft);
   expect(refs).toHaveLength(1);
   const entity=manifest.effects.find(effect=>effect.card_number===refs[0])!;
   expect(entity.description.length).toBeGreaterThan(50);
   const previousGrants=item.grants!.filter(grant=>grant.kind!=='choice');
   expect(entity.mechanics.effects[0].result).toEqual(previousGrants);
  }
 });
 it('defers activation variants to the casting dialog but retains ordinary persistent choices',()=>{
  const mechanics={effects:[{kind:'choice',id:'mode',context:'in_play',options:{source:'explicit',items:[{id:'a',name:'A'}]}}]};
  const origin={kind:'other' as const,id:'other-action',name:'Action'};
  expect(collectChoices(mechanics,origin)).toHaveLength(1);
  for(const key of ['action_variant_ids','spell_variant_ids']) expect(collectChoices({...mechanics,[key]:['variant-a','variant-b']},origin)).toEqual([]);
 });
 it('shares one declared pool across all revelation variants and binds their authoritative costs',()=>{
  expect(manifest.action_updates).toHaveLength(3);
  for(const action of manifest.action_updates) {
   const pool=actionUsesKey(action.card_number,action.after);
   expect(pool).toBe('uses_ACT-aasimar-revelation');
   const bound=bindActionUsesCost(action.after,pool);
   expect(bound.activation).toMatchObject({cost:[{resource:'bonus_action'},{resource:pool}]});
  }
 });
 it('hides technical paper features reversibly without dropping the saved entity references',()=>{
  const doc=createPaperSheet();
  doc.identityFeatures={key:paperIdentitySourceKey(doc),abilities:[{type:'effect',id:'service',name:'Service',isTechnical:true},{type:'effect',id:'play',name:'Play'}],traits:[]};
  vi.stubGlobal('localStorage',{getItem:()=>null});
  expect(paperIdentityEntries(doc,'features').map(entity=>entity.id)).toEqual(['play']);
  vi.stubGlobal('localStorage',{getItem:()=>JSON.stringify({hideTechnicalAbilities:false})});
  expect(paperIdentityEntries(doc,'features').map(entity=>entity.id)).toEqual(['service','play']);
  expect(doc.identityFeatures.abilities).toHaveLength(2);
 });
 it('defaults new visibility preferences for legacy settings and preserves explicit values',()=>{
  const defaults={hideNarrativeCombatActions:true,showDetailedPreview:false,hideTechnicalAbilities:true,hideUnavailableActions:true};
  for(const raw of [null,'{}',JSON.stringify({hideUnavailableActions:'false'})]) {
   vi.stubGlobal('localStorage',{getItem:()=>raw});expect(getSettings()).toMatchObject(defaults);
  }
  vi.stubGlobal('localStorage',{getItem:()=>JSON.stringify({hideNarrativeCombatActions:false,showDetailedPreview:true,hideTechnicalAbilities:false,hideUnavailableActions:false})});
  expect(getSettings()).toMatchObject({hideNarrativeCombatActions:false,showDetailedPreview:true,hideTechnicalAbilities:false,hideUnavailableActions:false});
 });
});
