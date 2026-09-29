import type {ActorState,RuleActionDefinition,RulesCatalog,UncommittedRuleEvent,WorldState} from './domain';
import {itemGate} from '../character/attunement';
type Dict=Record<string,unknown>;
type Event=Omit<UncommittedRuleEvent,'ordinal'>;
export interface ItemFocusPolicy {class_ids?:string[];costless_materials:true}
export function parseItemFocus(raw:unknown):ItemFocusPolicy|null {
  if(raw===undefined)return null;
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Invalid spell focus');
  const p=raw as Dict;
  if(Object.keys(p).some(key=>!['class_ids','costless_materials'].includes(key))||p.costless_materials!==true
    ||(p.class_ids!==undefined&&(!Array.isArray(p.class_ids)||!p.class_ids.length||!p.class_ids.every(id=>typeof id==='string'&&id.trim()))))throw Error('Invalid spell focus policy');
  return p as unknown as ItemFocusPolicy;
}
/** Same substitution as a Pact Blade: expensive/consumed materials remain in
 * the canonical action costs; verbal and somatic components remain required. */
export function itemMaterialFocus(actor:ActorState,action:RuleActionDefinition):{cardId:string;name:string}|null {
  if(action.kind!=='spell'||action.spell.components?.material!==true)return null;
  for(const card of [...actor.character.knownCards??[]].sort((a,b)=>a.id.localeCompare(b.id))){
    const policy=parseItemFocus(card.mechanics?.spell_focus);
    if(!policy||!itemGate(card,{equipment:actor.runtime.equipment,inventory:actor.runtime.inventory,attuned:actor.character.attunedIds??[]}))continue;
    if(policy.class_ids&&!policy.class_ids.includes(action.spell.sourceClass??''))continue;
    return {cardId:card.id,name:card.name};
  }
  return null;
}
export function itemMaterialFocusEvents(world:WorldState,events:readonly Event[],catalog:RulesCatalog):Event[]{
  return events.flatMap(event=>{
    if(event.payload.type!=='ActionDeclared'||!event.payload.spell)return [];
    const declared=event.payload,actor=world.actors[declared.actorId],action=catalog.getAction(declared.actionId);
    if(!actor||!action||action.kind!=='spell')return [];
    const focus=itemMaterialFocus(actor,action);if(!focus)return [];
    return [{sourceActorId:actor.id,obligationIds:['system:spell-components',`entity:${focus.cardId}`],payload:{type:'EngineEventRecorded' as const,actorId:actor.id,targetIds:[],
      event:{type:'world_interaction' as const,operation:'spell_material_focus',parameters:{...focus,actionId:action.id,components:{...action.spell.components},
        replacesCostlessMaterial:true,preservesConsumedAndCostlyMaterials:true,replacesVerbalComponent:false,replacesSomaticComponent:false}}}}];
  });
}
