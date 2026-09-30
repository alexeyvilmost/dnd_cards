// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../api/client';
import type { CharacterRuntimeCommandRequest, CharacterRuntimeCommandResponse } from './api';
import type { ForgeCharacter } from './types';
import { pendingEquipmentKey, useSheetEquipmentSave } from './useSheetEquipmentSave';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const firstId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const itemId = '33333333-3333-4333-8333-333333333333';
const commandId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function request(characterId = firstId): CharacterRuntimeCommandRequest {
  return {
    command_id: commandId,
    ruleset_ref: { system_id: 'dnd5e-2024', release_id: 'test',
      content_hash: `sha256:${'a'.repeat(64)}`, errata_version: '2024' },
    participants: [{ character_id: characterId, expected_runtime_revision: 1,
      patch: { equipment: { body: itemId }, resources: { action: 1 } } }],
    events: [],
  };
}
function character(characterId = firstId, revision = 2): ForgeCharacter {
  return { id: characterId, runtime_revision: revision, equipment: { body: itemId },
    resources: { action: 1 } } as unknown as ForgeCharacter;
}
function receipt(value = request(), replayed = false): CharacterRuntimeCommandResponse {
  const characterId = value.participants[0].character_id;
  return { command_id: value.command_id, replayed, participants: [{ character_id: characterId,
    runtime_revision: 2, character: character(characterId) }] };
}

type Input = Parameters<typeof useSheetEquipmentSave>[0];
let session: ReturnType<typeof useSheetEquipmentSave>;
function Harness({ input }: { input: Input }) {
  session = useSheetEquipmentSave(input);
  return <div>{session.pending ? 'pending' : 'ready'}{session.error}</div>;
}
function input(overrides: Partial<Input> = {}): Input {
  return { characterId: firstId, disabled: false, prepare: vi.fn(async () => request()),
    commit: vi.fn(async value => receipt(value)), loadCurrent: vi.fn(async id => character(id)),
    onUpdated: vi.fn(), ...overrides };
}

