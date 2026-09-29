import { describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../api/client';
import type { CharacterRuntimeCommandRequest, CharacterRuntimeCommandResponse } from './api';
import { commitSheetEquipmentRequest } from './sheetEquipmentCommit';
import type { ForgeCharacter } from './types';

const characterId = '11111111-1111-4111-8111-111111111111';
const request: CharacterRuntimeCommandRequest = {
  command_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  ruleset_ref: { system_id: 'dnd5e-2024', release_id: 'micro-mvp',
    content_hash: `sha256:${'a'.repeat(64)}`, errata_version: '2024.1' },
  participants: [{ character_id: characterId, expected_runtime_revision: 1,
    patch: { equipment: { body: '22222222-2222-4222-8222-222222222222' } } }],
  events: [],
};
const character = { id: characterId, runtime_revision: 2 } as ForgeCharacter;
const receipt: CharacterRuntimeCommandResponse = {
  command_id: request.command_id,
  replayed: true,
  participants: [{ character_id: characterId, runtime_revision: 2, character }],
};

function attempt(commit: () => Promise<CharacterRuntimeCommandResponse>,
  loadCurrent: () => Promise<ForgeCharacter> = async () => character) {
  const onDefinitiveRejection = vi.fn();
  return {
    onDefinitiveRejection,
    result: commitSheetEquipmentRequest({ request, commit, loadCurrent,
      viewingCharacterId: characterId, onDefinitiveRejection }),
  };
}

describe('pending equipment command retention', () => {
  it.each([409, 413])('releases the old command after a definitive POST rejection (%s)', async (status) => {
    const rejected = attempt(async () => { throw new ApiRequestError('command rejected', status); });
    await expect(rejected.result).rejects.toThrow('command rejected');
    expect(rejected.onDefinitiveRejection).toHaveBeenCalledOnce();
  });

  it.each([undefined, 408, 425, 429, 503])('retains the command on an uncertain POST outcome (%s)', async (status) => {
    const uncertain = attempt(async () => { throw new ApiRequestError('uncertain', status); });
    await expect(uncertain.result).rejects.toThrow('uncertain');
    expect(uncertain.onDefinitiveRejection).not.toHaveBeenCalled();
  });

  it('retains an accepted command if the replay state cannot be refetched', async () => {
    const accepted = attempt(async () => receipt,
      async () => { throw new ApiRequestError('refetch forbidden', 403); });
    await expect(accepted.result).rejects.toThrow('refetch forbidden');
    expect(accepted.onDefinitiveRejection).not.toHaveBeenCalled();
  });

  it('retains an accepted command if its receipt fails validation', async () => {
    const accepted = attempt(async () => ({ ...receipt, command_id: characterId }));
    await expect(accepted.result).rejects.toThrow('different command id');
    expect(accepted.onDefinitiveRejection).not.toHaveBeenCalled();
  });
});
