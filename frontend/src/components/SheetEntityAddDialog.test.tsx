// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addManualEntities,
  loadManualEntities,
  type ManualEntity,
} from '../character/manualEntityAddition';
import type { ForgeCharacter } from '../character/types';
import SheetEntityAddDialog from './SheetEntityAddDialog';

vi.mock('../character/manualEntityAddition', async (importOriginal) => {
  const original = await importOriginal<typeof import('../character/manualEntityAddition')>();
  return {
    ...original,
    addManualEntities: vi.fn(),
    loadManualEntities: vi.fn(),
  };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const uncertifiedEntity: ManualEntity = {
  id: 'uncertified-action',
  name: 'Неподтверждённое действие',
  description: 'Для ручной проверки',
  repeatable: false,
  source: {
    id: 'uncertified-action',
    name: 'Неподтверждённое действие',
    support: { status: 'untested' },
  } as ManualEntity['source'],
};

describe('SheetEntityAddDialog uncertified entity flow', () => {
  let container: HTMLDivElement;
  let root: Root;
  const character = {
    id: '11111111-1111-4111-8111-111111111111',
    action_ids: [],
  } as unknown as ForgeCharacter;

  beforeEach(() => {
    vi.mocked(loadManualEntities).mockResolvedValue([uncertifiedEntity]);
    vi.mocked(addManualEntities).mockResolvedValue(character);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('adds an explicitly revealed uncertified entity without a second confirmation window', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    await act(async () => {
      root.render(<SheetEntityAddDialog character={character} onUpdated={() => undefined} onClose={() => undefined} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const actionsTab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((button) => button.textContent?.includes('Действия'))!;
    await act(async () => {
      actionsTab.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const showAll = container.querySelector<HTMLInputElement>('.sheet-entity-add-all input')!;
    await act(async () => showAll.click());
    const add = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('Добавить'))!;
    await act(async () => {
      add.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(confirm).not.toHaveBeenCalled();
    expect(addManualEntities).toHaveBeenCalledWith(character, 'actions', [
      { entity: uncertifiedEntity, amount: 1 },
    ]);
  });
});
