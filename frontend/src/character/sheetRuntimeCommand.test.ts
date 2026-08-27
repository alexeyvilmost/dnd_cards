import { describe, expect, it, vi } from 'vitest';
import type {
  CharacterEventRow,
  CharacterRuntimeCommandRequest,
  CharacterRuntimeCommandResponse,
} from './api';
import {
  acceptedRuntimeCommandReceipt,
  commitSheetRuntimeCommand,
  currentRuntimeCommandCharacters,
} from './sheetRuntimeCommand';
import type { ForgeCharacter } from './types';

const CHARACTER_ID = '11111111-1111-4111-8111-111111111111';
const COMMAND_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function character(revision: number, hp = 10): ForgeCharacter {
  return {
    id: CHARACTER_ID,
    user_id: 'owner',
    name: 'Tester',
    system_id: 'dnd5e-2024',
    ruleset_version: '2024',
    character_type: 'free',
    character_schema_version: 1,
    level: 1,
    max_hp: 20,
    current_hp: hp,
    speed: 30,
    proficiency_bonus: 2,
    runtime_revision: revision,
    access_mode: 'owner',
    created_at: '',
    updated_at: '',
  };
}

function request(): CharacterRuntimeCommandRequest {
  return {
    command_id: COMMAND_ID,
    ruleset_ref: {
      system_id: 'dnd5e-2024',
      release_id: 'micro-mvp',
      content_hash: `sha256:${'a'.repeat(64)}`,
      errata_version: '2024.1',
    },
    participants: [{
      character_id: CHARACTER_ID,
      expected_runtime_revision: 4,
      patch: { current_hp: 10 },
    }],
    events: [],
  };
}

function response(replayed: boolean): CharacterRuntimeCommandResponse {
  return {
    command_id: COMMAND_ID,
    replayed,
    participants: [{
      character_id: CHARACTER_ID,
      runtime_revision: 5,
      character: character(5, 10),
    }],
  };
}

describe('sheet runtime-command receipt authority', () => {
  it('uses a fresh transaction postimage without an extra fetch', async () => {
    const loadCurrent = vi.fn(async () => character(6, 7));
    await expect(currentRuntimeCommandCharacters({
      request: request(),
      response: response(false),
      loadCurrent,
    })).resolves.toEqual({ [CHARACTER_ID]: character(5, 10) });
    expect(loadCurrent).not.toHaveBeenCalled();
  });

  it('proves expected+1 from a replay receipt, then returns the latest refetched state', async () => {
    const loadCurrent = vi.fn(async () => character(6, 7));
    const current = await currentRuntimeCommandCharacters({
      request: request(),
      response: response(true),
      loadCurrent,
    });
    expect(loadCurrent).toHaveBeenCalledExactlyOnceWith(CHARACTER_ID);
    expect(current[CHARACTER_ID]).toEqual(character(6, 7));
  });

  it('rejects a forged receipt before refetch and an older refetched snapshot', async () => {
    const forged = response(true);
    forged.participants[0].runtime_revision = 6;
    const loadCurrent = vi.fn(async () => character(6));
    await expect(currentRuntimeCommandCharacters({
      request: request(), response: forged, loadCurrent,
    })).rejects.toThrow('CAS validation');
    expect(loadCurrent).not.toHaveBeenCalled();

    await expect(currentRuntimeCommandCharacters({
      request: request(),
      response: response(true),
      loadCurrent: async () => character(4),
    })).rejects.toThrow('older than its committed receipt');
    expect(() => acceptedRuntimeCommandReceipt(request(), response(true))).not.toThrow();
  });

  it('fails closed when an untyped success omits the replay marker', () => {
    const malformed = response(false) as Partial<CharacterRuntimeCommandResponse>;
    delete malformed.replayed;
    expect(() => acceptedRuntimeCommandReceipt(
      request(),
      malformed as CharacterRuntimeCommandResponse,
    )).toThrow('invalid replay marker');
  });

  it('refetches the exact transaction-owned journal once after acceptance', async () => {
    const atomicRequest = request();
    atomicRequest.events = [{
      character_id: CHARACTER_ID,
      type: 'resource_spent',
      payload: { type: 'resource_spent', resource: 'action', amount: 1, remaining: 0 },
    }, {
      character_id: CHARACTER_ID,
      type: 'effect_applied',
      payload: { type: 'effect_applied', name: 'Bless' },
    }];
    const journal: CharacterEventRow[] = [];
    let accepted = false;
    const postRuntimeCommand = vi.fn(async () => {
      const replayed = accepted;
      if (!accepted) {
        accepted = true;
        journal.push(...atomicRequest.events.map((event, index) => ({
          id: `event-${index + 1}`,
          character_id: event.character_id,
          ts: '2026-08-27T00:00:00Z',
          type: event.type,
          payload: event.payload,
        })));
      }
      return response(replayed);
    });
    const getEvents = vi.fn(async () => structuredClone(journal));
    const first = await commitSheetRuntimeCommand({
      request: atomicRequest,
      commit: postRuntimeCommand,
      loadCurrent: async () => character(5),
      viewingCharacterId: CHARACTER_ID,
      loadPersistedEvents: getEvents,
    });
    expect(postRuntimeCommand).toHaveBeenCalledTimes(1);
    expect(getEvents).toHaveBeenCalledTimes(1);
    expect(journal).toHaveLength(atomicRequest.events.length);
    expect(journal.map(({ character_id, type, payload }) => ({ character_id, type, payload })))
      .toEqual(atomicRequest.events);
    expect(first.persistedEvents).toHaveLength(atomicRequest.events.length);
  });
});
