import {projectRuleAction} from '../canon/ruleActionProjection';
import {payloadsOf} from '../engine/mechanicsView';
import type {ActorState} from '../rules-core/domain';
import type {Action} from '../types';
import type {SoloCombatState} from './types';

type Dict=Record<string,unknown>;

export interface ItemOwnedActorPolicy {
  itemCardId:string;
  actionRef:string;
}

/** An item supplies a turn, but its only action resolves with the current
 * wielder's state. The turn actor never owns a second copy of the weapon. */
export function itemOwnedActorPolicies(actor:ActorState):ItemOwnedActorPolicy[] {
  const found=new Map<string,ItemOwnedActorPolicy>();
  for(const passive of actor.passives??[])for(const payload of payloadsOf(passive as Dict)){
    if(payload.kind!=='item_owned_actor')continue;
    const itemCardId=payload.item_card_id,actionRef=payload.action_ref;
    if(typeof itemCardId!=='string'||!itemCardId||typeof actionRef!=='string'||!actionRef
      ||payload.initiative!=='independent'||payload.attacks_per_turn!==1){
      throw Error('Invalid item-owned actor policy');
    }
    if(found.has(itemCardId))throw Error('Duplicate item-owned actor policy');
    found.set(itemCardId,{itemCardId,actionRef});
  }
  return [...found.values()];
}

export function itemOwnedActorId(ownerActorId:string,itemCardId:string):string{
  return `${ownerActorId}:item-turn:${itemCardId}`;
}

export function materializeItemOwnedActors(state:SoloCombatState,actionCards:readonly Action[]):SoloCombatState{
  const actors={...state.world.actors};
  const tokens={...state.tokens};
  const sideByActorId={...state.sideByActorId};
  const actorPresentation={...state.actorPresentation};
  const playerActionIdsByActor={...state.playerActionIdsByActor};
  const certifiedPlayerActionIdsByActor={...state.certifiedPlayerActionIdsByActor};
  const movementRemainingFt={...state.movementRemainingFt};
  const initiativeBonuses={...state.initiativeBonuses};
  const actionPresentation={...state.actionPresentation};
  const catalogActions=[...state.catalogActions];
  for(const ownerId of state.controlledCharacterIds??[state.characterId]){
    const owner=actors[ownerId],ownerToken=tokens[ownerId];
    if(!owner||!ownerToken)continue;
    for(const policy of itemOwnedActorPolicies(owner)){
      if(owner.runtime.equipment.main_hand!==policy.itemCardId)continue;
      const item=[...(owner.character.equippedCards??[]),...(owner.character.knownCards??[])]
        .find(card=>card.id===policy.itemCardId);
      if(!item)throw Error('An equipped item-owned actor has no canonical card');
      const source=actionCards.find(card=>card.card_number===policy.actionRef);
      if(!source||!source.mechanics)throw Error(`${policy.actionRef}: item-owned action is absent`);
      const action=projectRuleAction(source);
      const activation=action.mechanics.activation as Dict|undefined;
      const costs=activation?.cost;
      if(action.kind!=='nonSpell'||activation?.mode!=='active'||!Array.isArray(costs)||costs.length!==1
        ||(costs[0] as Dict).resource!=='action'||Number((costs[0] as Dict).amount??1)!==1
        ||action.mechanics.requires_held_item!==policy.itemCardId
        ||action.mechanics.weapon_source_id!==policy.itemCardId){
        throw Error(`${policy.actionRef}: invalid item-owned attack`);
      }
      const actorId=itemOwnedActorId(owner.id,policy.itemCardId);
      if(actors[actorId])throw Error(`Duplicate item-owned actor ${actorId}`);
      const sourceEntityIds=[policy.itemCardId,...action.sourceEntityIds] as [string,...string[]];
      actors[actorId]={
        id:actorId,name:item.name,kind:'summonedActor',controllerId:owner.controllerId,
        capabilities:{actionIds:[action.id],featureSources:{[action.id]:sourceEntityIds}},
        character:{...owner.character,characterSpeed:0,baseSpeed:0},
        runtime:{hp:{current:1,max:1,temp:0},resources:{action:1,bonus_action:0,reaction:0,movement:0},
          maxResources:{action:1,bonus_action:0,reaction:0,movement:0},equipment:{},inventory:[],activeEffects:[]},
        passives:[],lifecycle:{status:'alive'},
        attackProfile:{attacksPerAction:1,size:0,reachFt:5,graspingParts:[],sourceEntityIds},
        itemTurn:{ownerActorId:owner.id,itemCardId:policy.itemCardId,actionId:action.id},
      };
      // Attached tokens are positional proxies, never cover, obstacles or targets.
      tokens[actorId]={actorId,color:'#a378bf',position:{...ownerToken.position},attachedToActorId:owner.id};
      sideByActorId[actorId]=sideByActorId[owner.id];
      actorPresentation[actorId]={description:`${item.name}: отдельный ход для одной атаки из рук ${owner.name}.`,
        source:item.name,actionIds:[action.id],traits:[]};
      playerActionIdsByActor[actorId]=[action.id];
      certifiedPlayerActionIdsByActor[actorId]=[];
      movementRemainingFt[actorId]=0;
      initiativeBonuses[actorId]=Number(state.initiativeBonuses[owner.id]??owner.character.abilityMods.dex??0);
      if(!catalogActions.some(candidate=>candidate.id===action.id))catalogActions.push(action);
      actionPresentation[action.id]={imageUrl:source.image_url,description:source.description,
        sourceLabel:item.name,entityType:'action',entityId:source.id,actionRef:source};
    }
  }
  return {...state,world:{...state.world,actors},tokens,sideByActorId,actorPresentation,
    playerActionIdsByActor,certifiedPlayerActionIdsByActor,movementRemainingFt,initiativeBonuses,
    actionPresentation,catalogActions:catalogActions.sort((a,b)=>a.id.localeCompare(b.id))};
}

/** Weapon stays in the owner's hand while they move or teleport. */
export function syncItemOwnedActorTokens(state:SoloCombatState):SoloCombatState{
  let changed=false;
  const tokens={...state.tokens};
  for(const [id,token] of Object.entries(tokens)){
    const ownerId=token.attachedToActorId;
    if(!ownerId)continue;
    const owner=tokens[ownerId];
    if(!owner)continue;
    if(token.position.x!==owner.position.x||token.position.y!==owner.position.y){
      tokens[id]={...token,position:{...owner.position}};changed=true;
    }
  }
  return changed?{...state,tokens}:state;
}
