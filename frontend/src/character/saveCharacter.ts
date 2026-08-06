import type { PatchCharacterRuntimeRequest } from './api';
import {
  CURRENT_CHARACTER_SCHEMA_VERSION,
  DEFAULT_CHARACTER_RULESET_VERSION,
  DEFAULT_CHARACTER_SYSTEM_ID,
  DEFAULT_CHARACTER_TYPE,
  type ForgeCharacter,
  type SaveForgeCharacterRequest,
} from './types';

/**
 * Builds the in-memory runtime seed used before a create response exists.
 * It is never persisted as an entity; only its runtime projection is fed to
 * buildResourceRuntimePatch so the final POST can contain initialized pools.
 */
export function runtimeSeedFromSavePayload(
  payload: SaveForgeCharacterRequest,
): ForgeCharacter {
  return {
    ...payload,
    id: 'pending-create',
    user_id: 'pending-create',
    name: payload.name,
    system_id: payload.system_id ?? DEFAULT_CHARACTER_SYSTEM_ID,
    ruleset_version: payload.ruleset_version ?? DEFAULT_CHARACTER_RULESET_VERSION,
    character_type: payload.character_type ?? DEFAULT_CHARACTER_TYPE,
    character_schema_version: payload.character_schema_version ?? CURRENT_CHARACTER_SCHEMA_VERSION,
    level: payload.level ?? 1,
    max_hp: payload.max_hp ?? 0,
    current_hp: payload.current_hp ?? payload.max_hp ?? 0,
    speed: payload.speed ?? 30,
    proficiency_bonus: payload.proficiency_bonus ?? 2,
    access_mode: 'owner',
    created_at: '',
    updated_at: '',
  };
}

/**
 * Transport boundary used by the save orchestration. Keeping it injectable
 * makes the create/update request contract testable without mocking HTTP.
 */
export interface CharacterSaveWriter {
  create(payload: SaveForgeCharacterRequest): Promise<ForgeCharacter>;
  update(characterId: string, payload: SaveForgeCharacterRequest): Promise<ForgeCharacter>;
  patchRuntime(
    characterId: string,
    payload: PatchCharacterRuntimeRequest,
  ): Promise<ForgeCharacter>;
}

export type CharacterSaveCommand =
  | {
    mode: 'create';
    payload: SaveForgeCharacterRequest;
    initialRuntime?: PatchCharacterRuntimeRequest;
  }
  | {
    mode: 'update';
    characterId: string;
    payload: SaveForgeCharacterRequest;
    runtimePatch?: PatchCharacterRuntimeRequest;
  };

/**
 * Persists a character while preserving the create atomicity boundary:
 * creation is one request with initial runtime embedded in the body, whereas
 * an existing character may receive a subsequent partial runtime update.
 */
export async function saveCharacter(
  writer: CharacterSaveWriter,
  command: CharacterSaveCommand,
): Promise<ForgeCharacter> {
  if (command.mode === 'create') {
    return writer.create({
      ...command.payload,
      ...command.initialRuntime,
    });
  }

  const updated = await writer.update(command.characterId, command.payload);
  if (!command.runtimePatch || Object.keys(command.runtimePatch).length === 0) {
    return updated;
  }

  return writer.patchRuntime(command.characterId, command.runtimePatch);
}
