import type {ActiveEffectEntry,CharacterContext,ExecuteContext,ExecuteResult,RuntimeState} from '../mvp/contracts';
import {payloadsOf} from './mechanicsView';
type Dict=Record<string,unknown>;

export function isAntimagicField(mechanics:Dict):boolean{
 return payloadsOf(mechanics).some(payload=>payload.kind==='magic_suppression'
  ||payload.kind==='aura'&&Array.isArray(payload.effects)&&payload.effects.some(effect=>(effect as Dict).kind==='magic_suppression'));
}
export function isMagicalMechanics(mechanics:Dict,character?:CharacterContext):boolean{
 if(mechanics.magical===true||mechanics.magic_action===true||mechanics.damage_source_kind==='spell'||Array.isArray(mechanics.spell_class_list_ids))return true;
 const refs=[mechanics.requires_item_source,...Array.isArray(mechanics.requires_any_item_source)?mechanics.requires_any_item_source:[]];
 return (character?.knownCards??[]).some(card=>refs.includes(card.id)&&card.mechanics?.magical===true);
}
export function magicExecutionIssue(mechanics:Dict,ctx:Pick<ExecuteContext,'character'|'target'|'spell'>):string|null{
 const captured=mechanics.captured_magic_origin as ActiveEffectEntry['magicOrigin'];
 if(captured&&['artifact','deity'].includes(captured.kind))return null;
 const magical=!!ctx.spell||isMagicalMechanics(mechanics,ctx.character);
 if(!magical)return null;
 if(ctx.character.magicSuppressed)return 'Поле антимагии не позволяет использовать магию';
 if(ctx.target?.characterContext?.magicSuppressed)return 'Цель защищена полем антимагии';
 return null;
}
export function actionMagicOrigin(mechanics:Dict,ctx:Pick<ExecuteContext,'character'|'selfId'|'spell'>):ActiveEffectEntry['magicOrigin']|undefined{
 const captured=mechanics.captured_magic_origin as ActiveEffectEntry['magicOrigin'];
 if(captured&&['spell','item','artifact','deity'].includes(captured.kind)&&typeof captured.sourceEntityId==='string')return captured;
 if(mechanics.magic_origin==='deity')return {kind:'deity',sourceEntityId:String(mechanics.id??ctx.spell?.spellId??'divine-effect')};
 const itemRef=mechanics.requires_item_source??ctx.spell?.sourceId;
 const item=(ctx.character.knownCards??[]).find(card=>card.id===itemRef||card.card_number===itemRef);
 if(ctx.spell)return {kind:item?.rarity==='artifact'?'artifact':'spell',sourceEntityId:item?.id??ctx.spell.spellId??String(mechanics.id??'spell')};
 if(isMagicalMechanics(mechanics,ctx.character))return {kind:'item',sourceEntityId:item?.id??String(mechanics.id??ctx.selfId??'magic')};
 return undefined;
}
export function markMagicEffects(before:RuntimeState,result:ExecuteResult,mechanics:Dict,ctx:ExecuteContext):ExecuteResult{
 const origin=actionMagicOrigin(mechanics,ctx);if(!origin)return result;
 const mark=(old:RuntimeState|undefined,next:RuntimeState)=>{
  const ids=new Set(old?.activeEffects.map(effect=>effect.id));
  return {...next,activeEffects:next.activeEffects.map(effect=>ids.has(effect.id)||effect.magicOrigin?effect:{...effect,magicOrigin:origin})};
 };
 return {...result,state:mark(before,result.state),...(result.targetState?{targetState:mark(ctx.target?.runtimeState,result.targetState)}:{}),
  events:result.events.map(event=>['area_effect','area_damage','area_healing'].includes(event.type)?{...event,magicOrigin:origin}:event)};
}
