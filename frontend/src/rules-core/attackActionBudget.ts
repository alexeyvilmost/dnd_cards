import {availableActionCostPolicies} from './legacy/engineAdapter';
import type {ActorState} from './domain';
import {collectModifiers,foldModifiers} from './legacy/engineAdapter';
import {activeConditionsOf} from './legacy/engineAdapter';
export function attackActionBudget(actor:ActorState,costPolicyIds:readonly string[]=[],actionRefs:string[]=[]):{value:number;sources:string[]}{
 const base=actor.attackProfile?.attacksPerAction;
 if(!Number.isSafeInteger(base)||Number(base)<1)throw Error('Actor has no valid attack profile');
 const collected=collectModifiers(actor.runtime,actor.passives??[],{roll:'attacks_per_action',
  formulaCtx:{abilityMods:actor.character.abilityMods,profBonus:actor.character.profBonus,selfLevel:actor.character.level,classLevels:actor.character.classLevels,variables:actor.character.variables},
  evalCtx:{state:actor.runtime,character:actor.character,activeConditions:activeConditionsOf(actor.runtime)}});
 const folded=foldModifiers(base!,collected);
 if(!Number.isSafeInteger(folded.value)||folded.value<1||folded.value>64)throw Error('Invalid attack budget');
 const available=availableActionCostPolicies({activation:{cost:[{resource:'action'}]}},{state:actor.runtime,character:actor.character,passives:actor.passives??[],actionRefs,actionCategory:'attack'});
 const caps:number[]=[];
 for(const id of costPolicyIds){const policy=available.find(row=>row.policyId===id);if(!policy)throw Error('Attack cost policy is no longer available');if(policy.declaration.max_attacks!==undefined)caps.push(Number(policy.declaration.max_attacks));}
 return {value:Math.min(folded.value,...caps),sources:[...folded.parts.map(part=>part.source),...costPolicyIds]};
}
