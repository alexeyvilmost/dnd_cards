#!/usr/bin/env node
/**
 * Снапшот прод-контента в git — офлайн-источник правды для аудитора покрытия
 * (docs/rules-coverage-plan-2026-07-11.md, этап 0.3) и база ночного диффа.
 *
 * Контент живёт только в прод-Postgres и мутирует без коммитов; без зафиксированного
 * среза «постоянно зелёное покрытие» невозможно. Снапшот детерминирован (сортировка
 * по card_number/id, стабильный отступ) — дифф читаем построчно.
 *
 * Запуск:   node scripts/content/export-prod.mjs
 * Кастомный бэкенд:  API_URL=http://localhost:8080 node scripts/content/export-prod.mjs
 * Выход:    officials/canon/prod-snapshot/<entity>.json  (+ index.json с метаданными)
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { basename, dirname, join, resolve } from 'node:path';
import { fetchRequiredCollection } from './api.mjs';
import { sha256Canonical } from './certification-hash.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const OUT = join(ROOT, 'officials/canon/prod-snapshot');
const API_URL = process.env.API_URL || 'https://bagofholding.ru';

// entity → [path, ключ массива в ответе]. Порядок = порядок в index.json.
export const PROD_SNAPSHOT_ENTITIES = [
  ['classes', '/api/classes', 'classes'],
  ['races', '/api/races', 'races'],
  ['effects', '/api/effects', 'effects'],
  ['actions', '/api/actions', 'actions'],
  ['spells', '/api/spells', 'spells'],
  ['feats', '/api/feats', 'feats'],
  ['backgrounds', '/api/backgrounds', 'backgrounds'],
  ['cards', '/api/cards', 'cards'],
  ['resources', '/api/resources', 'resources'],
  ['variables', '/api/variables', 'variables'],
  ['concepts', '/api/concepts', 'concepts'],
];

// Conditions intentionally have no parallel catalog endpoint or snapshot.
// Since migration 065 they are Effect rows with effect_type="condition";
// exporting a second collection would recreate two competing authorities.

const contentPatch = JSON.parse(readFileSync(join(
  ROOT,
  'frontend/src/canon/data/micro-mvp-l1-content-patch.v1.json',
), 'utf8'));

const PINNED_CONTENT_PATCH = Object.freeze({
  id: 'dnd5e-2024.micro-mvp-l1.content-patch.v1',
  version: '1.8.0',
  sourceReleaseId: 'prod-snapshot@2026-07-15.micro-mvp-l1.v1',
  hash: 'sha256:31148b36b944474af7506da946fcaaeb0adf42696dda359a91ad88f8a7aa40f5',
  conditionCount: 15,
});

export function requiredConditionCardNumbers(patch) {
  if (patch?.patchId !== PINNED_CONTENT_PATCH.id
    || patch?.patchVersion !== PINNED_CONTENT_PATCH.version
    || patch?.sourceReleaseId !== PINNED_CONTENT_PATCH.sourceReleaseId) {
    throw new Error('Production export content patch identity is not the pinned micro-MVP release');
  }
  if (!Array.isArray(patch.conditionPatches)) {
    throw new Error('Production export content patch conditionPatches must be an array');
  }
  const cardNumbers = patch.conditionPatches.map((declaration) => declaration?.cardNumber);
  if (cardNumbers.length !== PINNED_CONTENT_PATCH.conditionCount
    || cardNumbers.some((cardNumber) => typeof cardNumber !== 'string' || cardNumber === '')) {
    throw new Error(`Production export requires exactly ${PINNED_CONTENT_PATCH.conditionCount} condition card numbers`);
  }
  if (new Set(cardNumbers).size !== cardNumbers.length) {
    throw new Error('Production export condition card numbers must be unique');
  }
  const actualHash = sha256Canonical(patch);
  if (actualHash !== PINNED_CONTENT_PATCH.hash) {
    throw new Error(`Production export content patch hash mismatch: ${PINNED_CONTENT_PATCH.hash} -> ${actualHash}`);
  }
  return Object.freeze([...cardNumbers]);
}

export const REQUIRED_CONDITION_CARD_NUMBERS = requiredConditionCardNumbers(contentPatch);

/** Детерминированная сортировка: сперва card_number, затем id, затем name. */
export function sortKey(x) {
  return `${x.card_number ?? ''}\0${x.id ?? ''}\0${x.name ?? ''}`;
}

