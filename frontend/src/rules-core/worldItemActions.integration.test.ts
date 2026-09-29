import {describe,expect,it} from 'vitest';
import {createWorld,type ActorState,type GameCommand,type RuleActionDefinition} from './domain';
import {handleCommand} from './handler';
import {migrateWorldState} from './worldMigration';
import {advanceWorldObjectRounds} from './worldObjects';
import {collectItemMechanics} from '../character/attunement';
import {collectGrantActionSlugs} from '../character/actionSheet';
import type {Card} from '../types';
const ruleset={systemId:'dnd5e-2024' as const,releaseId:'item-world',contentHash:'item-world',errataVersion:'2024'};
describe('concrete item instances retain canonical actions',()=>{
  it.each([['candle',0,5,600],['torch',20,20,120]] as const)('keeps %s fuel and capabilities through extinction, reload and relighting without extra stock', (id,bright,dim,duration)=>{
    const card={id,name:id,mechanics:{activation:{mode:'passive',while:'carried'},effects:[]}} as unknown as Card;
    const hero:ActorState={id:'hero',name:'Hero',kind:'playerCharacter',controllerId:'hero',ac:10,capabilities:{actionIds:['ignite','off']},
      character:{abilityMods:{str:0,dex:0,con:0,int:0,wis:0,cha:0},level:1,profBonus:2,knownCards:[card]},
      runtime:{hp:{current:10,max:10,temp:0},resources:{action:8},maxResources:{action:8},activeEffects:[],equipment:{},inventory:[{cardId:id,qty:1}]}};
    const action=(mode:'ignite'|'extinguish'):RuleActionDefinition=>({id:mode==='ignite'?'ignite':'off',name:mode,kind:'nonSpell',sourceEntityIds:[mode==='ignite'?'ignite':'off'],
      mechanics:{requires_item_source:id,activation:{mode:'active',cost:[{resource:'action',amount:1},...(mode==='ignite'?[{resource:'item',card_id:id,amount:1}]:[])]},
        primitive:{type:'item_light',policy:{item_card_id:id,bright_radius_ft:bright,dim_additional_radius_ft:dim,duration_rounds:duration,consumes_source:true,granted_action_refs:['ignite','off'],mode}},effects:[]}});
    const actions=[action('ignite'),action('extinguish')],catalog={getAction:(key:string)=>actions.find(row=>row.id===key)},env={rng:()=>{throw Error('Unexpected RNG');},nextId:()=>'',clock:()=>1};
    let world=createWorld({id:'lights',ruleset,actors:[hero]});
    const use=(key:string,commandId:string):GameCommand=>({schemaVersion:1,type:'UseAction',commandId,actorId:'hero',expectedRevision:world.revision,rulesetContentHash:ruleset.contentHash,actionId:key,targetIds:[]});
    const first=handleCommand(world,use('ignite','start'),catalog,env);if(first.status!=='accepted')throw Error(first.message);world=first.nextState;
    expect(world.actors.hero.runtime.inventory.find(row=>row.cardId===id)?.qty??0).toBe(0);
    world.objects=advanceWorldObjectRounds({objects:world.objects,rounds:30}).objects;
    const objectId=Object.keys(world.objects)[0];
    world.actors.hero.capabilities.actionIds=[];
    const grants=collectItemMechanics({},new Map(),{canonical_rules_world_v1:{primaryActorId:'hero',world}},[]).flatMap(row=>collectGrantActionSlugs(row.mechanics,1));
    expect(grants.sort()).toEqual(['ignite','off']);
    const off=handleCommand(world,use('off','off'),catalog,env);if(off.status!=='accepted')throw Error(off.message);world=migrateWorldState(JSON.parse(JSON.stringify(off.nextState)));
    expect(world.objects[objectId].illumination).toBeUndefined();expect(world.objects[objectId].fuelRoundsLeft).toBe(duration-30);
    world.objects=advanceWorldObjectRounds({objects:world.objects,rounds:999}).objects;
    const relightCommand=use('ignite','again'),relight=handleCommand(world,relightCommand,catalog,env);if(relight.status!=='accepted')throw Error(relight.message);world=relight.nextState;
    expect(world.objects[objectId].illumination?.roundsLeft).toBe(duration-30);
    expect(handleCommand(world,relightCommand,catalog,env).status).toBe('rejected');
    world.objects=advanceWorldObjectRounds({objects:world.objects,rounds:duration}).objects;
    expect(world.objects[objectId].fuelRoundsLeft).toBe(0);
    expect(handleCommand(world,use('ignite','spent'),catalog,env).status).toBe('rejected');
    world.objects[objectId].carriedByActorId='other';
    expect(handleCommand(world,use('off','foreign'),catalog,env).status).toBe('rejected');
  });
  it('grants only declared owner actions from an absent bonded item, and revokes on ownership transfer',()=>{
    const action:RuleActionDefinition={id:'recall',kind:'nonSpell',name:'Recall',sourceEntityIds:['recall'],mechanics:{requires_item_source:'blade',activation:{mode:'active',cost:[]},effects:[]}};
    const hero:ActorState={id:'hero',name:'Hero',kind:'playerCharacter',controllerId:'hero',ac:10,capabilities:{actionIds:[]},character:{abilityMods:{str:0,dex:0,con:0,int:0,wis:0,cha:0},level:1,profBonus:2},runtime:{hp:{current:1,max:1,temp:0},resources:{},maxResources:{},activeEffects:[],equipment:{},inventory:[]}};
    const world=createWorld({id:'bond',ruleset,actors:[hero]});world.objects.blade={id:'blade',name:'Blade',kind:'item',size:'tiny',itemCardId:'blade',ownerActorId:'hero',grantsToOwner:true,grantedActionRefs:['recall']};
    const command:GameCommand={schemaVersion:1,type:'UseAction',commandId:'recall',actorId:'hero',expectedRevision:0,rulesetContentHash:ruleset.contentHash,actionId:'recall',targetIds:[]};
    const catalog={getAction:()=>action},env={rng:()=>0,nextId:()=>'',clock:()=>1};
    expect(handleCommand(world,command,catalog,env).status).toBe('accepted');world.objects.blade.ownerActorId='other';
    expect(handleCommand(world,command,catalog,env).status).toBe('rejected');
  });
});