describe('equipment save reconciliation', () => {
  let container: HTMLDivElement;
  let root: Root;
  const render = async (value: Input) => { await act(async () => {
    root.render(<Harness key={value.characterId} input={value} />);
  }); };
  beforeEach(() => {
    localStorage.clear();
    container = document.createElement('div'); document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });

  it('recovers a lost accepted response on reload using the same transition, without another payment', async () => {
    let applications = 0;
    let currentCharges = 2;
    const applied = new Set<string>();
    const commit = vi.fn(async (value: CharacterRuntimeCommandRequest) => {
      if (!applied.has(value.command_id)) {
        applied.add(value.command_id); applications++; currentCharges--;
        throw new ApiRequestError('connection lost');
      }
      return receipt(value, true);
    });
    const value = input({ commit });
    await render(value);
    await act(async () => { await session.save({ equip: itemId }); });
    const persisted = localStorage.getItem(pendingEquipmentKey(firstId));
    expect(persisted).not.toBeNull();
    expect(session.pending?.command_id).toBe(commandId);
    await act(async () => root.unmount()); root = createRoot(container);
    await render(value);
    expect(commit).toHaveBeenCalledTimes(2);
    expect(commit.mock.calls[1][0]).toEqual(JSON.parse(persisted!));
    expect(value.prepare).toHaveBeenCalledOnce();
    expect(applications).toBe(1); expect(currentCharges).toBe(1);
    expect(value.loadCurrent).toHaveBeenCalledExactlyOnceWith(firstId);
    expect(value.onUpdated).toHaveBeenCalledExactlyOnceWith(character());
    expect(session.pending).toBeNull();
    expect(localStorage.getItem(pendingEquipmentKey(firstId))).toBeNull();
  });

  it('retains a failed automatic attempt and retries on reconnect without a loop', async () => {
    localStorage.setItem(pendingEquipmentKey(firstId), JSON.stringify(request()));
    const commit = vi.fn().mockRejectedValueOnce(new ApiRequestError('offline', 503))
      .mockResolvedValue(receipt(request(), true));
    const value = input({ commit });
    await render(value); await render({ ...value });
    expect(commit).toHaveBeenCalledOnce(); expect(session.pending).not.toBeNull();
    await act(async () => window.dispatchEvent(new Event('online')));
    expect(commit).toHaveBeenCalledTimes(2); expect(session.pending).toBeNull();
    expect(value.prepare).not.toHaveBeenCalled();
  });

  it('releases a definitively rejected stale request and refreshes before another choice', async () => {
    localStorage.setItem(pendingEquipmentKey(firstId), JSON.stringify(request()));
    const commit = vi.fn().mockRejectedValueOnce(new ApiRequestError('stale revision', 409))
      .mockResolvedValue(receipt());
    const value = input({ commit });
    await render(value);
    expect(session.pending).toBeNull(); expect(value.loadCurrent).toHaveBeenCalledWith(firstId);
    await act(async () => { await session.save({ equip: itemId }); });
    expect(value.prepare).toHaveBeenCalledOnce(); expect(commit).toHaveBeenCalledTimes(2);
  });

  it('preserves an accepted request when its receipt cannot be validated', async () => {
    localStorage.setItem(pendingEquipmentKey(firstId), JSON.stringify(request()));
    const value = input({ commit: vi.fn(async () => ({ ...receipt(), command_id: secondId })) });
    await render(value);
    expect(session.pending).toEqual(request());
    expect(localStorage.getItem(pendingEquipmentKey(firstId))).not.toBeNull();
    expect(value.onUpdated).not.toHaveBeenCalled();
  });

  it('guards two immediate selections while asynchronous preparation is still running', async () => {
    let resolve!: (value: CharacterRuntimeCommandRequest) => void;
    const prepare = vi.fn(() => new Promise<CharacterRuntimeCommandRequest>(done => { resolve = done; }));
    const value = input({ prepare });
    await render(value);
    await act(async () => {
      const first = session.save({ equip: itemId });
      const second = session.save({ unequip: 'body' });
      resolve(request()); await Promise.all([first, second]);
    });
    expect(prepare).toHaveBeenCalledOnce(); expect(value.commit).toHaveBeenCalledOnce();
  });

  it('keeps pending commands scoped to their character across route switches', async () => {
    localStorage.setItem(pendingEquipmentKey(firstId), JSON.stringify(request()));
    let resolve!: (value: CharacterRuntimeCommandResponse) => void;
    const first = input({ commit: vi.fn(() => new Promise<CharacterRuntimeCommandResponse>(done => { resolve = done; })) });
    await render(first);
    const second = input({ characterId: secondId, prepare: vi.fn(async () => request(secondId)) });
    await render(second);
    expect(session.pending).toBeNull();
    await act(async () => { await session.save({ equip: itemId }); });
    expect(second.commit).toHaveBeenCalledExactlyOnceWith(request(secondId));
    await act(async () => resolve(receipt(request(), true)));
    expect(first.onUpdated).not.toHaveBeenCalled();
    expect(second.onUpdated).toHaveBeenCalledExactlyOnceWith(character(secondId));
    expect(localStorage.getItem(pendingEquipmentKey(firstId))).toBeNull();
    expect(localStorage.getItem(pendingEquipmentKey(secondId))).toBeNull();
  });

  it('reconciles only when the sheet becomes writable', async () => {
    localStorage.setItem(pendingEquipmentKey(firstId), JSON.stringify(request()));
    const value = input({ disabled: true });
    await render(value); expect(value.commit).not.toHaveBeenCalled();
    await render({ ...value, disabled: false });
    expect(value.commit).toHaveBeenCalledOnce(); expect(session.pending).toBeNull();
  });

  it('does not erase a different pending command stored by another tab during the POST', async () => {
    localStorage.setItem(pendingEquipmentKey(firstId), JSON.stringify(request()));
    let resolve!: (value: CharacterRuntimeCommandResponse) => void;
    const value = input({ commit: vi.fn(() => new Promise<CharacterRuntimeCommandResponse>(done => { resolve = done; })) });
    await render(value);
    const other = { ...request(), command_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
    localStorage.setItem(pendingEquipmentKey(firstId), JSON.stringify(other));
    await act(async () => resolve(receipt(request())));
    expect(session.pending).toEqual(other);
    expect(JSON.parse(localStorage.getItem(pendingEquipmentKey(firstId))!)).toEqual(other);
    expect(value.prepare).not.toHaveBeenCalled();
  });
});
