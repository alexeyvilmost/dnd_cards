import type {
  ActionWorldInput,
  RuleActionDefinition,
  SpatialFacts,
} from '../rules-core/domain';
import type { WorldObjectState } from '../rules-core/worldObjects';
import {
  parseWorldSpellPolicy,
  type WorldSpellPolicyParseResult,
} from '../rules-core/worldSpellPolicies';
import { temporaryHpMeleeRetaliationPolicyFromMechanics } from '../rules-core/armorOfAgathys';
import {
  LIGHT_WEAPON_EXTRA_ATTACK_PRIMITIVE,
  parseDeclaredWeaponActionPolicy,
  WEAPON_ATTACK_PRIMITIVE,
} from '../rules-core/weaponActionPolicies';
import {
  FIND_FAMILIAR_CAST_PATH_CHOICE,
  FIND_FAMILIAR_FORM_CHOICE,
  FIND_FAMILIAR_SPIRIT_CHOICE,
} from '../rules-core/familiarRuntime';
import type { SheetCanonicalRuntime } from './sheetCanonicalWorld';
import type { SheetCanonicalCommandInput } from './sheetCanonicalCommand';
import {
  collectSheetSpellCastOptions,
  requireSheetSpellCastOption,
  SHEET_SPELL_CAST_CHOICE,
} from './sheetSpellCastingUi';

export const PACT_BLADE_WEAPON_CHOICE = 'pact_blade_weapon_card' as const;
export const PACT_BLADE_HAND_CHOICE = 'pact_blade_hand' as const;

export const SHEET_NO_PENDING_PRIMITIVES = [
  'pact_blade_bond',
  'find_familiar',
  'temporary_hp_melee_retaliation',
  'detect_magic_world_sensing',
  'detect_poison_disease_world',
  'light_world_object',
  'mending_world',
  'minor_illusion_world_object',
  'dancing_lights_world',
  'druidcraft_world',
  'prestidigitation_world',
  'purify_food_drink_world',
] as const;

export type SheetNoPendingPrimitive = typeof SHEET_NO_PENDING_PRIMITIVES[number];

const NO_PENDING = new Set<string>(SHEET_NO_PENDING_PRIMITIVES);

export const SHEET_PENDING_COMBAT_PRIMITIVES = [
  'burning_hands_objects',
  'area_object_push',
  'magic_missile',
  WEAPON_ATTACK_PRIMITIVE,
  LIGHT_WEAPON_EXTRA_ATTACK_PRIMITIVE,
] as const;

export type SheetPendingCombatPrimitive = typeof SHEET_PENDING_COMBAT_PRIMITIVES[number];

const PENDING_COMBAT = new Set<string>(SHEET_PENDING_COMBAT_PRIMITIVES);

export type SheetPrimitiveWorldForm =
  | 'target_object'
  | 'mending'
  | 'minor_illusion'
  | 'dancing_lights'
  | 'druidcraft'
  | 'prestidigitation'
  | 'purify_food_drink';

const WORLD_FORMS: Readonly<Partial<Record<SheetNoPendingPrimitive, SheetPrimitiveWorldForm>>> = {
  light_world_object: 'target_object',
  mending_world: 'mending',
  minor_illusion_world_object: 'minor_illusion',
  dancing_lights_world: 'dancing_lights',
  druidcraft_world: 'druidcraft',
  prestidigitation_world: 'prestidigitation',
  purify_food_drink_world: 'purify_food_drink',
};

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function sheetPrimitiveType(
  mechanics: RuleActionDefinition['mechanics'],
): string | null {
  const primitive = object(mechanics.primitive);
  const type = primitive?.type;
  return typeof type === 'string' && type.trim() ? type : null;
}

/**
 * Projection boundary for the local canonical runtime. Primitive actions and
 * explicitly declared reaction listeners enter it; unrelated legacy actions
 * stay on the legacy executor and cannot poison the certified primitive slice.
 */
export function sheetActionNeedsCanonicalRuntime(
  mechanics: RuleActionDefinition['mechanics'],
): boolean {
  if (sheetPrimitiveType(mechanics)) return true;
  const activation = object(mechanics.activation);
  const trigger = object(activation?.trigger);
  const event = trigger?.event;
  const events = trigger?.events;
  return (typeof event === 'string' && event.trim().length > 0)
    || (Array.isArray(events)
      && events.length > 0
      && events.every((candidate) => typeof candidate === 'string' && candidate.trim().length > 0));
}

export function sheetPrimitiveDisabledReason(primitiveType: string): string | null {
  if (NO_PENDING.has(primitiveType) || PENDING_COMBAT.has(primitiveType)) return null;
  return `Примитив ${primitiveType} пока не подкючён к реальному листу.`;
}

