import type {EngineEvent,RuntimeState} from '../mvp/contracts';
import {evaluate,FormulaError,type FormulaContext} from './formula';
import {matchesWhen,creatureTypeMatches,type EvalContext} from './circumstances';
import {payloadsOf} from './mechanicsView';
import {drawDie} from './random';

type Dict=Record<string,unknown>;
const object=(value:unknown):value is Dict=>!!value&&typeof value==='object'&&!Array.isArray(value);
export interface DamagePolicyRollCache { [policyId:string]:number }
/** A chance is rolled visibly once per policy/attack when the caller supplies
 * the shared attack cache. The ordinary command RNG/receipt owns replay. */
export function incomingDamagePolicies(input:{
 amount:number;damageType:string;delivery:'attack'|'other';attackerCreatureType?:string;
 sourceActorId?:string;recipientActorId?:string;sourceKind?:'item'|'spell'|'ability';
 attackTotal?:number;targetAC?:number;
 state:RuntimeState;mechanics:Dict[];conditions:EvalContext;formula:FormulaContext;
 rng:()=>number;rollCache?:DamagePolicyRollCache;
}):{amount:number;events:EngineEvent[];rollCache:DamagePolicyRollCache}{
 let amount=Math.max(0,Math.floor(input.amount));
 const events:EngineEvent[]=[];
 const rollCache={...input.rollCache};
 if(amount===0)return {amount,events,rollCache};
 const sources=[...input.state.activeEffects.map(entry=>({id:entry.id,name:entry.name,mechanics:entry.mechanics})),
  ...input.mechanics.map((mechanics,index)=>({id:String(mechanics.id??index),name:String(mechanics.name??mechanics.id??'Правило входящего урона'),mechanics}))];
 for(const source of sources){
  const activation=object(source.mechanics.activation)?source.mechanics.activation:{};
  if(activation.mode!==undefined&&activation.mode!=='passive')continue;
  for(const [index,payload] of payloadsOf(source.mechanics).entries()){
   const applies=object(payload.applies_to)?payload.applies_to:{};
   const reductionFilter=object(payload.filter)?payload.filter:{};
   const specialReduction=payload.kind==='reduce_damage'&&(payload.chance!==undefined||['creature_types','source_actor','source_kinds'].some(key=>reductionFilter[key]!==undefined));
   if(!specialReduction&&!(payload.kind==='modifier'&&applies.roll==='damage_received'))continue;
   if(payload.when!==undefined&&(!Array.isArray(payload.when)||!payload.when.every(object)||!matchesWhen(payload.when,input.conditions)))continue;
   const rawFilter=specialReduction?payload.filter:applies.filter;
   if(rawFilter!==undefined&&!object(rawFilter))continue;
   const filter=object(rawFilter)?rawFilter:{};
   if(Object.keys(filter).some(key=>!['source','damage_types','creature_types','source_actor','source_kinds','attack_total_equals_ac'].includes(key)))continue;
   if(filter.attack_total_equals_ac!==undefined&&(filter.attack_total_equals_ac!==true||input.delivery!=='attack'
     || !Number.isFinite(input.attackTotal)||!Number.isFinite(input.targetAC)||input.attackTotal!==input.targetAC))continue;
   if(filter.source!==undefined&&filter.source!==input.delivery)continue;
   if(filter.damage_types!==undefined&&(!Array.isArray(filter.damage_types)||!filter.damage_types.includes(input.damageType)))continue;
   if(filter.creature_types!==undefined&&(!Array.isArray(filter.creature_types)||!filter.creature_types.some(type=>creatureTypeMatches(input.attackerCreatureType,type))))continue;
   if(filter.source_actor!==undefined&&(filter.source_actor!=='self'||!input.sourceActorId||input.sourceActorId!==input.recipientActorId))continue;
   if(filter.source_kinds!==undefined&&(!Array.isArray(filter.source_kinds)||!input.sourceKind||!filter.source_kinds.includes(input.sourceKind)))continue;
   const sourceIds=[...new Set([source.id,...(Array.isArray(payload.sourceEntityIds)?payload.sourceEntityIds.filter((id):id is string=>typeof id==='string'):[])])];
   if(payload.chance!==undefined){
    const chance=payload.chance;
    if(!object(chance)||!Number.isInteger(chance.die)||Number(chance.die)<2||Number(chance.die)>1000
      ||!Array.isArray(chance.equals)||!chance.equals.length
      ||chance.equals.some(value=>!Number.isInteger(value)||Number(value)<1||Number(value)>Number(chance.die)))throw new Error('Invalid damage policy chance');
    const sides=Number(chance.die),key=JSON.stringify([source.id,index]);
    let rolled=rollCache[key];
    if(rolled===undefined){
     rolled=drawDie(input.rng,sides);rollCache[key]=rolled;
     events.push({type:'roll',label:source.name,roll:{kind:'other',advantage:'none',dice:[{sides,result:rolled}],modifiers:[],total:rolled,text:`${source.name}: 1d${sides} = ${rolled}`}});
    }
    if(!chance.equals.includes(rolled))continue;
   }
   const before=amount;
   const expression=specialReduction?payload.amount:payload.value;
   const resolved=evaluate(expression as string|number,{...input.formula,rng:()=>{throw new FormulaError('Damage policy values must not roll hidden dice');}});
   if(typeof resolved!=='number'||!Number.isFinite(resolved))throw new Error('Damage policy value must be finite');
   if(specialReduction)amount=Math.max(0,amount-Math.max(0,Math.floor(resolved)));
   else if(payload.op==='add')amount=Math.max(0,Math.floor(amount+resolved));
   else if(payload.op==='multiply')amount=Math.max(0,Math.floor(amount*resolved));
   else if(payload.op==='set')amount=Math.max(0,Math.floor(resolved));
   else throw new Error('Unsupported incoming damage operation');
   if(amount<before)events.push({type:'damage_reduction',amount:before-amount,source:source.name,sourceEntityIds:sourceIds});
   else if(amount>before)events.push({type:'narrative',text:`${source.name}: входящий урон ${before} → ${amount} (+${amount-before})`});
  }
 }
 return {amount,events,rollCache};
}
