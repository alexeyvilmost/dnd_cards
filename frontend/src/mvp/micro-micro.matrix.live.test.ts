import { beforeAll, describe, expect, it } from 'vitest';

if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => store.clear(),
    key: () => null,
    get length() { return store.size; },
  } as Storage;
}

import { API_BASE_URL } from '../api/client';
import { autoBuildAt, type BuildContent } from '../canon/autoBuild';
import {
  createMicroMvpMatrix,
  microMvpBuildIssues,
  type MicroMvpMatrixEntity,
} from '../canon/microMicroMatrix';
import type { Background, CharacterClass, Feat, Race, Spell } from '../types';
import { readLiveJson } from './liveJsonRead';

type ManifestEntry = {
  key: string;
  selector: { cardNumber?: string };
};

type Manifest = {
  collections: {
    classes: ManifestEntry[];
    species: ManifestEntry[];
    backgrounds: ManifestEntry[];
    originFeats: ManifestEntry[];
    cantrips: ManifestEntry[];
    firstLevelSpells: ManifestEntry[];
  };
};

async function fetchAll<T extends { id: string }>(path: string, key: string): Promise<T[]> {
  const items: T[] = [];
  const seenIds = new Set<string>();
  let expectedTotal: number | null = null;
  for (let page = 1; page <= 100; page += 1) {
    const body = await readLiveJson<Record<string, unknown>>(
      `${API_BASE_URL}${path}?page=${page}&limit=1000`,
      { label: path },
    );
    if (!Array.isArray(body[key])) throw new Error(`${path}: required collection ${key} is missing`);
    const batch = body[key] as T[];
    const responseTotal = Number(body.total);
    if (Number.isSafeInteger(responseTotal) && responseTotal >= 0) {
      if (expectedTotal !== null && responseTotal !== expectedTotal) {
        throw new Error(`${path}: total changed from ${expectedTotal} to ${responseTotal}`);
      }
      expectedTotal = responseTotal;
    }
    const repeatedId = batch.find((item) => !item?.id || seenIds.has(item.id))?.id;
    if (repeatedId !== undefined) {
      throw new Error(`${path}: pagination repeated or omitted entity id ${repeatedId || '<blank>'}`);
    }
    batch.forEach((item) => seenIds.add(item.id));
    items.push(...batch);
    if (expectedTotal !== null) {
      if (items.length === expectedTotal) return items;
      if (items.length > expectedTotal || batch.length === 0) {
        throw new Error(`${path}: received ${items.length}/${expectedTotal} records`);
      }
    } else if (batch.length < 1000) {
      return items;
    }
  }
  throw new Error(`${path}: pagination exceeded 100 pages`);
}

function resolveManifestEntities<T extends MicroMvpMatrixEntity>(
  entries: ManifestEntry[],
  catalog: T[],
): T[] {
  return entries.map((entry) => {
    const cardNumber = entry.selector.cardNumber;
    const matches = catalog.filter((entity) => entity.card_number === cardNumber);
    if (matches.length !== 1) {
      throw new Error(
        `${entry.key}: expected exactly one ${cardNumber ?? '<missing cardNumber>'}, got ${matches.length}`,
      );
    }
    return matches[0];
  });
}

describe.skipIf(process.env.MVP_CONTENT !== '1')('micro-MVP live matrix: 7 × 4 × 4 × 4', () => {
  let content: BuildContent;
  let scope: {
    classes: CharacterClass[];
    species: Race[];
    backgrounds: Background[];
    originFeats: Feat[];
  };
  let allowedSpellIds: Set<string>;

  beforeAll(async () => {
    const manifestUrl = new URL('../../../scripts/content/micro-mvp-manifest.mjs', import.meta.url);
    const manifestModule = await import(/* @vite-ignore */ manifestUrl.href) as {
      MICRO_MVP_MANIFEST: Manifest;
    };
    const manifest = manifestModule.MICRO_MVP_MANIFEST;
    const [classes, races, backgrounds, feats, spells] = await Promise.all([
      fetchAll<CharacterClass>('/api/classes', 'classes'),
      fetchAll<Race>('/api/races', 'races'),
      fetchAll<Background>('/api/backgrounds', 'backgrounds'),
      fetchAll<Feat>('/api/feats', 'feats'),
      fetchAll<Spell>('/api/spells', 'spells'),
    ]);

    scope = {
      classes: resolveManifestEntities(manifest.collections.classes, classes),
      species: resolveManifestEntities(manifest.collections.species, races),
      backgrounds: resolveManifestEntities(manifest.collections.backgrounds, backgrounds),
      originFeats: resolveManifestEntities(manifest.collections.originFeats, feats),
    };
    const acceptedSpells = resolveManifestEntities(
      [...manifest.collections.cantrips, ...manifest.collections.firstLevelSpells],
      spells,
    );
    allowedSpellIds = new Set(acceptedSpells.map((spell) => spell.id));
    content = { classes, races, backgrounds, feats, spells: acceptedSpells };
  }, 180_000);

  it('каждое из 448 сочетаний создаёт завершённого персонажа через реальный pipeline кузницы', async () => {
    const failures: Array<{ className: string; featName: string; detail: string }> = [];
    const matrix = createMicroMvpMatrix(scope);

    for (const matrixCase of matrix) {
      try {
        const result = await autoBuildAt({
          classId: matrixCase.klass.id,
          raceId: matrixCase.species.id,
          backgroundId: matrixCase.background.id,
          featIds: [matrixCase.originFeat.id],
          replaceBackgroundFeat: true,
          level: 1,
        }, content);
        const caseIssues = microMvpBuildIssues(matrixCase, result);
        const outsideManifest = result.draft.spellIds
          .filter((spellId) => !allowedSpellIds.has(spellId));
        if (outsideManifest.length) {
          caseIssues.push(`spells outside manifest: ${outsideManifest.join(', ')}`);
        }
        if (caseIssues.length) {
          failures.push({
            className: matrixCase.klass.card_number,
            featName: matrixCase.originFeat.card_number,
            detail: `${matrixCase.key}: ${caseIssues.join('; ')}`,
          });
        }
      } catch (error) {
        failures.push({
          className: matrixCase.klass.card_number,
          featName: matrixCase.originFeat.card_number,
          detail: `${matrixCase.key}: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }

    expect(matrix).toHaveLength(448);
    if (failures.length) {
      const counts = (field: 'className' | 'featName') => Object.entries(
        failures.reduce<Record<string, number>>((acc, failure) => {
          acc[failure[field]] = (acc[failure[field]] ?? 0) + 1;
          return acc;
        }, {}),
      ).map(([key, count]) => `${key}=${count}`).join(', ');
      throw new Error([
        `Failed ${failures.length}/${matrix.length} combinations.`,
        `By class: ${counts('className')}.`,
        `By origin feat: ${counts('featName')}.`,
        'First failures:',
        ...failures.slice(0, 8).map((failure) => failure.detail),
      ].join('\n'));
    }
  }, 900_000);
});