export type ValidSheetWorldSpellPolicy = Extract<
  WorldSpellPolicyParseResult,
  { status: 'valid' }
>;

export function requireSheetWorldSpellPolicy(
  action: RuleActionDefinition,
): ValidSheetWorldSpellPolicy {
  const parsed = parseWorldSpellPolicy(action.mechanics);
  if (parsed.status !== 'valid') {
    throw new Error(parsed.status === 'invalid'
      ? parsed.issue
      : `${action.id} has no managed world-spell policy`);
  }
  return parsed;
}

export function sheetPrimitiveDefinitionIssue(action: RuleActionDefinition): string | null {
  const primitive = sheetPrimitiveType(action.mechanics);
  if (!primitive) return 'Canonical primitive declaration is missing';
  const disabled = sheetPrimitiveDisabledReason(primitive);
  if (disabled) return disabled;
  if (!isSheetSupportedPrimitive(primitive)) return `Unsupported primitive ${primitive}`;
  if (primitive === WEAPON_ATTACK_PRIMITIVE
    || primitive === LIGHT_WEAPON_EXTRA_ATTACK_PRIMITIVE) {
    const parsed = parseDeclaredWeaponActionPolicy(action, 'bound');
    return parsed.status === 'valid' ? null : parsed.issue;
  }
  if (primitive === 'temporary_hp_melee_retaliation') {
    return temporaryHpMeleeRetaliationPolicyFromMechanics(
      object(action.mechanics.primitive) ?? {},
    ) ? null : `${action.id} has invalid temporary-hit-point retaliation policy`;
  }
  if ((isSheetNoPendingPrimitive(primitive) && sheetPrimitiveRequiresWorldInput(primitive))
    || primitive === 'detect_magic_world_sensing'
    || primitive === 'detect_poison_disease_world'
    || primitive === 'burning_hands_objects'
    || primitive === 'magic_missile') {
    const parsed = parseWorldSpellPolicy(action.mechanics);
    return parsed.status === 'valid'
      ? null
      : parsed.status === 'invalid'
        ? parsed.issue
        : `${action.id} has no managed world-spell policy`;
  }
  if (primitive === 'area_object_push') {
    const value = object(action.mechanics.primitive);
    if (!value
      || !Number.isFinite(value.object_push_distance_ft)
      || Number(value.object_push_distance_ft) <= 0
      || !Number.isFinite(value.object_max_distance_ft)
      || Number(value.object_max_distance_ft) <= 0
      || value.object_area_requirement !== 'entirely_in_area'
      || typeof value.exclude_secured_objects !== 'boolean'
      || typeof value.exclude_carried_objects !== 'boolean') {
      return `${action.id} has invalid data-owned area-object push policy`;
    }
  }
  return null;
}

export function isSheetNoPendingPrimitive(
  primitiveType: string,
): primitiveType is SheetNoPendingPrimitive {
  return NO_PENDING.has(primitiveType);
}

export function isSheetPendingCombatPrimitive(
  primitiveType: string,
): primitiveType is SheetPendingCombatPrimitive {
  return PENDING_COMBAT.has(primitiveType);
}

export function isSheetSupportedPrimitive(
  primitiveType: string,
): primitiveType is SheetNoPendingPrimitive | SheetPendingCombatPrimitive {
  return NO_PENDING.has(primitiveType) || PENDING_COMBAT.has(primitiveType);
}

export function sheetPrimitiveWorldForm(
  primitiveType: SheetNoPendingPrimitive,
): SheetPrimitiveWorldForm | null {
  return WORLD_FORMS[primitiveType] ?? null;
}

export function sheetPrimitiveRequiresWorldInput(
  primitiveType: SheetNoPendingPrimitive,
): boolean {
  return sheetPrimitiveWorldForm(primitiveType) !== null;
}

/** Actor picker projection derived only from the compiled targeting contract. */
export function sheetActionRequiresActorTargets(action: RuleActionDefinition): boolean {
  const targeting = action.targeting;
  if (!targeting || targeting.maxTargets <= 0) return false;
  // A compiled self action explicitly carries ['self'] for relation legality,
  // but it never asks the UI to invent/select an actor id. Any non-self
  // relation means a real actor picker is required even when the target is
  // optional (`minTargets === 0`).
  return targeting.allowedRelations.some((relation) => relation !== 'self');
}

function one(values: Readonly<Record<string, string[]>>, id: string): string {
  const selected = values[id] ?? [];
  if (selected.length !== 1 || !selected[0]) {
    throw new Error(`Sheet primitive requires exactly one ${id} choice`);
  }
  return selected[0];
}

