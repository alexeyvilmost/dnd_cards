import type {WorldState,RulesCatalog,UncommittedRuleEvent,DeterministicEnvironment} from './domain';
import type {ActiveEffectEntry} from '../mvp/contracts';
import {payloadsOf} from '../rules-primitives/mechanicsView';
import {matchesWhen} from './legacy/engineAdapter';
import {itemSourceRequirementIssue} from './legacy/engineAdapter';
type Dict=Record<string,unknown>;
type Event=Omit<UncommittedRuleEvent,'ordinal'>;
const clone=<T,>(value:T):T=>JSON.parse(JSON.stringify(value));
/** Relationships are source-owned persisted state. Rebinding replaces exactly
 * one source/key set; casting copies already-resolved effects, never spell cost,
 * RNG or another recipient's effects. */
export function recipientBindingEvents(before:WorldState,after:WorldState,events:readonly Event[],catalog:RulesCatalog,env:DeterministicEnvironment):Event[]{
 const effects=new Map<string,ActiveEffectEntry[]>();
 const list=(id:string)=>effects.get(id)??after.actors[id].runtime.activeEffects;
 const put=(id:string,entries:ActiveEffectEntry[])=>effects.set(id,entries);
 for(const event of events){
  if(event.payload.type!=='ActionDeclared')continue;
  const declaration=event.payload,source=after.actors[declaration.actorId],action=catalog.getAction(declaration.actionId);
  if(!source||!action)continue;
  const binding=action.mechanics.recipient_binding as Dict|undefined;
  if(binding){
   if(typeof binding.key!=='string'||!binding.key||!Number.isSafeInteger(binding.max_recipients)||Number(binding.max_recipients)<1||declaration.targetIds.length>Number(binding.max_recipients))throw Error('Invalid recipient binding');
   if(itemSourceRequirementIssue(action.mechanics,source.runtime,source.character))throw Error('Recipient binding source is unavailable');
   const kept=list(source.id).filter(entry=>entry.mechanics.kind!=='recipient_binding'||entry.mechanics.key!==binding.key);
   if(declaration.targetIds.length)kept.push({id:env.nextId(),name:action.name,source:action.name,sourceId:source.id,ownerId:source.id,
    mechanics:{kind:'recipient_binding',key:binding.key,recipients:[...declaration.targetIds],...(typeof action.mechanics.requires_item_source==='string'?{requires_item_source:action.mechanics.requires_item_source}:{})}});
   put(source.id,kept);
  }
  if(action.kind!=='spell'||!declaration.spell)continue;
  const refs=[action.id,...action.sourceEntityIds];
  const policies=[...source.passives??[],...source.runtime.activeEffects.filter(e=>e.roundsLeft===undefined||e.roundsLeft>0).map(e=>e.mechanics)].flatMap(payloadsOf)
   .filter(p=>p.kind==='spell_effect_share'&&Array.isArray(p.spell_refs)&&p.spell_refs.some(ref=>typeof ref==='string'&&refs.includes(ref))&&matchesWhen(p.when as Dict[]|undefined,{state:source.runtime,character:source.character}));
  const previous=new Map(Object.values(before.actors).flatMap(actor=>actor.runtime.activeEffects.map(entry=>[entry.id,JSON.stringify(entry)] as const)));
  const granted=Object.values(after.actors).flatMap(actor=>actor.runtime.activeEffects).filter(entry=>!entry.sharedSpellSource&&entry.sourceId===source.id&&entry.spellOriginId===action.id&&JSON.stringify(entry)!==previous.get(entry.id));
  if(!granted.length)continue;
  const recipients=new Set<string>();
  for(const policy of policies)for(const relation of list(source.id)){
   const data=relation.mechanics;
   if(data.kind!=='recipient_binding'||data.key!==policy.binding_key||!Array.isArray(data.recipients)||itemSourceRequirementIssue(data,source.runtime,source.character))continue;
   for(const id of data.recipients)if(typeof id==='string'&&id!==source.id&&after.actors[id])recipients.add(id);
  }
  for(const id of recipients){
   let current=list(id);
   for(const entry of granted){
    const identity=String(entry.mechanics.stack_id??entry.entityRef?.id??entry.name);
    current=current.filter(old=>old.sharedSpellSource?.actorId!==source.id||old.sharedSpellSource.effectKey!==identity);
    current.push({...clone(entry),id:env.nextId(),ownerId:id,sourceId:source.id,sharedSpellSource:{actorId:source.id,effectKey:identity}});
   }
   put(id,current);
  }
 }
 return [...effects].flatMap(([actorId,activeEffects])=>JSON.stringify(activeEffects)===JSON.stringify(after.actors[actorId].runtime.activeEffects)?[]:[{sourceActorId:actorId,obligationIds:['system:recipient-binding'],payload:{type:'ActorRuntimePatched',actorId,patch:{activeEffects},reason:'action'}}]);
}
