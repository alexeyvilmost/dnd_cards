import {describe, expect, it, vi} from 'vitest';
import compiled from '../pages/rulesLabFixture.generated.json';
import {commandCombatInteraction} from './combatInteraction';
import type {RoguelikeRun} from './api';
import type {RoguelikeCombatIntent} from './combatWorker';

function run() {
  const actor=structuredClone(compiled.roots.magicInitiateFighter.actor);
  return {id:'run', revision:7, combat_state:{characterId:'hero', outcome:'active',
    world:{actors:{hero:{...actor,id:'hero'},enemy:{...actor,id:'enemy'}}},
    tokens:{hero:{position:{x:1,y:3}},enemy:{position:{x:5,y:3}}},
    combatAreas:{}, movementRemainingFt:{hero:30},
    catalogActions:[{id:'attack',mechanics:{primitive:{type:'weapon_attack'}},targeting:{rangeFt:5}}],
  }} as unknown as RoguelikeRun;
}
const attack = {type:'approach_action',actorId:'hero',actionId:'attack',targetActorId:'enemy',choices:{mastery:['apply']}} as const;
function sender() {
  return vi.fn(async (value:RoguelikeRun, intent:RoguelikeCombatIntent) => {
    const next=structuredClone(value); next.revision++;
    if(intent.type==='move') next.combat_state!.tokens.hero.position=intent.destination;
    return next;
  });
}
describe('pinned combat transport compatibility',()=>{
  it('uses the original action command for an adjacent hostile click',async()=>{
    const value=run(); value.combat_state!.tokens.enemy.position={x:2,y:3}; const send=sender();
    await commandCombatInteraction(value,attack,send);
    expect(send).toHaveBeenCalledExactlyOnceWith(value,{type:'action',actorId:'hero',actionId:'attack',targetIds:['enemy'],choices:attack.choices});
  });
  it('follows the preview through adjacent moves with fresh revisions, then attacks once',async()=>{
    const send=sender(); const result=await commandCombatInteraction(run(),attack,send);
    expect(send.mock.calls.map(([r])=>r.revision)).toEqual([7,8,9,10]);
    expect(send.mock.calls.map(([,i])=>i.type)).toEqual(['move','move','move','action']);
    expect(send.mock.calls.slice(0,3).map(([,i])=>(i as {destination:unknown}).destination))
      .toEqual([{x:2,y:3},{x:3,y:3},{x:4,y:3}]);
    expect(result.revision).toBe(11);
  });
  it('stops at a reaction without silently attacking or continuing movement',async()=>{
    const send=sender(); send.mockImplementationOnce(async(r,i)=>{
      const next=await sender()(r,i); next.combat_state!.pendingD20Interrupt={} as never; return next;
    });
    const result=await commandCombatInteraction(run(),attack,send);
    expect(send).toHaveBeenCalledTimes(1); expect(result.combat_state!.pendingD20Interrupt).toBeTruthy();
  });
  it('does not move or spend an action if the entire route is unaffordable',async()=>{
    const value=run(); value.combat_state!.movementRemainingFt.hero=5; const send=sender();
    await expect(commandCombatInteraction(value,attack,send)).rejects.toThrow('доступно 5');
    expect(send).not.toHaveBeenCalled();
  });
  it('never retries a lost attack response after confirmed movement',async()=>{
    const send=sender(); send.mockImplementation(async(r,i)=>{
      if(i.type==='action') throw Error('network'); return sender()(r,i);
    });
    await expect(commandCombatInteraction(run(),attack,send)).rejects.toThrow('Перемещение сохранено');
    expect(send.mock.calls.filter(([,i])=>i.type==='action')).toHaveLength(1);
  });
});