function worldInputMatchesForm(
  form: SheetPrimitiveWorldForm,
  value: ActionWorldInput | undefined,
): boolean {
  if (!value) return false;
  return (form === 'target_object' && value.type === 'target_object')
    || (form === 'mending' && value.type === 'mending')
    || (form === 'minor_illusion' && value.type === 'minor_illusion')
    || (form === 'dancing_lights' && value.type === 'dancing_lights')
    || (form === 'druidcraft' && value.type === 'druidcraft')
    || (form === 'prestidigitation' && value.type === 'prestidigitation')
    || (form === 'purify_food_drink' && value.type === 'purify_food_drink');
}

function mechanicsChoices(
  selected: Readonly<Record<string, string[]>>,
): Record<string, string | string[]> {
  const uiOnlyChoices = new Set<string>([
    SHEET_SPELL_CAST_CHOICE,
    PACT_BLADE_WEAPON_CHOICE,
    PACT_BLADE_HAND_CHOICE,
  ]);
  return Object.fromEntries(Object.entries(selected)
    .filter(([id]) => !uiOnlyChoices.has(id))
    .map(([id, values]) => [id, values.length === 1 ? values[0] : [...values]]));
}

export interface SheetPrimitiveUiDeclaration {
  runtime: SheetCanonicalRuntime;
  action: RuleActionDefinition;
  selectedChoices: Record<string, string[]>;
  sceneMode: 'exploration' | 'encounter';
  targetIds?: string[];
  factsByTarget?: Record<string, SpatialFacts>;
  worldInput?: ActionWorldInput;
  scenarioObjects?: WorldObjectState[];
}

/** Convert UI values to the typed command declaration; rule limits remain rules-core authority. */
export function buildSheetPrimitiveCommandInput(
  input: SheetPrimitiveUiDeclaration,
): SheetCanonicalCommandInput {
  const primitive = sheetPrimitiveType(input.action.mechanics);
  if (!primitive || !isSheetSupportedPrimitive(primitive)) {
    throw new Error(primitive
      ? sheetPrimitiveDisabledReason(primitive) ?? `Unsupported primitive ${primitive}`
      : 'Canonical primitive declaration is missing');
  }
  const form = isSheetNoPendingPrimitive(primitive)
    ? sheetPrimitiveWorldForm(primitive)
    : null;
  if (form && !worldInputMatchesForm(form, input.worldInput)) {
    throw new Error(`${primitive} requires an explicit ${form} declaration`);
  }
  if (!form && input.worldInput) {
    throw new Error(`${primitive} does not accept world-object input`);
  }

  const result: SheetCanonicalCommandInput = {
    sceneMode: input.sceneMode,
    targetIds: [...(input.targetIds ?? [])],
    ...(input.factsByTarget ? { factsByTarget: input.factsByTarget } : {}),
    ...(input.worldInput ? { worldInput: input.worldInput } : {}),
    ...(input.scenarioObjects?.length ? { scenarioObjects: input.scenarioObjects } : {}),
  };
  if (primitive === 'pact_blade_bond') {
    const hand = one(input.selectedChoices, PACT_BLADE_HAND_CHOICE);
    if (hand !== 'main_hand' && hand !== 'off_hand') {
      throw new Error(`Invalid Pact Blade hand ${hand}`);
    }
    result.pactBlade = {
      mode: 'conjure',
      weaponCardId: one(input.selectedChoices, PACT_BLADE_WEAPON_CHOICE),
      hand,
    };
    return result;
  }

  const choices = mechanicsChoices(input.selectedChoices);
  if (input.action.kind === 'spell') {
    const option = requireSheetSpellCastOption(
      collectSheetSpellCastOptions({ runtime: input.runtime, action: input.action }),
      one(input.selectedChoices, SHEET_SPELL_CAST_CHOICE),
    );
    if (primitive === 'temporary_hp_melee_retaliation' && option.payment.kind === 'none') {
      throw new Error('Temporary HP retaliation requires a paid spell grant');
    }
    result.spell = option.declaration;
    if (primitive === 'find_familiar') {
      // Form and spirit remain ordinary mechanics-owned choices. The casting
      // path is a derived audit choice from the exact grant/payment selection.
      one(input.selectedChoices, FIND_FAMILIAR_FORM_CHOICE);
      one(input.selectedChoices, FIND_FAMILIAR_SPIRIT_CHOICE);
      const actor = input.runtime.world.actors[input.runtime.actorId];
      const chainAtWill = option.grant.access === 'innate'
        && actor?.warlockPacts?.chain?.template.findFamiliarActionId === input.action.id;
      choices[FIND_FAMILIAR_CAST_PATH_CHOICE] = option.declaration.mode === 'ritual'
        ? 'ritual'
        : chainAtWill ? 'pact_chain_magic_action' : 'spell_slot';
    }
  }
  if (Object.keys(choices).length) result.choices = choices;
  return result;
}
