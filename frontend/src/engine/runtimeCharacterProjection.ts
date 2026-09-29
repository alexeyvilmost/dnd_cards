import {effectiveLevel} from './effectiveLevel';
import {projectWeaponFormCards} from './weaponForms';
import type {CharacterContext,RuntimeState} from '../mvp/contracts';
import {payloadsOf} from './mechanicsView';
import {matchesWhen,activeConditionsOf} from './circumstances';
import {evaluate} from './formula';
import {projectItemFeatCharacter} from '../character/itemFeatProjection';
type Dict=Record<string,unknown>;
const projectionBase=Symbol('runtime-character-baseline');
const abilities=['str','dex','con','int','wis','cha'] as const;
function runtimePayloads(state:RuntimeState,character:CharacterContext):Dict[]{
 return state.activeEffects.filter(entry=>entry.roundsLeft===undefined||entry.roundsLeft>0)
  .flatMap(entry=>payloadsOf(entry.mechanics)).filter(payload=>matchesWhen(payload.when as Dict[]|undefined,{state,character,activeConditions:activeConditionsOf(state)}));
}
/** Temporary methods are projected from the unchanged build on each command.
 * Expiry/revocation therefore restores the actual baseline automatically. */
export function projectRuntimeCharacter(character:CharacterContext,state:RuntimeState,passives:readonly Dict[]=[]):CharacterContext{
 const original=(character as CharacterContext & {[projectionBase]?:CharacterContext})[projectionBase]??character;
 character=projectItemFeatCharacter(original.runtimeProjectionBase?{...original,...original.runtimeProjectionBase}:original,state);
 character={...character,knownCards:projectWeaponFormCards(character.knownCards,state),equippedCards:projectWeaponFormCards(character.equippedCards,state)};
 const allPayloads=[...runtimePayloads(state,character),...passives.flatMap(payloadsOf).filter(p=>matchesWhen(p.when as Dict[]|undefined,{state,character,activeConditions:activeConditionsOf(state)}))];
 const payloads=allPayloads.filter(payload=>payload.kind==='value_method');
 const profRules=allPayloads.filter(payload=>payload.kind==='modifier'&&(payload.applies_to as Dict|undefined)?.roll==='prof_bonus');
 const abilityRules=allPayloads.filter(payload=>payload.kind==='modifier'&&(payload.applies_to as Dict|undefined)?.roll==='ability_score');
 const level=effectiveLevel(character,allPayloads);
 if(!payloads.length&&!profRules.length&&!abilityRules.length&&level.level===character.level)return character;
 const abilityMods={...character.abilityMods},abilityScores={...character.abilityScores};
 for(const ability of abilities){
  const base=abilityScores[ability];
  let score=base;
  for(const payload of payloads.filter(candidate=>candidate.target===ability)){
   const value=evaluate(String(payload.formula),{abilityMods:character.abilityMods,profBonus:character.profBonus,selfLevel:character.level,classLevels:character.classLevels,variables:character.variables,rng:()=>{throw Error('Temporary ability methods must not roll');}});
   if(typeof value!=='number'||!Number.isFinite(value))throw Error('Temporary ability method must be finite');
   // A known modifier is enough to determine that this exact candidate raises
   // the score, but never lower an unknown odd baseline by reconstructing it.
   if(payload.mode==='set'){score=value;continue;}
   if(score===undefined&&Math.floor((value-10)/2)<=abilityMods[ability])continue;
   score=Math.max(score??value,value);
  }
  for(const rule of abilityRules.filter(payload=>((payload.applies_to as Dict)?.filter as Dict|undefined)?.ability===ability)){
   if(score===undefined)throw Error('Ability modifiers require an actual ability score');
   if(rule.op!=='add'||typeof rule.value!=='number'||!Number.isFinite(rule.value))throw Error('Ability score delta must be a captured finite number');
   score=Math.max(0,score+rule.value);
  }
  if(score!==undefined){abilityScores[ability]=score;abilityMods[ability]=Math.floor((score-10)/2);}
 }
 let profBonus=character.profBonus+level.proficiencyDelta;
 for(const rule of profRules){
  const value=evaluate(String(rule.value),{abilityMods,profBonus:character.profBonus,selfLevel:character.level,classLevels:character.classLevels,variables:character.variables,rng:()=>{throw Error('Proficiency rules must not roll');}});
  if(typeof value!=='number'||!Number.isFinite(value))throw Error('Proficiency rule must be finite');
  if(rule.op==='add')profBonus+=value;
  else if(rule.op==='set')profBonus=value;
  else if(rule.op==='multiply')profBonus*=value;
 }
 const baseline=original.runtimeProjectionBase??{abilityScores:original.abilityScores,abilityMods:original.abilityMods,profBonus:original.profBonus,level:original.level,spellcastingMod:original.spellcastingMod};
 const projected={...character,[projectionBase]:original,runtimeProjectionBase:baseline,level:level.level,profBonus,abilityMods,abilityScores,...(character.spellcastingAbility?{spellcastingMod:abilityMods[character.spellcastingAbility]}:{})};
 return projected;
}
export function runtimeMovementSpeeds(character:CharacterContext,state:RuntimeState,passives:readonly Dict[],walk:number):Record<string,number>{
 const speeds:Record<string,number>={walk};
 const payloads=[...passives.flatMap(payloadsOf),...runtimePayloads(state,character)];
 for(const payload of payloads){
  if(payload.kind!=='grant_speed'||typeof payload.mode!=='string'||payload.mode==='walk'
   ||!matchesWhen(payload.when as Dict[]|undefined,{state,character,activeConditions:activeConditionsOf(state)}))continue;
  const raw=payload.value??payload.amount;
  const value=raw==='character_speed'||raw==='speed'?walk:evaluate(String(raw),{abilityMods:character.abilityMods,profBonus:character.profBonus,selfLevel:character.level,classLevels:character.classLevels,variables:character.variables,rng:()=>{throw Error('Granted speed must not roll');}});
  if(typeof value!=='number'||!Number.isFinite(value)||value<0)throw Error('Granted speed must be finite and nonnegative');
  speeds[payload.mode]=Math.max(speeds[payload.mode]??0,value);
 }
 return speeds;
}
