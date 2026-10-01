import {describe,expect,it} from 'vitest';
import {actionUsesKey} from './actionUses';
import {projectRuleAction} from '../canon/ruleActionProjection';
import {collectActionUsesPools,collectActionUsesRecovery} from '../character/actionSheet';
import {syncRuntimeResources} from '../character/resourceInit';
import {FIGHTER_CTX} from '../mvp/fixtures';
import type {AssembledCharacter} from '../character/assemble';
import type {Action} from '../types';
import {pay} from './cost';
import type {RuntimeState} from '../mvp/contracts';
function action(id:string,pool:string):Action{return {id,card_number:id,name:id,mechanics:{activation:{mode:'reaction',cost:[{resource:'self_uses'}]},
  targeting:{shape:'self',domain:'actor',range_ft:0,min_targets:0,max_targets:1,actor_targets:false,allowed_relations:['self'],requires_line_of_sight:false},effects:[],
  uses:{count:6,per:'day',pool,recovery:{short_rest:{mode:'none'},long_rest:{mode:'dice',dice:'1d6'}}}}} as unknown as Action;}
describe('shared data-owned action uses',()=>{
  it.each(['evasion-cloak','protective-boon'])('shares one bounded %s pool between distinct abilities',pool=>{
    const first=action('dodge',pool),second=action('evade',pool),assembled={actions:[],effects:[]} as unknown as AssembledCharacter;
    const grants=[first,second].map(a=>({action:a,sourceLabel:pool,group:'item' as const}));
    const pools=collectActionUsesPools(assembled,[],grants),key=actionUsesKey(first.id,first.mechanics);
    expect(pools).toHaveLength(1);expect(pools[0]).toMatchObject({key,count:6});
    expect(collectActionUsesRecovery(assembled,[],grants)[key]?.long_rest).toEqual({mode:'dice',dice:'1d6'});
    const projected=[first,second].map(a=>projectRuleAction(a).mechanics.activation as {cost:Record<string,unknown>[]});
    expect(projected.map(a=>a.cost[0].resource)).toEqual([key,key]);
    let state={resources:{[key]:6},maxResources:{[key]:6},inventory:[],equipment:{},hp:{current:10,max:10,temp:0},activeEffects:[]} as RuntimeState;
    state=pay(state,projected[0].cost).state;state=JSON.parse(JSON.stringify(state));state=pay(state,projected[1].cost).state;
    expect(state.resources[key]).toBe(4);
  });
  it('rejects malformed shared identities and preserves ordinary action identities',()=>{
    expect(()=>actionUsesKey('normal',{uses:{count:1,pool:''}})).toThrow();
    expect(actionUsesKey('normal',{uses:{count:1}})).toBe('uses_normal');
  });
  it.each(['guarding-capability','healing-capability'])('uses the authored %s resource across projection, reload and payment',id=>{
    const entity=action(`renamed-${id}`,'old-pool');
    const key=`uses_${id}`;
    (entity.mechanics!.uses as Record<string,unknown>).resource_id=key;
    const assembled={actions:[],effects:[],spells:[]} as unknown as AssembledCharacter;
    const grants=[{action:entity,sourceLabel:'Data owner',group:'class' as const}];
    const before={resources:{[key]:2},maxResources:{[key]:6},inventory:[],equipment:{},
      hp:{current:10,max:10,temp:0},activeEffects:[]} as RuntimeState;
    const synced=syncRuntimeResources(FIGHTER_CTX,assembled,JSON.parse(JSON.stringify(before)),[],[],grants);
    const projected=projectRuleAction(entity),cost=(projected.mechanics.activation as {cost:Record<string,unknown>[]}).cost;
    expect(cost[0].resource).toBe(key);
    expect(synced.resources[key]).toBe(2);
    expect(synced.maxResources[key]).toBe(6);
    expect(synced.maxResources).not.toHaveProperty(`uses_${entity.card_number}`);
    expect(pay({...before,...synced},cost).state.resources[key]).toBe(1);
    expect(collectActionUsesRecovery(assembled,[],grants)[key]?.long_rest).toEqual({mode:'dice',dice:'1d6'});
  });
  it.each(['', 'unregistered ref', 'x'.repeat(101), 17])('rejects invalid explicitly authored resource %s',resource_id=>{
    expect(()=>actionUsesKey('legacy',{uses:{count:2,resource_id}})).toThrow('Invalid declared');
  });
});
