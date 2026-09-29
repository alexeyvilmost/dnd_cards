import type {RuleActionDefinition,SpatialFacts} from './domain';
export function teleportDestinationIssue(action:RuleActionDefinition,facts:SpatialFacts|undefined):string|null {
 const policy=action.mechanics.teleport_destination as Record<string,unknown>|undefined;
 if(!policy)return null;
 if(policy.relative_to==='target'){
  const limit=Number(policy.max_distance_ft);
  if(!Number.isFinite(limit)||limit<=0||policy.requires_visible!==true)return 'Invalid target teleport destination policy';
  if(!facts?.teleportDestinationValidated||facts.factsSource!=='board'
    ||facts.destinationVisible!==true||!Number.isFinite(facts.destinationDistanceFt)
    ||Number(facts.destinationDistanceFt)<0||Number(facts.destinationDistanceFt)>limit)
    return `Выберите видимое свободное место не дальше ${limit} фт от цели`;
  return null;
 }
 const levels=policy.illumination;
 if(!Array.isArray(levels)||!levels.length||levels.some(level=>!['bright','dim','dark'].includes(String(level))))return 'Invalid teleport destination illumination policy';
 if(!facts?.teleportDestinationValidated||facts.factsSource!=='board'||!levels.includes(facts.destinationIllumination))return 'Выберите свободную клетку с требуемым освещением на поле';
 return null;
}
