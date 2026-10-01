import {describe,expect,it} from 'vitest';
import {combatAreaHazardLines,movementHazardAreas,previewMovementHazards} from './movementHazardPreview';
import type {CombatAreaState,SoloCombatState} from './types';
import compiled from '../pages/rulesLabFixture.generated.json';

const area=(id:string,x:number):CombatAreaState=>({id,name:`Область ${id}`,zoneType:'custom',sourceActorId:'environment',sourceActionId:'source',sourceEntityIds:['source'],
  origin:{x,y:0},cells:[{x,y:0}],duration:{type:'permanent'},triggers:['move'],
  hazard:{id:`hazard:${id}`,name:`Опасность ${id}`,sourceKind:'environment',sourceEntityIds:['source'],resolution:'automatic',effects:[{kind:'damage',dice:'1d6',type:'fire'}]}});
const world=(areas:CombatAreaState[]):SoloCombatState=>({characterId:'hero',sideByActorId:{hero:'party'},boardRevision:1,
  tokens:{hero:{actorId:'hero',position:{x:0,y:0},color:'#fff'}},combatAreas:Object.fromEntries(areas.map(row=>[row.id,row])),
  world:{actors:{hero:{...structuredClone(compiled.roots.magicInitiateFighter.actor),id:'hero'}},objects:{},scene:{mode:'encounter',initiative:['hero'],activeIndex:0,round:1}}} as unknown as SoloCombatState);

describe('movement hazard warnings use canonical area declarations',()=>{
  it.each([['a','1d6','fire'],['b','2d8','cold']] as const)('describes %s without an entity name or sprite branch', (id,dice,type)=>{
    const hazard=area(id,1);
    hazard.hazard={...hazard.hazard!,resolution:'automatic',effects:[{kind:'damage',dice,type}]};
    const state=world([hazard]),before=structuredClone(state);
    const warnings=previewMovementHazards(state,'hero',[{x:1,y:0}]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].lines.join(' ')).toContain(dice.replace('d','к'));
    expect(warnings[0].lines.join(' ')).toContain('за каждые 5 фт. движения');
    expect(state).toEqual(before);
    expect(movementHazardAreas(state,'hero').map(row=>row.id)).toEqual([id]);
  });
  it('describes a saving hazard and respects a previously spent entry trigger',()=>{
    const hazard=area('binding',1);
    hazard.triggers=['enter'];
    hazard.hazard={id:'hazard:binding',name:'Связывающая область',sourceKind:'environment',sourceEntityIds:['source'],resolution:'save',
      save:{ability:'dex',dc:14},onFailure:[{kind:'condition',value:'restrained'}]};
    expect(combatAreaHazardLines(hazard).join(' ')).toContain('DEX СЛ 14');
    const state=world([hazard]);
    expect(previewMovementHazards(state,'hero',[{x:1,y:0}])).toHaveLength(1);
    hazard.triggeredTurnKeys=['hero:enter:1:0:hero'];
    expect(previewMovementHazards(state,'hero',[{x:1,y:0}])).toHaveLength(0);
  });
  it('does not flag a start-turn-only hazard as a movement trigger',()=>{
    const hazard=area('turn-only',1);hazard.triggers=['start_turn'];
    const state=world([hazard]);
    expect(previewMovementHazards(state,'hero',[{x:1,y:0}])).toHaveLength(0);
    expect(movementHazardAreas(state,'hero')).toHaveLength(0);
  });
});
