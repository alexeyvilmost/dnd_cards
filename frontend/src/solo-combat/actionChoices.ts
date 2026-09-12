import { familiarFormLabel } from '../character/familiarLabels';
import { weaponBondProtectsHand } from '../rules-core/weaponBond';
import {heldItemDropIssue} from '../engine/heldItemDrop';
import { collectInPlayActionChoices, type PendingChoice } from '../mechanics/collectChoices';
import type { ActorState, RuleActionDefinition, WorldState } from '../rules-core/domain';
import { parseDeclaredWeaponActionPolicy } from '../rules-core/weaponActionPolicies';
import { weaponContext } from '../engine/weapon';
import { weaponMasteryPrimitive } from '../engine/weaponMastery2024';
import { FAMILIAR_ACTOR_CATALOG } from '../rules-core/familiarActorCatalog';
import {
  FIND_FAMILIAR_FORM_CHOICE,
  WILD_COMPANION_PRIMITIVE,
} from '../rules-core/familiarRuntime';
import type { SoloCombatState } from './types';
import { areaActorIds } from './tacticalGrid';

export const UNARMED_STRIKE_CHOICE_ID = 'unarmed_strike_option';

function unarmedStrikeChoices(
  action: RuleActionDefinition,
  cardNumber?: string,
): PendingChoice[] {
  if (cardNumber !== 'action_basic_unarmed') return [];
  return [{
    id: UNARMED_STRIKE_CHOICE_ID,
    prompt: 'Вариант безоружного удара',
    count: 1,
    source: 'explicit',
    context: 'in_play',
    origin: { kind: 'other', id: action.id, name: action.name },
    recommended: ['damage'],
    items: [
      { id: 'damage', name: 'Нанести урон' },
      { id: 'grapple', name: 'Схватить' },
      { id: 'shove', name: 'Толкнуть' },
    ],
  }];
}

function masteryChoices(actor: ActorState, action: RuleActionDefinition): PendingChoice[] {
  const declared = parseDeclaredWeaponActionPolicy(action, 'bound');
  const reactionHand = action.mechanics.opportunity_weapon_hand;
  const hand = declared.status === 'valid'
    ? declared.policy.hand
    : reactionHand === 'main' || reactionHand === 'off'
      ? reactionHand
      : null;
  if (!hand) return [];
  const weapon = weaponContext(
    actor.character,
    hand,
    actor.runtime.equipment,
    actor.runtime,
  );
  if (!weapon?.mastery || !weapon.weaponType
    || !actor.character.weaponMasteries?.includes(weapon.weaponType)) return [];
  const source = actor.masteryEffects?.[weapon.mastery];
  const primitive = weaponMasteryPrimitive(
    source?.mechanics && typeof source.mechanics === 'object' && !Array.isArray(source.mechanics)
      ? source.mechanics as Record<string, unknown>
      : undefined,
  );
  if (!primitive || !('choiceId' in primitive)) return [];

  const origin = {
    kind: 'other' as const,
    id: weapon.mastery,
    name: source?.name ?? action.name,
  };
  if (primitive.type === 'push') {
    const distances = Array.from(
      { length: Math.floor(primitive.maxDistanceFt / 5) },
      (_, index) => (index + 1) * 5,
    );
    return [{
      id: primitive.choiceId,
      prompt: `Дистанция: ${source?.name ?? action.name}`,
      count: 1,
      source: 'explicit',
      context: 'in_play',
      origin,
      recommended: [String(distances.at(-1) ?? '')].filter(Boolean),
      items: [
        { id: 'skip', name: 'Не применять' },
        ...distances.map((distance) => ({ id: String(distance), name: `${distance} фт.` })),
      ],
    }];
  }
  return [{
    id: primitive.choiceId,
    prompt: `Применить: ${source?.name ?? action.name}?`,
    count: 1,
    source: 'explicit',
    context: 'in_play',
    origin,
    recommended: ['use'],
    items: [
      { id: 'use', name: 'Применить' },
      { id: 'skip', name: 'Не применять' },
    ],
  }];
}

