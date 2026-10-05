import type { CharacterContext, RuntimeState } from '../mvp/contracts';
import { activeConditionsOf, matchesWhen } from './circumstances';
import { matchingRuntimeActionGrants } from '../rules-primitives/runtimeActionGrants';
import { itemGate,attunementCapacity } from '../character/attunement';
import {isMagicalMechanics} from './magic';
import {resourceRestrictionIssue} from './resourceRestrictions';

type Dict = Record<string, unknown>;

function requiredEffectReferences(mechanics: Dict): string[] {
  const declared = mechanics.requires_active_effect;
  if (typeof declared === 'string') return declared.trim() ? [declared.trim()] : [];
  if (!Array.isArray(declared)) return [];
  return declared.flatMap((value) => (
    typeof value === 'string' && value.trim() ? [value.trim()] : []
  ));
}

/**
 * Some catalog actions are projections of a temporary library effect rather
 * than permanent character abilities (for example, a Beast attack while Wild
 * Shaped). Their availability is therefore keyed by exact effect provenance,
 * never by a translated display name.
 */
export function activeEffectRequirementIssue(
  mechanics: Dict,
  state: RuntimeState,
  character?: CharacterContext,
): string | null {
  const captured=mechanics.captured_magic_origin as {kind?:string}|undefined;
  if(character?.magicSuppressed&&isMagicalMechanics(mechanics,character)&&!['artifact','deity'].includes(captured?.kind??''))return 'Поле антимагии не позволяет использовать магию';
  const whenIssue = activationCircumstanceIssue(mechanics, state, character);
  if (whenIssue) return whenIssue;
  const heldIssue = heldItemRequirementIssue(mechanics, state);
  if (heldIssue) return heldIssue;
  const itemIssue = itemSourceRequirementIssue(mechanics, state, character);
  if (itemIssue) return itemIssue;
  const activation=mechanics.activation as Dict|undefined;
  const resourceIssue=resourceRestrictionIssue(state,Array.isArray(activation?.cost)?activation.cost as Dict[]:[],character);
  if(resourceIssue)return resourceIssue;
  const runtimeGrant = mechanics.requires_runtime_action_grant;
  if (runtimeGrant !== undefined) {
    if (!Array.isArray(runtimeGrant) || runtimeGrant.length === 0
      || runtimeGrant.some(reference => typeof reference !== 'string' || !reference.trim())) {
      return 'Некорректный источник временного действия';
    }
    const available = matchingRuntimeActionGrants(state, mechanics, character?.level).length > 0;
    if (!available) return 'Действие доступно только пока действует предоставляющий его эффект';
  }
  const forbiddenStack = typeof mechanics.forbids_active_effect_stack === 'string'
    ? mechanics.forbids_active_effect_stack.trim()
    : '';
  if (forbiddenStack && state.activeEffects.some((effect) => (
    (effect.mechanics as Dict | undefined)?.stack_id === forbiddenStack
  ))) {
    return 'Для следующего заклинания уже выбран другой вариант Метамагии';
  }
  const required = requiredEffectReferences(mechanics);
  const requiredStack = typeof mechanics.requires_active_effect_stack === 'string'
    ? mechanics.requires_active_effect_stack.trim()
    : '';
  if (!required.length && !requiredStack) return null;
  if (requiredStack && state.activeEffects.some((effect) => (
    (effect.mechanics as Dict | undefined)?.stack_id === requiredStack
  ))) return null;
  const active = new Set(state.activeEffects.flatMap((effect) => {
    const reference = effect.entityRef;
    return [reference?.id, reference?.cardNumber].filter(
      (value): value is string => typeof value === 'string' && Boolean(value),
    );
  }));
  return required.some((reference) => active.has(reference))
    ? null
    : 'Действие доступно только в соответствующем активном облике';
}

/** Recheck item-owned capabilities against current equipment, not the UI grant list. */
export function itemSourceRequirementIssue(mechanics: Dict, state: RuntimeState, character?: CharacterContext): string | null {
  if(mechanics.requires_any_item_source!==undefined){
    const sources=mechanics.requires_any_item_source;
    if(!Array.isArray(sources)||!sources.length||!sources.every(source=>typeof source==='string'&&source))return 'Некорректные источники предметной способности';
    return sources.some(source=>itemSourceRequirementIssue({requires_item_source:source},state,character)===null)?null:'Предмет больше не предоставляет эту способность';
  }
  const source = mechanics.requires_item_source;
  if (source === undefined) return null;
  if (typeof source !== 'string' || !source.trim()) return 'Некорректный источник предметного действия';
  const card = character?.knownCards?.find(candidate => candidate.id === source);
  if (!card || !itemGate(card, { equipment: state.equipment, inventory: state.inventory, attuned: character?.attunedIds ?? [] })) {
    return 'Предмет больше не предоставляет это действие';
  }
  return null;
}

/** The same content-owned prerequisites govern previews and authoritative payment. */
export function activationCircumstanceIssue(mechanics: Dict, state: RuntimeState, character?: CharacterContext): string | null {
  const activation = mechanics.activation as Dict | undefined;
  const minimumCapacity=activation?.requires_attunement_capacity;
  if(minimumCapacity!==undefined){
    if(!Number.isSafeInteger(minimumCapacity)||Number(minimumCapacity)<1)return 'Некорректная цена слота настройки';
    const cards=new Map([...(character?.knownCards??[]),...(character?.equippedCards??[])].map(card=>[card.id,card]));
    const capacity=attunementCapacity(state.equipment,cards,{attuned_ids:character?.attunedIds??[]},state.inventory,state.activeEffects);
    if(capacity<Number(minimumCapacity))return 'Недостаточно слотов настройки';
  }
  const when = activation?.when;
  if (when === undefined) return null;
  if (!Array.isArray(when) || !when.every(p => p && typeof p === 'object' && !Array.isArray(p))) return 'Некорректные условия действия';
  return matchesWhen(when, {state, character, activeConditions: activeConditionsOf(state)})
    ? null : 'Не выполнены условия использования действия';
}


/** Exact content identity binds a stat-block attack to its physical weapon.
 * An item merely carried in a backpack cannot satisfy a held-item requirement. */
export function heldItemRequirementIssue(mechanics: Dict, state: RuntimeState): string | null {
  const required = mechanics.requires_held_item;
  if (required === undefined) return null;
  if (typeof required !== 'string' || !required.trim()) return 'Некорректное требование удерживаемого предмета';
  if (state.equipment.main_hand !== required && state.equipment.off_hand !== required) {
    return 'Для этой атаки нужно держать соответствующее оружие';
  }
  // Equipment stores the held physical instance; inventory stores bag contents
  // only. Requiring a second copy in the bag makes armed monsters appear
  // disarmed and incorrectly blocks the same stat-block attacks for players.
  return null;
}
