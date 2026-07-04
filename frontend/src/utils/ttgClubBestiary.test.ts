// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cleanTtgMarkup, isTtgClubBestiaryUrl, parseTtgClubBestiaryHtml } from './ttgClubBestiary';

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/ttg-skeleton.html');

describe('ttgClubBestiary', () => {
  it('recognizes ttg.club bestiary URLs', () => {
    expect(isTtgClubBestiaryUrl('https://new.ttg.club/bestiary/skeleton-mm')).toBe(true);
    expect(isTtgClubBestiaryUrl('new.ttg.club/bestiary/skeleton-mm')).toBe(true);
    expect(isTtgClubBestiaryUrl('https://next.dnd.su/bestiary/21552-skeleton/')).toBe(false);
  });

  it('parses skeleton stat block and actions', () => {
    const html = readFileSync(fixturePath, 'utf-8');
    const result = parseTtgClubBestiaryHtml(html, 'https://new.ttg.club/bestiary/skeleton-mm');

    expect(result.name).toBe('Скелет');
    expect(result.ac).toBe(14);
    expect(result.maxHp).toBe(13);
    expect(result.description).toContain('Короткий меч');
    expect(result.description).toContain('Короткий лук');
    expect(result.description).toContain('рукопашной атаки');
    // Значения бросков и урона больше не теряются (баг «ломается описание»).
    expect(result.description).toContain('+5');
    expect(result.description).toContain('1к6 + 3');
    expect(result.description).not.toContain('{@');
    expect(typeof result.initiativeBonus).toBe('number');
  });

  it('parses the full statblock (#3)', () => {
    const html = readFileSync(fixturePath, 'utf-8');
    const { statblock } = parseTtgClubBestiaryHtml(html, 'https://new.ttg.club/bestiary/skeleton-mm');
    expect(statblock.speed).toBe('30 фт.');
    expect(statblock.cr).toContain('1/4');
    expect(statblock.senses).toContain('тёмное зрение');
    expect(statblock.vulnerabilities).toBe('дробящий');
    expect(statblock.immunities).toContain('ядовитый');
    expect(statblock.abilities?.dex).toMatchObject({ score: 16, mod: 3, save: 3 });
    expect(statblock.abilities?.cha).toMatchObject({ score: 5, mod: -3, save: -3 });
  });

  it('keeps roll/item values when cleaning markup', () => {
    expect(cleanTtgMarkup('{@i Попадание:} 6 ({@roll 1к6 + 3}) урона')).toBe(
      'Попадание: 6 (1к6 + 3) урона',
    );
    expect(cleanTtgMarkup('{@roll +5|notation:1d20+5}')).toBe('+5');
    expect(cleanTtgMarkup('{@item Короткий меч|url:shortsword-phb}')).toBe('Короткий меч');
  });
});
