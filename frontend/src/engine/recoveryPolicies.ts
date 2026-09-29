import type {CharacterContext,RuntimeState} from '../mvp/contracts';
import {payloadsOf} from './mechanicsView';
import {matchesWhen} from './circumstances';
import {validateTriggerChance} from './triggerChance';
type Dict=Record<string,unknown>;
export type RecoveryKind='healing'|'temp_hp';
export function recoveryReplacement(state:RuntimeState,passives:readonly Dict[],character:CharacterContext,kind:RecoveryKind):Dict|undefined {
  return [...passives,...state.activeEffects.filter(effect=>effect.roundsLeft===undefined||effect.roundsLeft>0).map(effect=>effect.mechanics)].flatMap(payloadsOf)
    .find(payload=>payload.kind==='recovery_policy'&&Array.isArray(payload.kinds)&&payload.kinds.includes(kind)
      &&matchesWhen(payload.when as Dict[]|undefined,{state,character}));
}
export function validRecoveryPolicy(payload:Dict):boolean {
  return payload.replace_with==='damage'&&typeof payload.damage_type==='string'&&payload.damage_type.length>0
    &&Array.isArray(payload.kinds)&&payload.kinds.length>0&&payload.kinds.every(kind=>kind==='healing'||kind==='temp_hp')
    &&validateTriggerChance(payload.chance);
}
