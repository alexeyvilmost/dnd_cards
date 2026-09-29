import {describe,expect,it} from 'vitest';
import patches from '../../../scripts/content/data/multitarget-spells-280.json';
import {compileMechanicsTargeting,targetSlotBounds} from './actionTargeting';
import type {JsonObject,RuleActionDefinition} from './domain';
import {validateMechanics} from '../engine/validateMechanics';

describe('guarded 280 multi-target spell data',()=>{
  it('keeps every reviewed patch executable as a spell targeting declaration',()=>{
    expect(patches).toHaveLength(21);
    for(const row of patches){
      const mechanics=row.patch.mechanics as JsonObject;
      const validation=validateMechanics(mechanics,{id:row.id,name:row.name,kind:'spell'});
      expect(validation.valid,`${row.card_number}: ${validation.errors.join('; ')}`).toBe(true);
      expect(()=>compileMechanicsTargeting(mechanics),row.card_number).not.toThrow();
    }
  });

  it('declares separate constant-damage Eldritch Blast beams at character-level thresholds',()=>{
    const row=patches.find(entry=>entry.card_number==='SPELL-0226');
    expect(row).toBeDefined();
    const mechanics=row!.patch.mechanics as JsonObject;
    const action:RuleActionDefinition={id:row!.id,name:row!.name,kind:'spell',sourceEntityIds:[row!.id],
      spell:{level:0},mechanics,targeting:compileMechanicsTargeting(mechanics)};
    expect([1,5,11,17].map(level=>targetSlotBounds(action,undefined,level).maxTargets))
      .toEqual([1,2,3,4]);
    expect(action.targeting).toMatchObject({allowRepeatTargets:true});
    const effect=(mechanics.effects as JsonObject[])[0];
    expect((effect.on_hit as JsonObject[])[0]).toMatchObject({dice:'1d10',type:'force'});
    expect((effect.on_hit as JsonObject[])[0]).not.toHaveProperty('scaling');
  });

  it('declares separate 2d6 Scorching Ray attacks, with one more ray per higher slot',()=>{
    const row=patches.find(entry=>entry.card_number==='SPELL-0255');
    expect(row).toBeDefined();
    const mechanics=row!.patch.mechanics as JsonObject;
    const action:RuleActionDefinition={id:row!.id,name:row!.name,kind:'spell',sourceEntityIds:[row!.id],
      spell:{level:2},mechanics,targeting:compileMechanicsTargeting(mechanics)};
    expect(targetSlotBounds(action,2)).toEqual({minTargets:3,maxTargets:3});
    expect(targetSlotBounds(action,4)).toEqual({minTargets:5,maxTargets:5});
    const effect=(mechanics.effects as JsonObject[])[0];
    expect((effect.on_hit as JsonObject[])[0]).toMatchObject({dice:'2d6',type:'fire'});
    expect((effect.on_hit as JsonObject[])[0]).not.toHaveProperty('scaling');
  });
});
