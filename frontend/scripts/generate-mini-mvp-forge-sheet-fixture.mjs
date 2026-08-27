#!/usr/bin/env node

import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { MINI_MVP_MANIFEST } from '../../scripts/content/mini-mvp-manifest.mjs';

const FRONTEND_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = join(FRONTEND_ROOT, 'src/canon/data/mini-mvp-forge-sheet-fixture.v1.json');
const API_URL = (process.env.API_URL || process.env.VITE_API_URL || 'http://localhost:8080')
  .replace(/\/$/u, '');

async function fetchAll(path, key) {
  const result = [];
  let total = null;
  for (let page = 1; page <= 100; page += 1) {
    const separator = path.includes('?') ? '&' : '?';
    const response = await fetch(`${API_URL}${path}${separator}page=${page}&limit=1000`);
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    const body = await response.json();
    if (!Array.isArray(body[key])) throw new Error(`${path}: response is missing ${key}`);
    const responseTotal = Number(body.total);
    if (Number.isSafeInteger(responseTotal) && responseTotal >= 0) total = responseTotal;
    result.push(...body[key]);
    if (total !== null ? result.length === total : body[key].length < 1000) return result;
    if (body[key].length === 0 || (total !== null && result.length > total)) {
      throw new Error(`${path}: pagination stopped at ${result.length}/${String(total)}`);
    }
  }
  throw new Error(`${path}: pagination exceeded 100 pages`);
}

async function main() {
  process.env.VITE_API_URL = API_URL;
  const [cards, classes, races, backgrounds, feats, spells] = await Promise.all([
    fetchAll('/api/cards?fields=list', 'cards'),
    fetchAll('/api/classes', 'classes'),
    fetchAll('/api/races', 'races'),
    fetchAll('/api/backgrounds', 'backgrounds'),
    fetchAll('/api/feats', 'feats'),
    fetchAll('/api/spells', 'spells'),
  ]);
  const miniSpellNumbers = new Set([
    ...MINI_MVP_MANIFEST.collections.cantrips,
    ...MINI_MVP_MANIFEST.collections.firstLevelSpells,
  ].map((entry) => entry.selector.cardNumber));
  const scopedSpells = spells.filter((spell) => miniSpellNumbers.has(spell.card_number));

  const server = await createServer({
    root: FRONTEND_ROOT,
    appType: 'custom',
    logLevel: 'error',
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true },
  });
  try {
    const module = await server.ssrLoadModule('/src/canon/miniMvpForgeSheetFixtureGenerator.ts');
    const artifact = await module.buildMiniMvpForgeSheetFixture(MINI_MVP_MANIFEST, {
      cards,
      classes,
      races,
      backgrounds,
      feats,
      spells: scopedSpells,
    });
    const rendered = `${JSON.stringify(artifact, null, 2)}\n`;
    if (process.argv.includes('--check')) {
      const current = await readFile(OUTPUT, 'utf8').catch(() => null);
      if (current !== rendered) throw new Error(`${OUTPUT}: generated fixture is stale`);
      console.log(`OK ${OUTPUT}: ${artifact.roots.length} Forge roots`);
      return;
    }
    const temporary = `${OUTPUT}.${process.pid}.tmp`;
    await writeFile(temporary, rendered, 'utf8');
    await rename(temporary, OUTPUT);
    console.log(`WROTE ${OUTPUT}: ${artifact.roots.length} Forge roots`);
  } finally {
    await server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
