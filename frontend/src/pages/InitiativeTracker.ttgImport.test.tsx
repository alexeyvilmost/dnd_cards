// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import InitiativeTracker from './InitiativeTracker';
import { createEmptyCharacter } from '../types/initiative';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const adapterPayload = {
  slug: 'skeleton-mm',
  source_url: 'https://new.ttg.club/bestiary?detail=skeleton-mm',
  name: 'Скелет',
  ac: 14,
  max_hp: 13,
  initiative_bonus: 3,
  actions: [{
    kind: 'action',
    name: 'Короткий меч',
    description: ['{@i Бросок рукопашной атаки:} {@roll +5|notation:1d20+5}.', '{@i Попадание:} 6 ({@roll 1к6 + 3}) урона.'],
  }],
  statblock: {
    speed: '30 фт.',
    vulnerabilities: 'дробящий',
    abilities: { dex: { score: 16, mod: 3, save: 3 } },
  },
};

function changeInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('/initiative', () => {
  let container: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    localStorage.clear();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    root = null;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
    document.body.replaceChildren();
  });

  it('resets every initiative and the turn, keeps participants intact, and saves the reset', async () => {
    const characters = [
      createEmptyCharacter({ name: 'Ада', type: 'player', initiative: 17, initiativeBonus: 3, currentHp: 7, notes: 'Щит' }),
      createEmptyCharacter({ name: 'Скелет', initiative: -1, initiativeBonus: -2, currentHp: 0, description: 'Короткий меч' }),
    ];
    const before = { characters, activeIndex: 1, round: 4 };
    const storageKey = 'initiative-tracker-v1';
    localStorage.setItem(storageKey, JSON.stringify(before));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    await act(async () => root?.render(<InitiativeTracker />));
    const reset = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Сбросить инициативу');
    expect(reset?.disabled).toBe(false);

    await act(async () => reset!.click());
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual(before);

    await act(async () => reset!.click());
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual({
      characters: characters.map((character) => ({ ...character, initiative: 0 })),
      activeIndex: 0,
      round: 1,
    });
    expect(container.textContent).toContain('раунд 1');
    await act(async () => root?.unmount());
    root = createRoot(container);
    await act(async () => root?.render(<InitiativeTracker />));
    expect(container.textContent).toContain('раунд 1');
    expect(Array.from(container.querySelectorAll<HTMLInputElement>('input[placeholder="Имя"]'), (input) => input.value))
      .toEqual(['Ада', 'Скелет']);
  });

  it('imports a current canonical TTG link into persisted initiative state', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(adapterPayload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    await act(async () => root?.render(<InitiativeTracker />));

    const input = container.querySelector<HTMLInputElement>(
      'input[placeholder="https://new.ttg.club/bestiary/skeleton-mm"]',
    );
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find((candidate) => candidate.textContent?.includes('Импорт с ttg.club'));
    expect(input).not.toBeNull();
    expect(button).not.toBeUndefined();

    await act(async () => {
      changeInput(input!, 'https://new.ttg.club/bestiary?detail=skeleton-mm');
    });
    await act(async () => {
      button!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('initiative-tracker-v1') ?? '{}') as {
        characters?: Array<Record<string, unknown>>;
      };
      expect(saved.characters).toHaveLength(1);
      expect(saved.characters?.[0]).toMatchObject({
        name: 'Скелет', type: 'monster', ac: 14, maxHp: 13, currentHp: 13,
        initiativeBonus: 3,
      });
      expect(String(saved.characters?.[0]?.description)).toContain('Короткий меч');
      expect(String(saved.characters?.[0]?.description)).toContain('1к6 + 3');
      expect(saved.characters?.[0]?.statblock).toMatchObject({ speed: '30 фт.', vulnerabilities: 'дробящий' });
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/integrations\/ttg\/bestiary\/skeleton-mm$/),
      { headers: { Accept: 'application/json' } },
    );
    expect(container.querySelector<HTMLInputElement>('input[placeholder="Имя"]')?.value).toBe('Скелет');
    expect(container.textContent).toContain('КД 14');
  });
});
