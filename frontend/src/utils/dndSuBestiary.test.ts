// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isDndSuBestiaryUrl, parseDndSuBestiaryHtml } from './dndSuBestiary';

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/skeleton.html');

describe('dndSuBestiary', () => {
  it('recognizes bestiary URLs', () => {
    expect(isDndSuBestiaryUrl('https://next.dnd.su/bestiary/21552-skeleton/')).toBe(true);
    expect(isDndSuBestiaryUrl('next.dnd.su/bestiary/21552-skeleton/')).toBe(true);
    expect(isDndSuBestiaryUrl('https://dnd.su/items/1-adamantine-armor/')).toBe(false);
  });

  it('parses skeleton stat block', () => {
    const html = readFileSync(fixturePath, 'utf-8');
    const result = parseDndSuBestiaryHtml(html, 'https://next.dnd.su/bestiary/21552-skeleton/');

    expect(result.name).toBe('Скелет');
    expect(result.ac).toBe(14);
    expect(result.maxHp).toBe(13);
    expect(result.description).toContain('Инициатива');
    expect(result.description).toContain('Короткий меч');
    expect(result.description).toContain('Скелеты восстают');
  });
});
