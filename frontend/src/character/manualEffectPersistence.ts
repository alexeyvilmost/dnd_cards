import { canonicalStringify } from '../rules-core/determinism';
import { charactersV3Api } from './api';
import {
  assertManualEffectMutationAllowed,
  ONLINE_ENCOUNTER_MANUAL_EFFECT_BLOCK_REASON,
} from './manualEffectMutationPolicy';
import { isCharacterReadOnly, type ForgeCharacter } from './types';

export const MANUAL_EFFECT_RUNTIME_REVISION_REASON =
  'Ручное изменение эффектов требует актуальную server runtime_revision.';

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
  const updated = await charactersV3Api.patchRuntime(character.id, {
    expected_runtime_revision: Number(expectedRevision),
    active_effects: expectedEffects,
  });

  if (updated.current_encounter_id) {
    throw new Error(ONLINE_ENCOUNTER_MANUAL_EFFECT_BLOCK_REASON);
  }
  if (updated.id !== character.id
    || updated.runtime_revision !== Number(expectedRevision) + 1
    || canonicalStringify(updated.active_effects ?? []) !== canonicalStringify(expectedEffects)) {
    throw new Error('Сервер не подтвердил точную CAS-запись ручных эффектов.');
  }
  return updated;
}
