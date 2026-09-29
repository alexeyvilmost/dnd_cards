import type {CharacterContext,RuntimeState} from '../mvp/contracts';
import {payloadsOf} from './mechanicsView';
import {matchesWhen,activeConditionsOf} from './circumstances';
import {itemGate} from '../character/attunement';

type Dict=Record<string,unknown>;
export interface ActionCostPolicyContext {
  state: RuntimeState;
  character: CharacterContext;
  passives: Dict[];
  actionRefs: string[];
  actionCategory?: string;
  spell?: {baseLevel:number;school?:string;concentration?:boolean};
}
export interface AvailableActionCostPolicy {
  policyId:string;
  label:string;
  sourceEntity?:{type:'card'|'effect';id:string};
  optional:boolean;
  priority:number;
  declaration:Dict;
}

function record(value:unknown):Dict|undefined {
  return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Dict:undefined;
}
function list(value:unknown):string[]|undefined {
  return Array.isArray(value)&&value.length>0&&value.every(v=>typeof v==='string'&&v.trim())?value:undefined;
}
function costs(mechanics:Dict):Dict[] {
  const value=record(mechanics.activation)?.cost;
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.some(entry=>!record(entry)||typeof entry.resource!=='string'))throw Error('Некорректная стоимость действия');
  return value as Dict[];
}

/** Policies are collected from current owner state, never from a submitted UI declaration. */
export function availableActionCostPolicies(mechanics:Dict,ctx:ActionCostPolicyContext):AvailableActionCostPolicy[] {
  const original=costs(mechanics);
  const sources=[...ctx.passives.map(mechanic=>({mechanic,id:String(mechanic.id??''),name:String(mechanic.name??'Изменение стоимости'),effectId:undefined as string|undefined})),
    ...ctx.state.activeEffects.filter(effect=>effect.roundsLeft===undefined||effect.roundsLeft>0)
      .map(effect=>({mechanic:effect.mechanics as Dict,id:effect.id,name:effect.name,effectId:effect.entityRef?.id}))];
  const found:AvailableActionCostPolicy[]=[];
  for(const source of sources){
    const mode=record(source.mechanic.activation)?.mode;
    if(mode!==undefined&&mode!=='passive')continue;
    const card=ctx.character.knownCards?.find(candidate=>candidate.id===source.id);
    if(card&&!itemGate(card,{equipment:ctx.state.equipment,inventory:ctx.state.inventory,attuned:ctx.character.attunedIds??[]}))continue;
    for(const payload of payloadsOf(source.mechanic)){
      if(payload.kind!=='action_cost_policy')continue;
      const match=record(payload.match);
      if(typeof payload.id!=='string'||!payload.id.trim()||!match||Object.keys(match).length===0)continue;
      if(Object.keys(match).some(key=>!['action_refs','costs_resource','spell_level','spell_schools','concentrating_spell','action_categories'].includes(key)))continue;
      const category=ctx.spell?'spell':ctx.actionCategory??record(mechanics.activation)?.counts_as;
      if(match.action_categories!==undefined&&(!list(match.action_categories)||typeof category!=='string'||!list(match.action_categories)!.includes(category)))continue;
      if(payload.max_attacks!==undefined&&(!Number.isSafeInteger(payload.max_attacks)||Number(payload.max_attacks)<1))continue;
      if(match.action_refs!==undefined&&(!list(match.action_refs)||!list(match.action_refs)!.some(ref=>ctx.actionRefs.includes(ref))))continue;
      if(match.costs_resource!==undefined&&(typeof match.costs_resource!=='string'||!original.some(cost=>cost.resource===match.costs_resource)))continue;
      if(match.spell_level!==undefined&&(!ctx.spell||ctx.spell.baseLevel!==match.spell_level))continue;
      if(match.concentrating_spell!==undefined&&(match.concentrating_spell!==true||ctx.spell?.concentration!==true))continue;
      if(match.spell_schools!==undefined&&(!ctx.spell?.school||!list(match.spell_schools)?.includes(ctx.spell.school)))continue;
      if(!matchesWhen(payload.when as Dict[]|undefined,{state:ctx.state,character:ctx.character,activeConditions:activeConditionsOf(ctx.state)}))continue;
      const replace=record(payload.replace),waive=list(payload.waive_resources);
      if(!replace&&!waive&&payload.concentration!==false)continue;
      if(payload.duration_cap_rounds!==undefined&&(!Number.isSafeInteger(payload.duration_cap_rounds)||Number(payload.duration_cap_rounds)<1))continue;
      if(replace&&Object.entries(replace).some(([key,value])=>!key||typeof value!=='string'||!value))continue;
      if(payload.additional_cost!==undefined&&(!Array.isArray(payload.additional_cost)||payload.additional_cost.some(c=>!record(c)||typeof c.resource!=='string'||(c.amount!==undefined&&(!Number.isFinite(c.amount)||Number(c.amount)<=0)))))continue;
      found.push({policyId:payload.id,label:String(payload.label??source.name),optional:payload.optional===true,
        priority:Number.isFinite(payload.priority)?Number(payload.priority):0,declaration:payload,
        ...(card?{sourceEntity:{type:'card' as const,id:card.id}}:source.effectId?{sourceEntity:{type:'effect' as const,id:source.effectId}}:{})});
    }
  }
  const identities=new Set<string>();
  for(const policy of found){if(identities.has(policy.policyId))throw Error('Повторяющийся идентификатор правила стоимости');identities.add(policy.policyId);}
  return found.sort((a,b)=>a.priority-b.priority||a.policyId.localeCompare(b.policyId));
}

