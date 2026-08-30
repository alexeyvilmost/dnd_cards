import { bindEquippedWeaponActionContext } from '../engine/weapon';
import type { Card } from '../types';
import type { SheetAction } from './actionSheet';
import { sheetActionNeedsCanonicalRuntime } from './sheetPrimitiveUi';
import { materializeDeclaredMechanicsTargeting } from '../rules-core/actionTargeting';
import { applyUnarmedDamageProfileToAction } from '../rules-core/fightingStyleComplexPrimitives';

export interface RunnableSheetCanonicalActionProjection {
  actions: SheetAction[];
  issues: ReadonlyMap<string, string>;
}

const TARGETLESS_ACTOR_CONTRACT = {
  shape: 'single',
  domain: 'world',
  actor_targets: false,
  min_targets: 0,
  max_targets: 0,
  range_ft: 0,
  requires_line_of_sight: false,
  allowed_relations: [],
} as const;

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * collectSheetActions already rejects active rows without an explicit cost.
 * Repeat that executable-data contract here because this projector is also a
 * public boundary used by tests and other adapters.
 */
function isDeclaredActiveAction(mechanics: Record<string, unknown>): boolean {
  const activation = object(mechanics.activation);
  return activation?.mode === 'active'
    && Array.isArray(activation.cost)
    && Array.isArray(mechanics.effects);
}

/** Whether the mechanics declaration needs a concrete actor target. */
function declaresActorInteraction(mechanics: Record<string, unknown>): boolean {
  const effects = Array.isArray(mechanics.effects) ? mechanics.effects : [];
  return effects.some((candidate) => {
    const effect = object(candidate);
    if (!effect) return false;
    if (effect.who === 'target') return true;
    if (effect.resolution === 'attack_roll') return true;
    if (effect.resolution === 'save' && effect.who !== 'self') return true;
    const result = Array.isArray(effect.result) ? effect.result : [];
    return result.some((payload) => object(payload)?.who === 'target');
  });
}

/**
 * Adapt target-independent active mechanics to an explicit zero-actor-target
 * contract. This is a semantic adapter, not content identity logic: the
 * declaration is inferred only when effects contain no target interaction.
 */
function canonicalMechanics(action: SheetAction): Record<string, unknown> {
  // SheetAction carries a legacy presentation-only `name` field so the old
  // executor can label its journal events. It is not part of immutable entity
  // mechanics and must never enter the rules catalog or its certification hash.
  // A few older immutable Action rows do explicitly declare mechanics.name;
  // preserve those exact reviewed bytes and remove only the UI-added copy.
  const immutableMechanics = action.actionRef?.mechanics
    ?? action.effectRef?.mechanics
    ?? action.spellRef?.mechanics;
  const immutableDeclaresName = Object.prototype.hasOwnProperty.call(
    immutableMechanics ?? {},
    'name',
  );
  const { name: _presentationName, ...mechanicsWithoutPresentationName } = action.mechanics;
  const mechanics = immutableDeclaresName
    ? action.mechanics
    : mechanicsWithoutPresentationName;
  if (mechanics.targeting !== undefined) {
    return materializeDeclaredMechanicsTargeting(mechanics);
  }
  if (!isDeclaredActiveAction(mechanics)) {
    return mechanics;
  }
  if (declaresActorInteraction(mechanics)) {
    throw new Error(`${action.id} interacts with an actor but declares no mechanics.targeting`);
  }
  return { ...mechanics, targeting: TARGETLESS_ACTOR_CONTRACT };
}

/**
 * Materialize only actor-runnable canonical actions. Contextual weapon actions
 * whose declared hand is unavailable remain visible in the ordinary sheet UI,
 * but never enter an executable actor capability set with an unbound profile.
 * Spell rows also carry the complete spellbook/preparation provenance needed
 * to certify access, even when that spell still uses the legacy executor.
 */
export function projectRunnableSheetCanonicalActions(input: {
  actions: readonly SheetAction[];
  equipment: Readonly<Record<string, string | null | undefined>>;
  cards: ReadonlyMap<string, Card>;
  passives?: readonly unknown[];
}): RunnableSheetCanonicalActionProjection {
  const actions: SheetAction[] = [];
  const issues = new Map<string, string>();
  const cards = new Map(input.cards);
  for (const action of input.actions) {
    const carriesSpellAccess = action.group === 'spell' && action.spellRef !== undefined;
    const declaredActive = isDeclaredActiveAction(action.mechanics);
    if (!carriesSpellAccess
      && !declaredActive
      && !sheetActionNeedsCanonicalRuntime(action.mechanics)) continue;
    try {
      const mechanics = bindEquippedWeaponActionContext(
        canonicalMechanics(action),
        input.equipment,
        cards,
      );
      const heldCards = (['main_hand', 'off_hand'] as const)
        .flatMap((slot) => {
          const cardId = input.equipment[slot];
          return cardId && cards.get(cardId) ? [cards.get(cardId)!] : [];
        });
      const profiled = applyUnarmedDamageProfileToAction(
        { ...action, mechanics },
        input.passives ?? [],
        {
          holdingWeaponOrShield: heldCards.some((card) => (
            card.type === 'weapon' || card.type === 'shield' || card.defense_type === 'shield'
          )),
        },
      );
      actions.push({
        ...profiled,
        mechanics: profiled.mechanics,
        ...(action.actionRef && profiled.mechanics !== mechanics
          ? { actionRef: { ...action.actionRef, mechanics: profiled.mechanics } }
          : {}),
        // Spell compilation intentionally starts from the immutable entity
        // reference to preserve grant provenance. Carry the same normalized
        // runtime copy there so it cannot bypass this compatibility boundary.
        ...(action.spellRef
          ? { spellRef: { ...action.spellRef, mechanics: profiled.mechanics } }
          : {}),
      });
    } catch (cause) {
      issues.set(action.id, cause instanceof Error ? cause.message : String(cause));
    }
  }
  return { actions, issues };
}
