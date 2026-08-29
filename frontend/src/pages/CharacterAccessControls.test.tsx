// @vitest-environment jsdom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ForgeCharacter } from '../character/types';
import CharactersForgeList from './CharactersForgeList';
import MobileCharactersPage from '../mobile/MobileCharactersPage';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('../character/api', () => ({
  charactersV3Api: {
    list: mocks.list,
    listPreviews: mocks.list,
    create: mocks.create,
    remove: mocks.remove,
  },
  characterV3ErrorMessage: (_error: unknown, fallback: string) => fallback,
}));

vi.mock('../api/client', () => ({
  racesApi: { getRaces: vi.fn(async () => ({ races: [] })) },
  classesApi: { getClasses: vi.fn(async () => ({ classes: [] })) },
}));

const legacyCharacter = {
  id: 'legacy-character',
  user_id: 'public-user',
  name: 'Архивный герой',
  system_id: 'dnd5e-2024',
  ruleset_version: '2024',
  character_type: 'free',
  character_schema_version: 1,
  level: 1,
  max_hp: 10,
  current_hp: 7,
  speed: 30,
  proficiency_bonus: 2,
  access_mode: 'legacy_public_readonly',
  created_at: '',
  updated_at: '',
} satisfies ForgeCharacter;

describe('CharacterV3 read-only list controls', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.list.mockResolvedValue([legacyCharacter]);
    mocks.create.mockReset();
    mocks.remove.mockReset();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
    vi.clearAllMocks();
  });

  async function render(page: ReactNode) {
    await act(async () => {
      root.render(<MemoryRouter>{page}</MemoryRouter>);
    });
    await vi.waitFor(() => expect(container.textContent).toContain('Архивный герой'));
  }

  it('desktop shows the badge and no delete control', async () => {
    await render(<CharactersForgeList />);

    expect(container.textContent).toContain('Архивный публичный лист · только чтение');
    expect(container.querySelector('[title="Удалить персонажа"]')).toBeNull();
  });

  it('mobile exposes clone-as-owned but no edit, level-up, or delete actions', async () => {
    await render(<MobileCharactersPage />);
    const menuButton = container.querySelector<HTMLButtonElement>('[aria-label="Действия: Архивный герой"]');
    expect(menuButton).not.toBeNull();

    await act(async () => menuButton?.click());

    expect(container.textContent).toContain('Создать мою копию');
    expect(container.textContent).not.toContain('Редактировать');
    expect(container.textContent).not.toContain('Повысить уровень');
    expect(container.textContent).not.toContain('Удалить');
  });
});
