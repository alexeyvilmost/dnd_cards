// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Monster } from '../monsters/types';
import { monstersApi } from '../monsters/api';
import { charactersV3Api } from '../character/api';
import type { ForgeCharacterPreview } from '../character/types';
import SoloCombatSetupDialog from './SoloCombatSetupDialog';

vi.mock('../monsters/api', () => ({
  monstersApi: { list: vi.fn() },
}));
vi.mock('../character/api', () => ({
  charactersV3Api: { listPreviews: vi.fn() },
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const monster = {
  id: 'c1000000-0000-4000-8000-000000000001', slug: 'goblin-warrior', name: 'Гоблин-воин',
  description: '', size: 'small', creature_type: 'fey', alignment: '', challenge_rating: '1/4',
  armor_class: 15, max_hp: 10, speed: 30, initiative_bonus: 2, proficiency_bonus: 2,
  abilities: { str: 8, dex: 15, con: 10, int: 10, wis: 8, cha: 8 },
  action_ids: ['b1000000-0000-4000-8000-000000000001'], effect_ids: [],
  ai: { strategy: 'melee_chase' }, token_url: '', source: 'SRD 5.2.1', created_at: '', updated_at: '',
} satisfies Monster;

const ally = {
  id: '22222222-2222-4222-8222-222222222222', name: 'Бард-помощник', avatar_url: '',
  system_id: 'dnd5e-2024', ruleset_version: '2024', character_type: 'free',
  race_id: null, class_id: null, level: 2, max_hp: 16, current_hp: 14,
  current_encounter_id: null, access_mode: 'owner',
} satisfies ForgeCharacterPreview;

describe('SoloCombatSetupDialog sheet entry flow', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.mocked(monstersApi.list).mockResolvedValue({ monsters: [monster], total: 1, page: 1, limit: 100 });
    vi.mocked(charactersV3Api.listPreviews).mockResolvedValue([ally]);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it('loads opponents and owned ally previews, then returns both selections to combat', async () => {
    const onStart = vi.fn();
    await act(async () => {
      root.render(<SoloCombatSetupDialog characterName="Лучник-дварф" characterId="11111111-1111-4111-8111-111111111111" onClose={() => undefined} onStart={onStart} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain('Противники для Лучник-дварф');
    expect(container.textContent).toContain('КЗ 15 · 10 HP');
    expect(container.textContent).toContain('Бард-помощник');
    const start = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('Начать бой'))!;
    expect(start.disabled).toBe(true);
    const plus = [...container.querySelectorAll('button')].find((button) => button.querySelector('.lucide-plus'))!;
    await act(async () => plus.click());
    const invite = container.querySelector<HTMLButtonElement>('[aria-label="Пригласить союзника Бард-помощник"]')!;
    await act(async () => invite.click());
    expect(start.disabled).toBe(false);
    await act(async () => start.click());
    expect(onStart).toHaveBeenCalledWith({
      opponents: [{ monster, quantity: 1 }],
      allyId: ally.id,
    });
  });
});
