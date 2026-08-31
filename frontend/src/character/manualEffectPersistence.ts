import { canonicalStringify } from '../rules-core/determinism';
import { migrateWorldState } from '../rules-core/worldMigration';
import { charactersV3Api } from './api';
import {
  assertManualEffectMutationAllowed,
  ONLINE_ENCOUNTER_MANUAL_EFFECT_BLOCK_REASON,
} from './manualEffectMutationPolicy';
import { isCharacterReadOnly, type ForgeCharacter } from './types';
import {
  SHEET_CANONICAL_WORLD_KEY,
  SHEET_CANONICAL_WORLD_ENVELOPE_VERSION,
  type SheetCanonicalWorldEnvelope,
} from './sheetCanonicalWorld';

export const MANUAL_EFFECT_RUNTIME_REVISION_REASON =
  'Ручное изменение эффектов требует актуальную server runtime_revision.';

export const MANUAL_EFFECT_CROSS_CHARACTER_CONCENTRATION_REASON =
  'Ручное состояние завершает концентрацию, связанную с другим персонажем. Измените состояние в общей боевой сцене.';

interface DetachedManualEffectOptions {
  /** The post-command condition projection denies the concentration capability. */
  endsConcentration?: boolean;
}

function canonicalEnvelope(
  character: ForgeCharacter,
): SheetCanonicalWorldEnvelope | null {
  const raw = character.turn_state?.[SHEET_CANONICAL_WORLD_KEY];
  if (raw === undefined) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Сохранённый канонический мир листа повреждён.');
  }
  const envelope = raw as Partial<SheetCanonicalWorldEnvelope>;
  if (envelope.schemaVersion !== SHEET_CANONICAL_WORLD_ENVELOPE_VERSION
    || envelope.primaryActorId !== character.id
    || typeof envelope.rulesetContentHash !== 'string'
    || !envelope.world) {
    throw new Error('Сохранённый канонический мир листа повреждён.');
  }
  return structuredClone(envelope) as SheetCanonicalWorldEnvelope;
}

/**
 * Keep the detached sheet's canonical execution cache aligned with the same
 * manual condition mutation that is written to CharacterV3.active_effects.
 * Concentration is source-owned in this envelope; cross-character links need
 * the combat transaction endpoint and therefore fail closed here.
 */
export function projectDetachedManualEffectsTurnState(
  character: ForgeCharacter,
  activeEffects: readonly unknown[],
  options: DetachedManualEffectOptions = {},
): Record<string, unknown> | null {
  const envelope = canonicalEnvelope(character);
  if (!envelope) return null;
  const world = migrateWorldState(envelope.world);
  const actor = world.actors[character.id];
  if (!actor) throw new Error('Канонический мир листа не содержит владельца.');

  actor.runtime.activeEffects = structuredClone([...activeEffects]) as typeof actor.runtime.activeEffects;
  const concentration = options.endsConcentration
    ? world.concentrations[character.id]
    : undefined;
  if (concentration) {
    if (concentration.effectLinks.some((link) => link.actorId !== character.id)) {
      throw new Error(MANUAL_EFFECT_CROSS_CHARACTER_CONCENTRATION_REASON);
    }
    const linkedIds = new Set(concentration.effectLinks.map((link) => link.effectId));
    actor.runtime.activeEffects = actor.runtime.activeEffects.filter((effect) => !linkedIds.has(effect.id));
    for (const [objectId, object] of Object.entries(world.objects)) {
      if (object.sourceActorId === concentration.sourceActorId
        && object.sourceActionId === concentration.actionId
        && object.dancingLight !== undefined) {
        delete world.objects[objectId];
      }
    }
    delete world.concentrations[character.id];
    if (world.pendingResolution?.type === 'concentration_save'
      && world.pendingResolution.actorId === character.id
      && world.pendingResolution.concentrationId === concentration.id) {
      world.pendingResolution = null;
    }
  }
  world.revision += 1;
  world.logicalClock += 1;
  envelope.world = migrateWorldState(world);
  return {
    ...(character.turn_state ?? {}),
    [SHEET_CANONICAL_WORLD_KEY]: envelope,
  };
}

/**
 * Persist a manual effect mutation only while CharacterV3 itself owns runtime.
 *
 * This deliberately does not use persistCharacterRuntime: that compatibility
 * helper may route protected fields into encounter Apply when a sheet becomes
 * linked after the UI snapshot was loaded. The CharacterV3 endpoint locks the
 * row and ignores active_effects once an encounter owns them; the response is
 * then checked again before any local events are accepted by the caller.
 */
export async function persistDetachedManualEffects(
  character: ForgeCharacter,
  activeEffects: readonly unknown[],
  options: DetachedManualEffectOptions = {},
): Promise<ForgeCharacter> {
  if (isCharacterReadOnly(character)) {
    throw new Error('Архивный публичный лист доступен только для чтения.');
  }
  assertManualEffectMutationAllowed(character.current_encounter_id);
  const expectedRevision = character.runtime_revision;
  if (!Number.isSafeInteger(expectedRevision) || Number(expectedRevision) < 0) {
    throw new Error(MANUAL_EFFECT_RUNTIME_REVISION_REASON);
  }

  const expectedEffects = structuredClone([...activeEffects]);
  const expectedTurnState = projectDetachedManualEffectsTurnState(
    character,
    expectedEffects,
    options,
  );
  const persistedEffects = expectedTurnState
    ? structuredClone((((expectedTurnState[SHEET_CANONICAL_WORLD_KEY] as SheetCanonicalWorldEnvelope)
      .world.actors[character.id]?.runtime.activeEffects) ?? expectedEffects))
    : expectedEffects;
  const updated = await charactersV3Api.patchRuntime(character.id, {
    expected_runtime_revision: Number(expectedRevision),
    active_effects: persistedEffects,
    ...(expectedTurnState ? { turn_state: expectedTurnState } : {}),
  });

  if (updated.current_encounter_id) {
    throw new Error(ONLINE_ENCOUNTER_MANUAL_EFFECT_BLOCK_REASON);
  }
  if (updated.id !== character.id
    || updated.runtime_revision !== Number(expectedRevision) + 1
    || canonicalStringify(updated.active_effects ?? []) !== canonicalStringify(persistedEffects)
    || (expectedTurnState && canonicalStringify(
      updated.turn_state?.[SHEET_CANONICAL_WORLD_KEY],
    ) !== canonicalStringify(expectedTurnState[SHEET_CANONICAL_WORLD_KEY]))) {
    throw new Error('Сервер не подтвердил точную CAS-запись ручных эффектов.');
  }
  return updated;
}
