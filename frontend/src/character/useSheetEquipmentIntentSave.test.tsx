// @vitest-environment jsdom
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {ApiRequestError} from '../api/client';
import type {CharacterEquipmentIntentRequest, CharacterRuntimeCommandResponse} from './api';
import type {ForgeCharacter} from './types';
import {pendingEquipmentKey, useSheetEquipmentSave, type SheetEquipmentSaveInput} from './useSheetEquipmentSave';

(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
const characterId = '11111111-1111-4111-8111-111111111111';
const intent: CharacterEquipmentIntentRequest = {
  kind: 'equipment_intent', character_id: characterId, command_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  expected_runtime_revision: 7, roguelike_run_id: '22222222-2222-4222-8222-222222222222',
  expected_run_revision: 4, operation: {equip: '33333333-3333-4333-8333-333333333333'},
};
const character = (revision: number) => ({id: characterId, runtime_revision: revision}) as ForgeCharacter;
const receipt: CharacterRuntimeCommandResponse = {command_id: intent.command_id, replayed: true,
  participants: [{character_id: characterId, runtime_revision: 8, character: character(8)}]};
type Input = SheetEquipmentSaveInput<CharacterEquipmentIntentRequest>;
let session: ReturnType<typeof useSheetEquipmentSave<CharacterEquipmentIntentRequest>>;
function Harness({input}: {input: Input}) { session = useSheetEquipmentSave(input); return null; }

describe('identity-only equipment intent recovery', () => {
  let root: Root, container: HTMLDivElement;
  beforeEach(() => {
    localStorage.clear(); container = document.createElement('div'); document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {await act(async () => root.unmount()); container.remove();});
  const render = async (input: Input) => {await act(async () => root.render(<Harness input={input}/>));};

  it('replays a lost response after reload without preparing another intent and uses the newer saved state', async () => {
    const commit = vi.fn().mockRejectedValueOnce(new ApiRequestError('Lost response')).mockResolvedValue(receipt);
    const input: Input = {characterId, disabled: false, prepare: vi.fn(async () => intent), commit,
      loadCurrent: vi.fn(async () => character(11)), onUpdated: vi.fn()};
    await render(input);
    await act(async () => {await session.save(intent.operation);});
    expect(JSON.parse(localStorage.getItem(pendingEquipmentKey(characterId))!)).toEqual(intent);
    expect(session.pending).toEqual(intent);
    await act(async () => root.unmount()); root = createRoot(container);
    await render(input);
    expect(commit.mock.calls).toEqual([[intent], [intent]]);
    expect(input.prepare).toHaveBeenCalledOnce();
    expect(input.onUpdated).toHaveBeenCalledExactlyOnceWith(character(11));
    expect(localStorage.getItem(pendingEquipmentKey(characterId))).toBeNull();
  });

  it('keeps its identity while execution is disabled and validates the eventual receipt before clearing it', async () => {
    localStorage.setItem(pendingEquipmentKey(characterId), JSON.stringify(intent));
    const commit = vi.fn().mockRejectedValueOnce(new ApiRequestError('Temporarily disabled', 503))
      .mockResolvedValueOnce({...receipt, command_id: characterId}).mockResolvedValue(receipt);
    const input: Input = {characterId, disabled: false, prepare: vi.fn(async () => intent), commit,
      loadCurrent: vi.fn(async () => character(9)), onUpdated: vi.fn()};
    await render(input);
    expect(session.pending).toEqual(intent);
    await act(async () => {await session.save();});
    expect(session.pending).toEqual(intent);
    expect(input.onUpdated).not.toHaveBeenCalled();
    await act(async () => {await session.save();});
    expect(commit.mock.calls).toEqual([[intent], [intent], [intent]]);
    expect(input.prepare).not.toHaveBeenCalled();
    expect(input.onUpdated).toHaveBeenCalledExactlyOnceWith(character(9));
    expect(session.pending).toBeNull();
  });
});
