import { collectInPlayActionChoices, type PendingChoice } from '../mechanics/collectChoices';
import type { ActorState, RuleActionDefinition } from '../rules-core/domain';
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
  if (declared.status !== 'valid') return [];
  const weapon = weaponContext(
    actor.character,
    declared.policy.hand,
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
      .map((form) => ({ id: form.formId, name: form.name }));
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
): PendingChoice[] {
  const choices = [
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
  const needsMapDestination = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(needsMapDestination);
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    if (record.kind === 'world_zone') return true;
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