/** Returns detached executable mechanics. Payment remains in the canonical executor. */
export function applyActionCostPolicies(mechanics:Dict,ctx:ActionCostPolicyContext,selectedCostPolicyId?:string|null):{mechanics:Dict;appliedPolicyIds:string[];attackCountCap?:number;spellOverrides?:{concentration:false;durationCapRounds?:number}} {
  const available=availableActionCostPolicies(mechanics,ctx);
  if(selectedCostPolicyId!==undefined&&selectedCostPolicyId!==null&&!available.some(policy=>policy.optional&&policy.policyId===selectedCostPolicyId))throw Error('Выбранное изменение стоимости недоступно');
  const applied=available.filter(policy=>!policy.optional||policy.policyId===selectedCostPolicyId);
  if(!applied.length)return {mechanics,appliedPolicyIds:[]};
  const ordered=[...applied.filter(policy=>!policy.optional),...applied.filter(policy=>policy.optional)];
  const replacements:Dict={},waivers=new Set<string>();
  for(const policy of ordered){
    Object.assign(replacements,record(policy.declaration.replace)??{});
    for(const resource of list(policy.declaration.waive_resources)??[])waivers.add(resource);
  }
  const next:Dict[]=costs(mechanics).flatMap(cost=>{
    const resource=String(cost.resource);
    if(waivers.has(resource)||replacements[resource]==='free_action')return [];
    return [{...cost,resource:replacements[resource]??resource}];
  });
  for(const policy of ordered)next.push(...((policy.declaration.additional_cost as Dict[]|undefined)??[]).map(cost=>({...cost})));
  const attackCaps=ordered.flatMap(policy=>policy.declaration.max_attacks===undefined?[]:[Number(policy.declaration.max_attacks)]);
  const concentration=ordered.some(policy=>policy.declaration.concentration===false);
  const caps=ordered.flatMap(policy=>policy.declaration.duration_cap_rounds===undefined?[]:[Number(policy.declaration.duration_cap_rounds)]);
  return {mechanics:{...mechanics,activation:{...record(mechanics.activation),cost:next}},appliedPolicyIds:applied.map(policy=>policy.policyId),
    ...(attackCaps.length?{attackCountCap:Math.min(...attackCaps)}:{}),
    ...(concentration?{spellOverrides:{concentration:false as const,...(caps.length?{durationCapRounds:Math.min(...caps)}:{})}}:{})};
}
