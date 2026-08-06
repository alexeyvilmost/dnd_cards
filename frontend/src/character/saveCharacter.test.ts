import { describe, expect, it, vi } from 'vitest';

import type { PatchCharacterRuntimeRequest } from './api';
import {
  runtimeSeedFromSavePayload,
  saveCharacter,
  type CharacterSaveWriter,
} from './saveCharacter';
import type { ForgeCharacter, SaveForgeCharacterRequest } from './types';

const payload: SaveForgeCharacterRequest = {
  name: 'Арден',
  max_hp: 9,
  current_hp: 9,
};

const initialRuntime: PatchCharacterRuntimeRequest = {
  current_hp: 8,
  resources: { second_wind: 1 },
  inventory_items: [{ card_id: 'longsword', qty: 1 }],
};

const created = { id: 'character-created', name: 'Арден' } as ForgeCharacter;
const updated = { id: 'character-existing', name: 'Арден' } as ForgeCharacter;
const runtimeUpdated = {
  ...updated,
  resources: { second_wind: 0 },
} as ForgeCharacter;

function writer(): CharacterSaveWriter & {
  create: ReturnType<typeof vi.fn<(body: SaveForgeCharacterRequest) => Promise<ForgeCharacter>>>;
  update: ReturnType<typeof vi.fn<(
    characterId: string,
    body: SaveForgeCharacterRequest,
  ) => Promise<ForgeCharacter>>>;
  patchRuntime: ReturnType<typeof vi.fn<(
    characterId: string,
    body: PatchCharacterRuntimeRequest,
  ) => Promise<ForgeCharacter>>>;
} {
  return {
    create: vi.fn(async () => created),
    update: vi.fn(async () => updated),
    patchRuntime: vi.fn(async () => runtimeUpdated),
  };
}

describe('saveCharacter', () => {
  it('builds a runtime seed from the same create payload', () => {
    expect(runtimeSeedFromSavePayload({ name: 'Арден', max_hp: 9 })).toMatchObject({
      name: 'Арден',
      current_hp: 9,
      max_hp: 9,
      access_mode: 'owner',
    });
  });

  it('creates with initial runtime in one POST body and never PATCHes', async () => {
    const saveWriter = writer();

    const result = await saveCharacter(saveWriter, {
      mode: 'create',
      payload,
      initialRuntime,
    });

    expect(result).toBe(created);
    expect(saveWriter.create).toHaveBeenCalledTimes(1);
    expect(saveWriter.create).toHaveBeenCalledWith({
      ...payload,
      ...initialRuntime,
    });
    expect(saveWriter.update).not.toHaveBeenCalled();
    expect(saveWriter.patchRuntime).not.toHaveBeenCalled();
  });

  it('propagates create rejection without PATCH or retry', async () => {
    const saveWriter = writer();
    const rejection = new Error('network unavailable');
    saveWriter.create.mockRejectedValueOnce(rejection);

    await expect(saveCharacter(saveWriter, {
      mode: 'create',
      payload,
      initialRuntime,
    })).rejects.toBe(rejection);

    expect(saveWriter.create).toHaveBeenCalledTimes(1);
    expect(saveWriter.update).not.toHaveBeenCalled();
    expect(saveWriter.patchRuntime).not.toHaveBeenCalled();
  });

  it('updates with one PUT and omits PATCH when runtime is absent or empty', async () => {
    const saveWriter = writer();

    await expect(saveCharacter(saveWriter, {
      mode: 'update',
      characterId: updated.id,
      payload,
    })).resolves.toBe(updated);
    await expect(saveCharacter(saveWriter, {
      mode: 'update',
      characterId: updated.id,
      payload,
      runtimePatch: {},
    })).resolves.toBe(updated);

    expect(saveWriter.create).not.toHaveBeenCalled();
    expect(saveWriter.update).toHaveBeenCalledTimes(2);
    expect(saveWriter.patchRuntime).not.toHaveBeenCalled();
  });

  it('updates with PUT before the optional runtime PATCH', async () => {
    const saveWriter = writer();
    const runtimePatch: PatchCharacterRuntimeRequest = {
      resources: { second_wind: 0 },
    };

    const result = await saveCharacter(saveWriter, {
      mode: 'update',
      characterId: updated.id,
      payload,
      runtimePatch,
    });

    expect(result).toBe(runtimeUpdated);
    expect(saveWriter.update).toHaveBeenCalledOnce();
    expect(saveWriter.update).toHaveBeenCalledWith(updated.id, payload);
    expect(saveWriter.patchRuntime).toHaveBeenCalledOnce();
    expect(saveWriter.patchRuntime).toHaveBeenCalledWith(updated.id, runtimePatch);
    expect(saveWriter.update.mock.invocationCallOrder[0])
      .toBeLessThan(saveWriter.patchRuntime.mock.invocationCallOrder[0]);
    expect(saveWriter.create).not.toHaveBeenCalled();
  });
});
