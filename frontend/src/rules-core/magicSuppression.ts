import type {WorldState,ActorState,RuleActionDefinition,UncommittedRuleEvent} from './domain';
import type {Card} from '../types';
import {isAntimagicField,isMagicalMechanics} from './legacy/engineAdapter';
import {payloadsOf} from '../rules-primitives/mechanicsView';
import {matchesWhen} from './legacy/engineAdapter';

type Dict=Record<string,unknown>;
type Distance=(left:string,right:string)=>number|undefined;
const unwrapped=(mechanics:Dict):Dict=>mechanics.antimagicSuppressedMechanics as Dict??mechanics;
const wrapped=(mechanics:Dict):Dict=>({antimagicSuppressedMechanics:mechanics});
const restoreCard=(card:Card):Card=>card.mechanics?.magic_suppressed?{...card,mechanics:{...card.mechanics,magic_suppressed:undefined}}:card;
export function antimagicFields(world:WorldState):{actorId:string;radius:number}[]{
 return Object.values(world.actors).flatMap(actor=>[...actor.passives??[],...actor.runtime.activeEffects.filter(entry=>entry.roundsLeft===undefined||entry.roundsLeft>0).map(entry=>entry.suppressedMechanics??entry.mechanics)]
  .map(unwrapped).flatMap(mechanics=>payloadsOf(mechanics).filter(payload=>payload.kind==='aura'&&isAntimagicField(payload)
   &&matchesWhen(payload.when as Dict[]|undefined,{state:actor.runtime,character:actor.character})))
  .map(payload=>({actorId:actor.id,radius:Number(payload.radius_ft)})));
}
export function projectMagicSuppression(world:WorldState,distance?:Distance):WorldState{
 const fields=antimagicFields(world);
 if(!fields.length&&!Object.values(world.actors).some(actor=>actor.character.magicSuppressed))return world;
 const actors=Object.fromEntries(Object.values(world.actors).map(actor=>{
  const suppressed=fields.some(field=>world.actors[field.actorId].planeId===actor.planeId&&(field.actorId===actor.id||(distance?.(field.actorId,actor.id)
   ??world.actors[field.actorId].character.spatialObservations?.nearby.find(row=>row.actorId===actor.id)?.distanceFt??Infinity)<=field.radius));
  const card=(original:Card)=>{
   const restored=restoreCard(original);
   return suppressed&&restored.mechanics?.magical===true&&!isAntimagicField(restored.mechanics)
    ?{...restored,mechanics:{...restored.mechanics,magic_suppressed:true}}:restored;
  };
  const character={...actor.character,magicSuppressed:suppressed,
   ...(actor.character.knownCards?{knownCards:actor.character.knownCards.map(card)}:{}),
   ...(actor.character.equippedCards?{equippedCards:actor.character.equippedCards.map(card)}:{})};
  const activeEffects=actor.runtime.activeEffects.map(entry=>{
   const restored={...entry,mechanics:entry.suppressedMechanics??entry.mechanics};delete restored.suppressedMechanics;
   // Maintaining concentration is still possible while its effect is dormant.
   const immune=restored.mechanics.kind==='concentration'||isAntimagicField(restored.mechanics)||['artifact','deity'].includes(entry.magicOrigin?.kind??'');
   const magical=!!entry.magicOrigin||!!entry.spellOriginId||restored.mechanics.magical===true;
   return suppressed&&magical&&!immune?{...restored,suppressedMechanics:restored.mechanics,mechanics:{kind:'suppressed',stack_id:restored.mechanics.stack_id}}:restored;
  });
  const passives=actor.passives?.map(raw=>{
   const mechanics=unwrapped(raw),sourceCard=actor.character.knownCards?.find(card=>card.id===mechanics.id);
   return suppressed&&!isAntimagicField(mechanics)&&(isMagicalMechanics(mechanics,character)||sourceCard?.mechanics?.magical===true)
    ?wrapped(mechanics):mechanics;
  });
  const next={...actor,character,runtime:{...actor.runtime,activeEffects},...(passives?{passives}:{})};
  return [actor.id,JSON.stringify(next)===JSON.stringify(actor)?actor:next];
 }));
 return Object.values(actors).every(actor=>actor===world.actors[actor.id])?world:{...world,actors};
}
export function magicProjectionEvents(world:WorldState):Omit<UncommittedRuleEvent,'ordinal'>[]{
 const next=projectMagicSuppression(world);
 if(next===world)return [];
 return Object.values(next.actors).filter(actor=>actor!==world.actors[actor.id]).map(actor=>({sourceActorId:actor.id,obligationIds:['system:antimagic'],payload:{type:'ActorMagicProjectionChanged',actorId:actor.id,
  suppressed:actor.character.magicSuppressed===true,passives:actor.passives??[],effects:actor.runtime.activeEffects,
  knownCards:actor.character.knownCards,equippedCards:actor.character.equippedCards}}));
}
export function magicActionIssue(actor:ActorState,action:RuleActionDefinition,targets:readonly ActorState[]):string|null{
 const origin=action.mechanics.captured_magic_origin as {kind?:string}|undefined;
 if(origin&&['artifact','deity'].includes(origin.kind??''))return null;
 if(action.kind!=='spell'&&!isMagicalMechanics(action.mechanics,actor.character))return null;
 return actor.character.magicSuppressed?'Поле антимагии не позволяет использовать магию':targets.some(target=>target.character.magicSuppressed)?'Цель защищена полем антимагии':null;
}
