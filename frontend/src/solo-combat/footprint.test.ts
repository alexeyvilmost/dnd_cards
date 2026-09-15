import {describe,it,expect} from 'vitest';
import compiled from '../pages/rulesLabFixture.generated.json';
import type {ActorState} from '../rules-core/domain';
import {spatialFacts, type SoloCombatState} from './types';
import {actorFootprint, footprintDistanceFt} from './footprint';
import {canOccupyPosition,occupiedPositions,reachableRoutes,areaActorIds,pushAway} from './tacticalGrid';
import {combatApproachRoute} from './defaultInteraction';
import {areaContains,enteredAndExitedAreas,movementCostThroughAreas} from './combatAreas';

function battlefield(size: number): SoloCombatState {
  const base=structuredClone(compiled.roots.magicInitiateFighter.actor) as unknown as ActorState;
  const hero={...base,id:'hero',character:{...base.character,baseSize:size}};
  const enemy={...base,id:'enemy',character:{...base.character,baseSize:2}};
  return {tacticalFootprints:'sized',world:{actors:{hero,enemy},objects:{}},tokens:{
    hero:{actorId:'hero',position:{x:0,y:0}},enemy:{actorId:'enemy',position:{x:5,y:1}},
  },sideByActorId:{hero:'party',enemy:'enemy'},movementRemainingFt:{hero:30},combatAreas:{},boardRevision:0} as unknown as SoloCombatState;
}
describe('full tactical footprints',()=>{
  it('preserves the archived one-cell geometry without changing saved actors',()=>{
    const state=battlefield(4);delete state.tacticalFootprints;
    expect(actorFootprint(state.world.actors.hero,state)).toBe(1);
    expect(occupiedPositions(state,'enemy').size).toBe(1);
    expect(spatialFacts(state,'hero','enemy').distanceFt).toBe(25);
    expect(state.world.actors.hero.character.baseSize).toBe(4);
  });
  it.each([[3,2],[4,3]])('size %i occupies %i squared cells in every spatial projection',(size,side)=>{
    const state=battlefield(size);
    expect(actorFootprint(state.world.actors.hero)).toBe(side);
    expect(occupiedPositions(state,'enemy').size).toBe(side*side);
    expect(canOccupyPosition(state,'enemy',{x:side-1,y:side-1})).toBe(false);
    expect(canOccupyPosition(state,'hero',{x:4,y:0})).toBe(false);
    expect(canOccupyPosition(state,'hero',{x:11,y:9})).toBe(false);
    const routes=reachableRoutes(state,'hero',60);
    expect(routes.every(route=>route.path.every(p=>canOccupyPosition(state,'hero',p)))).toBe(true);
    expect(spatialFacts(state,'hero','enemy').distanceFt).toBe((6-side)*5);
    const approach=combatApproachRoute(state,'hero','enemy',5)!;
    expect(footprintDistanceFt(approach.destination,state.tokens.enemy.position,side)).toBe(5);
    expect(approach.costFt).toBe((5-side)*5);
    const action={mechanics:{targeting:{shape:'area',area:{kind:'cube',size_ft:5}}},targeting:{rangeFt:60,allowedRelations:['enemy']}};
    expect(areaActorIds({state,sourceActorId:'enemy',aimPosition:{x:side-1,y:side-1},action})).toEqual(['hero']);
    expect(pushAway({source:{x:0,y:0},target:{x:7,y:0},targetSize:side,distanceFt:60}).x).toBe(12-side);
  });
  it('uses the footprint edge for zone entry and difficult terrain, not only the anchor',()=>{
    const state=battlefield(4);
    const area={id:'mud',cells:[{x:3,y:2}],difficultTerrain:true};
    state.combatAreas={mud:area} as unknown as SoloCombatState['combatAreas'];
    expect(areaContains(state.combatAreas!.mud,{x:1,y:0},3)).toBe(true);
    expect(movementCostThroughAreas(state,{x:0,y:0},{x:1,y:0},5,'hero')).toBe(10);
    expect(reachableRoutes(state,'hero',5).some(r=>r.destination.x===1&&r.destination.y===0)).toBe(false);
    expect(enteredAndExitedAreas(state,{x:0,y:0},{x:1,y:0},'hero').entered).toEqual(['mud']);
  });
});