/** Рекурсивно сортирует ключи объектов → стабильный JSON-дифф. */
export function stableStringify(value) {
  const seen = new WeakSet();
  const norm = (v) => {
    if (v && typeof v === 'object') {
      if (seen.has(v)) return v;
      seen.add(v);
      if (Array.isArray(v)) return v.map(norm);
      const out = {};
      for (const k of Object.keys(v).sort()) out[k] = norm(v[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(norm(value), null, 2) + '\n';
}

function atomicSnapshotDirectory(outDir, files) {
  const target = resolve(outDir);
  const parent = dirname(target);
  const suffix = `${process.pid}-${Date.now()}`;
  const targetName = basename(target);
  const staging = join(parent, `.${targetName}.staging-${suffix}`);
  const previous = join(parent, `.${targetName}.previous-${suffix}`);
  if (target === parent || target === '/') throw new Error(`Unsafe snapshot target: ${target}`);
  mkdirSync(parent, { recursive: true });
  mkdirSync(staging, { recursive: false });
  let movedPrevious = false;
  try {
    for (const [filename, source] of files) {
      writeFileSync(join(staging, filename), source);
    }
    if (existsSync(target)) {
      renameSync(target, previous);
      movedPrevious = true;
    }
    try {
      renameSync(staging, target);
    } catch (error) {
      if (movedPrevious && !existsSync(target)) renameSync(previous, target);
      throw error;
    }
    if (movedPrevious) {
      try {
        rmSync(previous, { recursive: true, force: true });
      } catch {
        // The new directory is already atomically committed. A stale hidden
        // backup is safer than rolling the reviewed snapshot back again.
      }
    }
  } catch (error) {
    if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

export async function exportProductionSnapshot({
  baseUrl = API_URL,
  outDir = OUT,
  fetchImpl = globalThis.fetch,
  log = console.log,
} = {}) {
  log(`API: ${baseUrl}`);
  const index = { source: baseUrl, entities: {} };
  const catalogs = new Map();

  // Fetch every required collection before touching the checked-in snapshot.
  // A partial/invalid API response therefore fails closed and leaves the last
  // reviewed release byte-for-byte intact.
  for (const [name, path, key] of PROD_SNAPSHOT_ENTITIES) {
    const items = await fetchRequiredCollection(path, key, {
      baseUrl,
      fetchImpl,
      limit: 100,
    });
    items.sort((a, b) => {
      const left = sortKey(a);
      const right = sortKey(b);
      return left < right ? -1 : left > right ? 1 : 0;
    });
    catalogs.set(name, items);
    const withMech = items.filter((x) => x.mechanics && Object.keys(x.mechanics).length > 0).length;
    index.entities[name] = { count: items.length, with_mechanics: withMech };
    log(`  ${name}: ${items.length}${withMech ? ` (с механикой ${withMech})` : ''}`);
  }

  const conditionEffects = catalogs.get('effects')?.filter(
    (effect) => effect.effect_type === 'condition',
  ) ?? [];
  const conditionsByCardNumber = new Map();
  for (const effect of conditionEffects) {
    if (typeof effect.card_number !== 'string' || effect.card_number === '') continue;
    const matches = conditionsByCardNumber.get(effect.card_number) ?? [];
    matches.push(effect);
    conditionsByCardNumber.set(effect.card_number, matches);
  }
  const invalidConditions = REQUIRED_CONDITION_CARD_NUMBERS.filter(
    (cardNumber) => conditionsByCardNumber.get(cardNumber)?.length !== 1,
  );
  if (invalidConditions.length > 0) {
    throw new Error(
      `effects: required condition Effect identities must be unique: ${invalidConditions.join(', ')}`,
    );
  }

  const files = [...catalogs.entries()].map(([name, items]) => [
    `${name}.json`,
    stableStringify(items),
  ]);
  // index.json БЕЗ даты: временную метку снимает git-коммит.
  files.push(['index.json', stableStringify(index)]);
  atomicSnapshotDirectory(outDir, files);
  log(`Снапшот записан: ${outDir}`);
  return index;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  exportProductionSnapshot().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
