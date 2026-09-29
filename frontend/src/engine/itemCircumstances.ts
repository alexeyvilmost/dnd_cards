import type {RuntimeState,TargetContext} from '../mvp/contracts';
import {isWearingArmor} from './equipment';

export function isHiddenByAction(state:RuntimeState|undefined):boolean {
  return !!state?.activeEffects.some(effect=>{
    const p=effect.mechanics as Record<string,unknown>;
    return (effect.roundsLeft===undefined||effect.roundsLeft>0)&&p.kind==='condition'&&p.value==='invisible'
      &&Array.isArray(p.hidden_end_triggers)&&p.hidden_end_triggers.includes('enemy_finds_actor');
  });
}

/** Unknown equipment cannot establish that the target wears no armor. */
export function targetIsUnarmored(target:TargetContext|undefined):boolean {
  const state=target?.runtimeState,character=target?.characterContext;
  if(!state||!character)return false;
  const cards=character.knownCards??character.equippedCards;
  if(!cards)return false;
  for(const id of Object.values(state.equipment)){if(id&&!cards.some(card=>card.id===id))return false;}
  return !isWearingArmor(state,cards);
}

export function isTransformedOrDisguised(state:RuntimeState|undefined):boolean {
  return !!state?.activeEffects.some(effect=>{
    if(effect.roundsLeft!==undefined&&effect.roundsLeft<=0)return false;
    const p=effect.mechanics as Record<string,unknown>;
    return p.stack_id==='wild_shape_form'||p.kind==='transform'||p.kind==='illusion'&&p.form==='self_disguise';
  });
}
