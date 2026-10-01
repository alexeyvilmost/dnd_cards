import type {RuleActionDefinition, UseTriggeredActionCommand} from './domain';

/** A hit rider belongs to the already hit creature and its captured attack
 * reach. Equipment changes cannot widen that saved target authority. */
export function bindTriggeredAttackTargeting(
  action:RuleActionDefinition,
  targetIds:readonly string[],
  triggeringAttack:UseTriggeredActionCommand['triggeringAttack'],
): {action:RuleActionDefinition;issue?:string} {
  const targeting=action.mechanics.targeting as Record<string,unknown>|undefined;
  if(targeting?.range_from_triggering_attack!==true)return {action};
  if(!triggeringAttack || !Number.isFinite(triggeringAttack.meleeReachFt) || triggeringAttack.meleeReachFt!<=0) {
    return {action,issue:'This hit rider requires the captured reach of its triggering melee attack'};
  }
  if(targetIds.length!==1 || targetIds[0]!==triggeringAttack.targetActorId) {
    return {action,issue:'This hit rider can affect only the creature hit by its triggering attack'};
  }
  if(triggeringAttack.roll && !['hit','crit'].includes(String(triggeringAttack.roll.outcome))) {
    return {action,issue:'The triggering attack did not hit'};
  }
  if(!action.targeting)return {action,issue:'This hit rider requires declared actor targeting'};
  const rangeFt=triggeringAttack.meleeReachFt!;
  return {action:{...action,targeting:{...action.targeting,rangeFt},
    mechanics:{...action.mechanics,targeting:{...targeting,range_ft:rangeFt}}}};
}