function primitiveChoices(action: RuleActionDefinition): PendingChoice[] {
  const primitive = action.mechanics.primitive;
  if (primitive && typeof primitive === 'object' && !Array.isArray(primitive)
    && (primitive as Record<string, unknown>).type === WILD_COMPANION_PRIMITIVE) {
    const forms = FAMILIAR_ACTOR_CATALOG.forms
      .filter((form) => form.eligibility === 'base_standard')
      .map((form) => ({ id: form.formId, name: familiarFormLabel(form.formId) }));
    return [{
      id: FIND_FAMILIAR_FORM_CHOICE,
      prompt: 'Форма дикого спутника',
      count: 1,
      source: 'explicit',
      context: 'in_play',
      origin: { kind: 'other', id: action.id, name: action.name },
      recommended: forms[0] ? [forms[0].id] : [],
      items: forms,
    }];
  }
  if (!primitive || typeof primitive !== 'object' || Array.isArray(primitive)
    || (primitive as Record<string, unknown>).type !== 'temporary_hp_melee_retaliation') {
    return [];
  }
  return [{
    id: 'temporary_hp',
    prompt: 'Какие временные хиты оставить?',
    count: 1,
    source: 'explicit',
    context: 'in_play',
    origin: { kind: 'other', id: action.id, name: action.name },
    recommended: ['take_spell'],
    items: [
      { id: 'take_spell', name: 'Принять временные хиты заклинания' },
      { id: 'keep_current', name: 'Сохранить текущие временные хиты' },
    ],
  }];
}

/** Every one-shot choice required by a combat-hotbar action, from data only. */
export function collectSoloCombatActionChoices(
  actor: ActorState,
  action: RuleActionDefinition,
  cardNumber?: string,
  target?: ActorState,
  world?: WorldState,
): PendingChoice[] {
  const choices = [
    ...weaponBondRecallChoices(actor, action, world),
    ...disarmingItemChoices(action,target,world),
    ...unarmedStrikeChoices(action, cardNumber),
    ...primitiveChoices(action),
    ...collectInPlayActionChoices(action.mechanics, {
      kind: 'other', id: action.id, name: action.name,
    }),
    ...masteryChoices(actor, action),
  ];
  const ids = choices.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) {
    throw new Error(`Действие ${action.id} объявляет неоднозначные игровые выборы`);
  }
  return choices;
}

/** Project dialog arrays into the exact rules-core shape required by a primitive. */
export function projectSoloCombatActionChoices(
  action: RuleActionDefinition,
  supplied: Readonly<Record<string, readonly string[]>>,
): Record<string, string | string[]> {
  const projected: Record<string, string | string[]> = Object.fromEntries(
    Object.entries(supplied).map(([id, values]) => [id, [...values]]),
  );
  const primitive = action.mechanics.primitive;
  if (primitive && typeof primitive === 'object' && !Array.isArray(primitive)
    && (primitive as Record<string, unknown>).type === 'temporary_hp_melee_retaliation') {
    const selected = projected.temporary_hp;
    if (Array.isArray(selected) && selected.length === 1) projected.temporary_hp = selected[0];
  }
  if (primitive && typeof primitive === 'object' && !Array.isArray(primitive)
    && (primitive as Record<string, unknown>).type === WILD_COMPANION_PRIMITIVE) {
    const selected = projected[FIND_FAMILIAR_FORM_CHOICE];
    if (Array.isArray(selected) && selected.length === 1) {
      projected[FIND_FAMILIAR_FORM_CHOICE] = selected[0];
    }
  }
  return projected;
}

/**
 * Resolve actions that do not need a map click. A declared zero-target action
 * executes with an empty actor-target list; self-shaped actions name the
 * acting actor. null means the tactical map still owns target selection.
 */
