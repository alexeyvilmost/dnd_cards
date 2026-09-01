import { collectInPlayActionChoices, type PendingChoice } from '../mechanics/collectChoices';
import type { ActorState, RuleActionDefinition } from '../rules-core/domain';
import { parseDeclaredWeaponActionPolicy } from '../rules-core/weaponActionPolicies';
import { weaponContext } from '../engine/weapon';
import { weaponMasteryPrimitive } from '../engine/weaponMastery2024';

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

/** Every one-shot choice required by a combat-hotbar action, from data only. */
export function collectSoloCombatActionChoices(
  actor: ActorState,
  action: RuleActionDefinition,
  cardNumber?: string,
): PendingChoice[] {
  const choices = [
    ...unarmedStrikeChoices(action, cardNumber),
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

/**
 * Resolve actions that do not need a map click. A declared zero-target action
 * executes with an empty actor-target list; self-shaped actions name the
 * acting actor. null means the tactical map still owns target selection.
 */
export function immediateSoloCombatTargetIds(
  action: RuleActionDefinition,
  actorId: string,
): string[] | null {
  if (action.targeting?.maxTargets === 0) return [];
  const needsMapDestination = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(needsMapDestination);
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    if (record.kind === 'movement' && record.value === 'teleport') return true;
    return Object.values(record).some(needsMapDestination);
  };
  if (needsMapDestination(action.mechanics.effects)) return null;
  const targeting = action.mechanics.targeting;
  if (targeting && typeof targeting === 'object' && !Array.isArray(targeting)
    && (targeting as Record<string, unknown>).shape === 'self') {
    return [actorId];
  }
  return null;
}
