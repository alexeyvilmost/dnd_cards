import {describe,expect,it} from 'vitest';
import {createWorld,type ActorState,type GameCommand,type RuleActionDefinition} from '../rules-core/domain';
import {handleCommand} from '../rules-core/handler';
import {createSequentialIdFactory} from '../rules-core/determinism';
import {bindSelfItemCost} from '../engine/cost';
import type {Card} from '../types';
import type {SoloCombatState} from './types';
import {combatHotbarActionHasSource} from './hotbarActions';

describe('committed physical item consumption and the frozen hotbar catalog',()=>{
  it.each([
    {itemId:'vial',actionId:'drink',qty:2,held:false,grant:false,healing:2},
    {itemId:'salve',actionId:'apply',qty:1,held:true,grant:true,healing:3},
  ])('removes $actionId only after consuming the last $itemId, including a held world instance',data=>{
    const ruleset={systemId:'dnd5e-2024' as const,releaseId:'item-consumption',contentHash:'item-consumption',errataVersion:'test'};
    const card={id:data.itemId,card_number:`card-${data.itemId}`,name:data.itemId,mechanics:{while:'carried'}} as unknown as Card;
    const action:RuleActionDefinition={id:data.actionId,name:data.actionId,kind:'nonSpell',
      sourceEntityIds:[data.grant?'action:granted':card.id],
      mechanics:bindSelfItemCost({...(data.grant?{requires_any_item_source:[card.id]}:{damage_source_kind:'item'}),
        activation:{mode:'active',cost:[{resource:'self_item'}]},
        effects:[{resolution:'auto',result:[{kind:'healing',amount:String(data.healing)}]}]},card.id)};
    const hero:ActorState={id:'hero',name:'Hero',kind:'playerCharacter',controllerId:'hero',ac:10,
      capabilities:{actionIds:[action.id]},character:{level:1,profBonus:2,abilityMods:{str:0,dex:0,con:0,int:0,wis:0,cha:0},knownCards:[card],
        ...(data.held?{equippedCards:[card]}:{})},
      runtime:{hp:{current:4,max:20,temp:0},resources:{},maxResources:{},activeEffects:[],
        equipment:data.held?{main_hand:card.id}:{},inventory:data.held?[]:[{cardId:card.id,qty:data.qty,containerId:'bag'}]}};
    const initial=createWorld({id:'consumption',ruleset,actors:[hero],objects:data.held?[{id:'held-copy',name:card.name,kind:'item',size:'tiny',
      itemCardId:card.id,ownerActorId:hero.id,heldByActorId:hero.id,heldInHand:'main_hand',grantsToOwner:true,grantedActionRefs:[action.id]}]:[]});
    const state={characterId:'hero',playerActionIds:[action.id],catalogActions:[action],world:initial} as unknown as SoloCombatState;
    const saved=JSON.stringify({catalog:state.catalogActions,ids:state.playerActionIds,cards:hero.character.knownCards});
    const env={rng:()=>{throw Error('Fixed healing must not draw dice');},nextId:createSequentialIdFactory('consume'),clock:()=>1};
    expect(combatHotbarActionHasSource(state,'hero',action)).toBe(true);
    for(let index=0;index<data.qty;index++){
      const command:GameCommand={schemaVersion:1,type:'UseAction',commandId:`consume:${index}`,expectedRevision:state.world.revision,
        rulesetContentHash:ruleset.contentHash,actorId:hero.id,actionId:action.id,targetIds:[hero.id],
        factsByTarget:{hero:{factsSource:'scenario',boardRevision:state.world.revision,distanceFt:0,lineOfSight:true,cover:'none',relation:'self'}}};
      const result=handleCommand(state.world,command,{getAction:id=>id===action.id?action:undefined},env);
      if(result.status!=='accepted')throw Error(`${result.code}: ${result.message}`);
      state.world=JSON.parse(JSON.stringify(result.nextState));
      expect(combatHotbarActionHasSource(state,'hero',action)).toBe(index+1<data.qty);
      expect(handleCommand(state.world,command,{getAction:()=>action},env)).toMatchObject({status:'rejected',code:'DuplicateCommand'});
    }
    expect(state.world.actors.hero.runtime.inventory).toEqual([]);
    if(data.held){expect(state.world.actors.hero.runtime.equipment.main_hand).toBeNull();expect(state.world.objects['held-copy']).toBeUndefined();}
    expect(state.world.actors.hero.runtime.hp.current).toBe(4+data.qty*data.healing);
    expect(JSON.stringify({catalog:state.catalogActions,ids:state.playerActionIds,cards:state.world.actors.hero.character.knownCards})).toBe(saved);
    // Inspection never revokes the immutable command/history provenance.
    expect(initial.actors.hero.runtime.hp.current).toBe(4);
  });
});