export function immediateSoloCombatTargetIds(
  action: RuleActionDefinition,
  actorId: string,
  state?: SoloCombatState,
): string[] | null {
  if ((action.mechanics.activation as Record<string, unknown> | undefined)?.weapon_bond_recall === true) return [actorId];
  const primitive = action.mechanics.primitive;
  if (primitive && typeof primitive === 'object' && !Array.isArray(primitive)
    && (primitive as Record<string, unknown>).type === 'owned_summon') return null;
  const needsMapDestination = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(needsMapDestination);
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    if (record.kind === 'world_zone') {
      const tactical = record.tactical && typeof record.tactical === 'object'
        && !Array.isArray(record.tactical)
        ? record.tactical as Record<string, unknown> : undefined;
      return tactical?.anchor !== 'source';
    }
    if (record.kind === 'movement' && record.value === 'teleport') return true;
    return Object.values(record).some(needsMapDestination);
  };
  if (needsMapDestination(action.mechanics.effects)) return null;
  if (action.targeting?.maxTargets === 0) return [];
  const targeting = action.mechanics.targeting;
  const area = targeting && typeof targeting === 'object' && !Array.isArray(targeting)
    ? (targeting as Record<string, unknown>).area
    : undefined;
  if (state && targeting && typeof targeting === 'object' && !Array.isArray(targeting)
    && (targeting as Record<string, unknown>).shape === 'area'
    && area && typeof area === 'object' && !Array.isArray(area)
    && (area as Record<string, unknown>).kind === 'emanation') {
    const sourcePosition = state.tokens[actorId]?.position;
    return sourcePosition ? areaActorIds({
      state,
      sourceActorId: actorId,
      aimPosition: sourcePosition,
      action,
    }).slice(0, action.targeting?.maxTargets ?? 8) : [];
  }
  if (targeting && typeof targeting === 'object' && !Array.isArray(targeting)
    && (targeting as Record<string, unknown>).shape === 'self') {
    return [actorId];
  }
  return null;
}


export function disarmingItemChoices(action:RuleActionDefinition,target?:ActorState,world?:WorldState):PendingChoice[]{
 const trigger=(action.mechanics.activation as Record<string,unknown>|undefined)?.trigger as Record<string,unknown>|undefined;
 if(!trigger?.disarm_held_item || !target)return [];
 const items=(['main_hand','off_hand'] as const).flatMap(hand=>{
  if(heldItemDropIssue(target.runtime,hand) || (world && weaponBondProtectsHand(world,target.id,hand)))return [];
  const cardId=target.runtime.equipment[hand];
  const card=target.character.knownCards?.find(row=>row.id===cardId)??target.character.equippedCards?.find(row=>row.id===cardId);
  return [{id:hand,name:card?.name??'Предмет в руке',...(card?{previewCard:card}:{})}];
 });
 return items.length?[{id:'disarm_held_item',prompt:'Какой предмет выбить из рук?',count:1,source:'explicit',context:'in_play',origin:{kind:'other',id:action.id,name:action.name},items,recommended:[items[0].id]}]:[];
}

export function weaponBondRecallChoices(actor: ActorState, action: RuleActionDefinition, world?: WorldState): PendingChoice[] {
  if ((action.mechanics.activation as Record<string,unknown> | undefined)?.weapon_bond_recall !== true || !world) return [];
  const origin = { kind: 'other' as const, id: action.id, name: action.name };
  const objects = Object.values(world.objects).filter((object) => object.weaponBondActorId === actor.id
    && (object.planeId ?? 'material') === (actor.planeId ?? 'material'));
  if (!objects.length) throw new Error('Сначала свяжите оружие во время короткого отдыха');
  if (['main_hand','off_hand'].every((hand) => actor.runtime.equipment[hand])) throw new Error('Для призыва нужна свободная рука');
  return [
    { id: 'weapon_bond_object', prompt: 'Какое оружие призвать?', count: 1, source: 'explicit', context: 'in_play', origin,
      items: objects.map((object) => ({ id: object.id, name: object.name, previewCard: actor.character.knownCards?.find((card) => card.id === object.itemCardId) })) },
    { id: 'weapon_bond_hand', prompt: 'В какую руку?', count: 1, source: 'explicit', context: 'in_play', origin,
      items: (['main_hand','off_hand'] as const).filter((hand) => !actor.runtime.equipment[hand]
        && !Object.values(world.objects).some((object) => object.heldByActorId === actor.id && object.heldInHand === hand))
        .map((hand) => ({ id: hand, name: hand === 'main_hand' ? 'Основная рука' : 'Вторая рука' })) },
  ];
}
