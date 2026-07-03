// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isTtgClubBestiaryUrl, parseTtgClubBestiaryHtml } from './ttgClubBestiary';

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
  });
});
