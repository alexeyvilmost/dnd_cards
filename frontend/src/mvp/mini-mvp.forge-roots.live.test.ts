import { beforeAll, describe, expect, it } from 'vitest';

if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() { return store.size; },
  } as Storage;
}

import { API_BASE_URL } from '../api/client';
import fixtureJson from '../canon/data/mini-mvp-forge-sheet-fixture.v1.json';
import {
  buildMiniMvpForgeSheetFixture,
  type MiniMvpForgeManifest,
  type MiniMvpForgeSheetFixture,
} from '../canon/miniMvpForgeSheetFixtureGenerator';
import type { Background, Card, CharacterClass, Feat, Race, Spell } from '../types';
import { readLiveJson } from './liveJsonRead';

async function fetchAll<T extends { id: string }>(path: string, key: string): Promise<T[]> {
  const result: T[] = [];
  const seen = new Set<string>();
  let total: number | null = null;
  for (let page = 1; page <= 100; page += 1) {
    const separator = path.includes('?') ? '&' : '?';
    const body = await readLiveJson<Record<string, unknown>>(
      `${API_BASE_URL}${path}${separator}page=${page}&limit=1000`,
      { label: path },
    );
    const batch = body[key];
    if (!Array.isArray(batch)) throw new Error(`${path}: response is missing ${key}`);
    const responseTotal = Number(body.total);
    if (Number.isSafeInteger(responseTotal) && responseTotal >= 0) {
      if (total !== null && total !== responseTotal) {
        throw new Error(`${path}: total changed from ${total} to ${responseTotal}`);
      }
      total = responseTotal;
    }
    for (const item of batch as T[]) {
      if (!item?.id || seen.has(item.id)) throw new Error(`${path}: repeated or blank id`);
      seen.add(item.id);
      result.push(item);
    }
    if (total !== null ? result.length === total : batch.length < 1000) return result;
    if (batch.length === 0 || (total !== null && result.length > total)) {
      throw new Error(`${path}: received ${result.length}/${String(total)} rows`);
    }
  }
  throw new Error(`${path}: pagination exceeded 100 pages`);
}

describe.skipIf(process.env.MVP_CONTENT !== '1')('mini-MVP live Forge root covering set', () => {
  let actual: MiniMvpForgeSheetFixture;

  beforeAll(async () => {
    const manifestUrl = new URL('../../../scripts/content/mini-mvp-manifest.mjs', import.meta.url);
    const { MINI_MVP_MANIFEST } = await import(/* @vite-ignore */ manifestUrl.href) as {
      MINI_MVP_MANIFEST: MiniMvpForgeManifest;
    };
    const [cards, classes, races, backgrounds, feats, spells] = await Promise.all([
      fetchAll<Card>('/api/cards?fields=list', 'cards'),
      fetchAll<CharacterClass>('/api/classes?fields=list', 'classes'),
      fetchAll<Race>('/api/races?fields=list', 'races'),
      fetchAll<Background>('/api/backgrounds?fields=list', 'backgrounds'),
      fetchAll<Feat>('/api/feats?fields=list', 'feats'),
      fetchAll<Spell>('/api/spells?fields=list', 'spells'),
    ]);
    const spellNumbers = new Set([
      ...MINI_MVP_MANIFEST.collections.cantrips,
      ...MINI_MVP_MANIFEST.collections.firstLevelSpells,
    ].map((entry) => entry.selector.cardNumber));
    actual = await buildMiniMvpForgeSheetFixture(MINI_MVP_MANIFEST, {
      cards,
      classes,
      races,
      backgrounds,
      feats,
      spells: spells.filter((spell) => spellNumbers.has(spell.card_number)),
    });
  }, 900_000);

  it('assembles every root and species lineage and matches the browser fixture byte-for-byte', () => {
    expect(actual.roots.length).toBeGreaterThanOrEqual(24);
    expect(new Set(actual.roots.map((root) => root.classCardNumber)).size).toBe(12);
    expect(new Set(actual.roots.map((root) => root.raceCardNumber)).size).toBe(10);
    expect(new Set(actual.roots.map((root) => root.backgroundCardNumber)).size).toBe(16);
    expect(new Set(actual.roots.map((root) => root.featCardNumber)).size).toBe(10);
    expect(new Set(actual.roots.flatMap((root) => root.lineageCardNumber ? [root.lineageCardNumber] : [])).size).toBe(24);
    expect(actual).toEqual(fixtureJson as unknown as MiniMvpForgeSheetFixture);
  });
});
