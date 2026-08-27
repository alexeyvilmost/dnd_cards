// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanTtgMarkup,
  importFromTtgClubUrl,
  isTtgClubBestiaryUrl,
  parseTtgClubBestiaryUrl,
  TtgImportError,
} from './ttgClubBestiary';

const adapterPayload = {
  slug: 'skeleton-mm',
  source_url: 'https://new.ttg.club/bestiary?detail=skeleton-mm',
  name: 'Скелет',
  ac: 14,
  max_hp: 13,
  initiative_bonus: 3,
  actions: [
    {
      kind: 'action',
      name: 'Короткий меч',
      description: [
        '{@i Бросок рукопашной атаки:} {@roll +5|notation:1d20+5}.',
        '{@i Попадание:} 6 ({@roll 1к6 + 3}) колющего урона.',
      ],
    },
    {
      kind: 'reaction',
      name: 'Защита',
      description: ['Скелет получает +2 КД.'],
    },
  ],
  statblock: {
    speed: '30 фт.',
    senses: 'тёмное зрение 60 фт.',
    vulnerabilities: 'дробящий',
    abilities: {
      dex: { score: 16, mod: 3, save: 3 },
      cha: { score: 5, mod: -3, save: -3 },
    },
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ttgClubBestiary URL boundary', () => {
  it('accepts both legacy presentation links and current canonical query links', () => {
    expect(parseTtgClubBestiaryUrl('https://new.ttg.club/bestiary/skeleton-mm').slug).toBe('skeleton-mm');
    expect(parseTtgClubBestiaryUrl('ttg.club/bestiary/skeleton-mm/').slug).toBe('skeleton-mm');
    expect(parseTtgClubBestiaryUrl('https://new.ttg.club/bestiary?detail=skeleton-mm').slug).toBe('skeleton-mm');
    expect(isTtgClubBestiaryUrl('https://next.dnd.su/bestiary/21552-skeleton/')).toBe(false);
    expect(isTtgClubBestiaryUrl('https://new.ttg.club/bestiary?detail=../secrets')).toBe(false);
  });

  it('keeps roll and linked-item values when cleaning markup', () => {
    expect(cleanTtgMarkup('{@i Попадание:} 6 ({@roll 1к6 + 3}) урона')).toBe(
      'Попадание: 6 (1к6 + 3) урона',
    );
    expect(cleanTtgMarkup('{@roll +5|notation:1d20+5}')).toBe('+5');
    expect(cleanTtgMarkup('{@item Короткий меч|url:shortsword-phb}')).toBe('Короткий меч');
  });
});

describe('ttgClubBestiary structured adapter', () => {
  it('imports a validated statblock without losing action bodies', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(adapterPayload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await importFromTtgClubUrl('https://new.ttg.club/bestiary/skeleton-mm');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/integrations\/ttg\/bestiary\/skeleton-mm$/),
      { headers: { Accept: 'application/json' } },
    );
    expect(result).toMatchObject({ name: 'Скелет', ac: 14, maxHp: 13, initiativeBonus: 3 });
    expect(result.description).toContain('Короткий меч');
    expect(result.description).toContain('+5');
    expect(result.description).toContain('1к6 + 3');
    expect(result.description).toContain('Реакция: Защита');
    expect(result.description).not.toContain('{@');
    expect(result.statblock.abilities?.cha).toEqual({ score: 5, mod: -3, save: -3 });
  });

  it('reports upstream and schema failures as distinct error kinds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      code: 'ttg_not_found', error: 'not found',
    }), { status: 404 })));
    await expect(importFromTtgClubUrl('https://new.ttg.club/bestiary/missing-mm')).rejects.toMatchObject({
      name: 'TtgImportError', kind: 'upstream',
    } satisfies Partial<TtgImportError>);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      ...adapterPayload, ac: '14',
    }), { status: 200 })));
    await expect(importFromTtgClubUrl('https://new.ttg.club/bestiary/skeleton-mm')).rejects.toMatchObject({
      name: 'TtgImportError', kind: 'schema',
    } satisfies Partial<TtgImportError>);
  });
});
