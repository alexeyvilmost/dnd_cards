import {describe,expect,it} from 'vitest';
import type {TriggeringAttackContext} from '../mvp/contracts';
import type {RuleActionDefinition} from './domain';
import {bindTriggeredAttackTargeting} from './triggeredAttackTargeting';

function rider(id:string):RuleActionDefinition {
  return {id,name:id,kind:'nonSpell',sourceEntityIds:[id],
    targeting:{minTargets:1,maxTargets:1,rangeFt:5,requiresLineOfSight:false,allowedRelations:['enemy']},
    mechanics:{activation:{mode:'triggered',trigger:{event:'hit'}},targeting:{range_ft:5,range_from_triggering_attack:true},effects:[]}};
}
const attack=(reach:number):TriggeringAttackContext=>({targetActorId:'target',meleeReachFt:reach,damageType:'slashing',critical:false});

describe('saved triggering-attack targeting',()=>{
  it.each([['different-rider-a',10],['different-rider-b',15]])('binds %s to its captured %ift reach without mutating catalog data',(id,reach)=>{
    const action=rider(id),before=structuredClone(action);
    const result=bindTriggeredAttackTargeting(action,['target'],attack(reach));
    expect(result.issue).toBeUndefined();
    expect(result.action.targeting?.rangeFt).toBe(reach);
    expect(result.action.mechanics.targeting).toMatchObject({range_ft:reach,range_from_triggering_attack:true});
    expect(action).toEqual(before);
  });
  it('rejects a changed target or missing attack reach before any cost is paid',()=>{
    const action=rider('other');
    expect(bindTriggeredAttackTargeting(action,['nearby'],attack(10)).issue).toMatch(/only the creature hit/);
    expect(bindTriggeredAttackTargeting(action,['target'],undefined).issue).toMatch(/captured reach/);
    expect(bindTriggeredAttackTargeting(action,['target'],{...attack(10),meleeReachFt:undefined}).issue).toMatch(/captured reach/);
  });
  it('leaves ordinary targeting untouched',()=>{
    const action=rider('ordinary');delete (action.mechanics.targeting as Record<string,unknown>).range_from_triggering_attack;
    expect(bindTriggeredAttackTargeting(action,['unrelated'],undefined)).toEqual({action});
  });
});
