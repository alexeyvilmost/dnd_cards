import type {ActorState,RuleActionDefinition} from './domain';
import {payloadsOf} from '../rules-primitives/mechanicsView';
import {activeConditionsOf,matchesWhen} from './legacy/engineAdapter';
import {triggerChance} from './legacy/engineAdapter';
import type {EngineEvent} from '../mvp/contracts';
type Dict=Record<string,unknown>;

function reflectionRules(target:ActorState,action:RuleActionDefinition):Dict[]{
  const effects=Array.isArray(action.mechanics.effects)?action.mechanics.effects as Dict[]:[];
  if(!effects.some(effect=>effect.resolution==='attack_roll'&&(effect.projectile===true
    ||String(effect.attack_kind).includes('ranged')&&String(effect.attack_kind).includes('weapon'))))return [];
  const sources=[...(target.passives??[]),...target.runtime.activeEffects.filter(effect=>effect.roundsLeft===undefined||effect.roundsLeft>0).map(effect=>effect.mechanics)];
  return sources.flatMap(mechanics=>payloadsOf(mechanics).filter(payload=>payload.kind==='projectile_reflection'
    &&matchesWhen(payload.when as Dict[]|undefined,{state:target.runtime,character:target.character,activeConditions:activeConditionsOf(target.runtime)})));
}
export const hasProjectileReflection=(target:ActorState,action:RuleActionDefinition):boolean=>reflectionRules(target,action).length>0;
export function projectileReflection(target:ActorState,action:RuleActionDefinition,rng:()=>number):{reflected:boolean;events:EngineEvent[]}|null{
  const rules=reflectionRules(target,action);
  if(!rules.length)return null;
  const events:EngineEvent[]=[];
  for(const rule of rules){
    const result=triggerChance(rule.chance,'Отражение снаряда',rng);events.push(...result.events);
    if(result.success)return {reflected:true,events:[...events,{type:'narrative',text:'Снаряд отражён в атакующего.'}]};
  }
  return {reflected:false,events};
}
