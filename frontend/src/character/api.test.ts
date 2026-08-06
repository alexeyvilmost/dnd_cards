// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiRequestError, apiClient } from '../api/client';
import {
  CHARACTER_V3_ACCESS_ERROR_EVENT,
  CharacterV3AccessError,
  charactersV3Api,
  withClientEventIds,
  type CharacterV3AccessErrorDetail,
  type CharacterV3Operation,
  type CharacterRuntimeCommandRequest,
  type CreateCharacterEventItem,
} from './api';
import type { ForgeCharacter, SaveForgeCharacterRequest } from './types';

const event = (clientEventId?: string): CreateCharacterEventItem => ({
  ...(clientEventId ? { client_event_id: clientEventId } : {}),
  type: 'narrative',
  payload: { type: 'narrative', text: 'Проверка' },
});

describe('withClientEventIds', () => {
  it('assigns a distinct UUID to every event missing an idempotency key', () => {
    const result = withClientEventIds([event(), event()]);

    expect(result[0].client_event_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(result[1].client_event_id).not.toBe(result[0].client_event_id);
  });

  it('preserves an explicitly supplied key for safe retries', () => {
    const id = '8f13483e-05ea-4ac2-ad21-7cdd6ba21f72';
    expect(withClientEventIds([event(id)])[0].client_event_id).toBe(id);
  });
});

const character = { id: 'character-id', name: 'Герой' } as ForgeCharacter;
const savePayload = { name: 'Герой' } as SaveForgeCharacterRequest;
const runtimeCommand: CharacterRuntimeCommandRequest = {
  command_id: '8f13483e-05ea-4ac2-ad21-7cdd6ba21f72',
  ruleset_ref: {
    system_id: 'dnd5e-2024', release_id: 'micro-mvp@test',
    content_hash: `sha256:${'a'.repeat(64)}`, errata_version: '2024.1',
  },
  participants: [{
    character_id: character.id,
    expected_runtime_revision: 2,
    patch: { current_hp: 7 },
  }],
  events: [],
};

const accessCases: ReadonlyArray<readonly [
  CharacterV3Operation,
  () => Promise<unknown>,
  string,
]> = [
  ['list', () => charactersV3Api.list(), 'Нет доступа к списку персонажей.'],
  ['get', () => charactersV3Api.get(character.id), 'Нет доступа к этому персонажу.'],
  ['create', () => charactersV3Api.create(savePayload), 'Нет прав на создание персонажа.'],
  ['update', () => charactersV3Api.update(character.id, savePayload), 'Нет прав на изменение этого персонажа.'],
  ['delete', () => charactersV3Api.remove(character.id), 'Нет прав на удаление этого персонажа.'],
  ['read_events', () => charactersV3Api.getEvents(character.id), 'Нет доступа к журналу этого персонажа.'],
  ['write_events', () => charactersV3Api.postEvents(character.id, [event()]), 'Нет прав на изменение журнала этого персонажа.'],
  ['runtime', () => charactersV3Api.patchRuntime(character.id, { current_hp: 7 }), 'Нет прав на изменение состояния этого персонажа.'],
  ['runtime_command', () => charactersV3Api.postRuntimeCommand(runtimeCommand), 'Нет прав на атомарную команду состояния.'],
];

function rejectAllRequests(error: unknown): void {
  vi.spyOn(apiClient, 'get').mockRejectedValue(error);
  vi.spyOn(apiClient, 'post').mockRejectedValue(error);
  vi.spyOn(apiClient, 'put').mockRejectedValue(error);
  vi.spyOn(apiClient, 'delete').mockRejectedValue(error);
  vi.spyOn(apiClient, 'patch').mockRejectedValue(error);
}

describe('charactersV3Api access handling', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(accessCases)('maps 401 for %s to an actionable session error', async (operation, execute) => {
    rejectAllRequests(new ApiRequestError('raw unauthorized', 401));
    const notices: CharacterV3AccessErrorDetail[] = [];
    const listener = (notice: Event) => {
      notices.push((notice as CustomEvent<CharacterV3AccessErrorDetail>).detail);
    };
    window.addEventListener(CHARACTER_V3_ACCESS_ERROR_EVENT, listener);

    try {
      await expect(execute()).rejects.toMatchObject({
        name: 'CharacterV3AccessError',
        status: 401,
        operation,
        message: 'Сессия истекла. Войдите снова и повторите действие.',
      } satisfies Partial<CharacterV3AccessError>);
      expect(notices).toEqual([{
        status: 401,
        operation,
        message: 'Сессия истекла. Войдите снова и повторите действие.',
      }]);
    } finally {
      window.removeEventListener(CHARACTER_V3_ACCESS_ERROR_EVENT, listener);
    }
  });

  it.each(accessCases)('maps 403 for %s to an operation-specific denial', async (operation, execute, message) => {
    rejectAllRequests({ response: { status: 403 } });

    await expect(execute()).rejects.toMatchObject({
      name: 'CharacterV3AccessError',
      status: 403,
      operation,
      message,
    } satisfies Partial<CharacterV3AccessError>);
  });

  it('keeps non-access failures intact', async () => {
    const networkError = new Error('network offline');
    rejectAllRequests(networkError);

    await expect(charactersV3Api.list()).rejects.toBe(networkError);
  });

  it('uses the expected list/get/create/update/delete/runtime/events routes', async () => {
    const get = vi.spyOn(apiClient, 'get')
      .mockResolvedValueOnce({ data: [character] } as never)
      .mockResolvedValueOnce({ data: character } as never)
      .mockResolvedValueOnce({ data: [] } as never);
    const post = vi.spyOn(apiClient, 'post')
      .mockResolvedValueOnce({ data: character } as never)
      .mockResolvedValueOnce({ data: [] } as never)
      .mockResolvedValueOnce({ data: {
        command_id: runtimeCommand.command_id,
        replayed: false,
        participants: [],
      } } as never);
    const put = vi.spyOn(apiClient, 'put').mockResolvedValue({ data: character } as never);
    const remove = vi.spyOn(apiClient, 'delete').mockResolvedValue({ data: null } as never);
    const patch = vi.spyOn(apiClient, 'patch').mockResolvedValue({ data: character } as never);

    await charactersV3Api.list();
    await charactersV3Api.get(character.id);
    await charactersV3Api.create(savePayload);
    await charactersV3Api.update(character.id, savePayload);
    await charactersV3Api.remove(character.id);
    await charactersV3Api.getEvents(character.id);
    await charactersV3Api.postEvents(character.id, [event('8f13483e-05ea-4ac2-ad21-7cdd6ba21f72')]);
    await charactersV3Api.patchRuntime(character.id, { current_hp: 7 });
    await charactersV3Api.postRuntimeCommand(runtimeCommand);

    expect(get).toHaveBeenNthCalledWith(1, '/api/characters-v3');
    expect(get).toHaveBeenNthCalledWith(2, '/api/characters-v3/character-id');
    expect(get).toHaveBeenNthCalledWith(3, '/api/characters-v3/character-id/events');
    expect(post).toHaveBeenNthCalledWith(1, '/api/characters-v3', savePayload);
    expect(post).toHaveBeenNthCalledWith(2, '/api/characters-v3/character-id/events', {
      events: [expect.objectContaining({
        client_event_id: '8f13483e-05ea-4ac2-ad21-7cdd6ba21f72',
      })],
    });
    expect(post).toHaveBeenNthCalledWith(
      3,
      '/api/characters-v3/runtime-commands',
      runtimeCommand,
    );
    expect(put).toHaveBeenCalledWith('/api/characters-v3/character-id', savePayload);
    expect(remove).toHaveBeenCalledWith('/api/characters-v3/character-id');
    expect(patch).toHaveBeenCalledWith('/api/characters-v3/character-id/runtime', { current_hp: 7 });
  });
});
