import { describe, expect, it } from 'vitest';
import type { RuleActionDefinition } from '../rules-core/domain';
import type { SheetCanonicalRuntime } from './sheetCanonicalWorld';
import { collectSheetSpellCastOptions } from './sheetSpellCastingUi';

function spell(id:string,level:number,parentId?:string):RuleActionDefinition {
  return {id,name:id,kind:'spell',sourceEntityIds:[id],spell:{level},
    mechanics:parentId?{variant_of_spell_id:parentId}:{effects:[]},
    targeting:{minTargets:0,maxTargets:0,rangeFt:0,requiresLineOfSight:false,allowedRelations:['self']}};
}

function runtime(actionId:string,level:number,slots:Record<string,number>):SheetCanonicalRuntime {
  return {actorId:'hero',world:{actors:{hero:{
    runtime:{hp:{current:10,max:10,temp:0},resources:slots,maxResources:slots,inventory:[],equipment:{},activeEffects:[]},
    spellcastingAccess:{grants:[{grantId:'owned',actionId,sourceId:'class:wizard',access:'known',level,slotResource:`spell_slot_${level}`}],preparedSources:{}},
    passives:[],character:{level:5,profBonus:3,abilityMods:{str:0,dex:0,con:0,int:0,wis:0,cha:0}},
  }}}} as unknown as SheetCanonicalRuntime;
}

describe('sheet cast options keep level choice before a spell variant',()=>{
  it.each([
    {parent:'parent-one',child:'child-one',base:1,slots:{spell_slot_1:0,spell_slot_2:1,spell_slot_3:1},levels:[2,3]},
    {parent:'parent-two',child:'child-two',base:2,slots:{spell_slot_2:0,spell_slot_3:1},levels:[3]},
  ])('offers every payable upcast of $child through its parent grant',({parent,child,base,slots,levels})=>{
    const options=collectSheetSpellCastOptions({runtime:runtime(parent,base,slots as Record<string,number>),action:spell(child,base,parent)});
    expect(options.map(option=>option.declaration.castLevel)).toEqual(levels);
    expect(options.map(option=>option.declaration.grantId)).toEqual(levels.map(()=> 'owned'));
    expect(collectSheetSpellCastOptions({runtime:runtime(child,base,slots as Record<string,number>),action:spell(child,base,parent)})).toEqual([]);
  });
});
