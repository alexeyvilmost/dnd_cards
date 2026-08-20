#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import { apiRequest, apiUrl, login } from './api.mjs';
import { fetchMiniMvpCatalogs } from './mini-mvp-audit.mjs';

const PHB_2024 = 'PHB 2024';
const CLASS_SOURCE_REPAIRS = Object.freeze([
  Object.freeze({ cardNumber: 'CLASS-barbarian', name: 'Варвар' }),
  Object.freeze({ cardNumber: 'CLASS-monk', name: 'Монах' }),
]);
const HALFLING_CARD_NUMBER = 'RACE-0006';
const LEGACY_HALFLING_LINEAGES = Object.freeze(['Легконогий', 'Крепкий']);

function exactEntity(items, cardNumber) {
  const matches = items.filter((entity) => entity.card_number === cardNumber);
  if (matches.length !== 1) {
    throw new Error(`${cardNumber}: expected exactly one live entity, got ${matches.length}`);
  }
  return matches[0];
}

function lineageNames(entity) {
  return (Array.isArray(entity.lineages) ? entity.lineages : [])
    .map((lineage) => lineage?.name)
    .filter((name) => typeof name === 'string' && name);
}

function sameStrings(left, right) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

/**
 * Builds an exact migration plan. The accepted preimages intentionally match
 * the known production drift; any other value aborts instead of being replaced.
 */
export function planStructuralBaselineRepair(catalogs) {
  const plan = [];
  for (const spec of CLASS_SOURCE_REPAIRS) {
    const entity = exactEntity(catalogs.class ?? [], spec.cardNumber);
    if (entity.name !== spec.name) {
      throw new Error(`${spec.cardNumber}: expected «${spec.name}», got «${entity.name ?? ''}»`);
    }
    if (entity.source === PHB_2024) continue;
    if (entity.source !== null && entity.source !== undefined && entity.source !== '') {
      throw new Error(`${spec.cardNumber}: refusing unexpected source «${entity.source}»`);
    }
    plan.push({
      entityType: 'class',
      cardNumber: spec.cardNumber,
      entity,
      path: `/api/classes/${entity.id}`,
      patch: { source: PHB_2024 },
      reason: 'закрепить источник PHB 2024',
    });
  }

  const halfling = exactEntity(catalogs.race ?? [], HALFLING_CARD_NUMBER);
  if (halfling.name !== 'Полурослик') {
    throw new Error(`${HALFLING_CARD_NUMBER}: expected «Полурослик», got «${halfling.name ?? ''}»`);
  }
  const actualLineages = lineageNames(halfling);
  if (actualLineages.length > 0) {
    if (!sameStrings(actualLineages, LEGACY_HALFLING_LINEAGES)) {
      throw new Error(
        `${HALFLING_CARD_NUMBER}: refusing unexpected lineages [${actualLineages.join(', ')}]`,
      );
    }
    plan.push({
      entityType: 'race',
      cardNumber: HALFLING_CARD_NUMBER,
      entity: halfling,
      path: `/api/races/${halfling.id}`,
      patch: { lineages: [] },
      reason: 'убрать legacy-подвиды 2014 года',
    });
  }
  return plan;
}

export async function runStructuralBaselineRepair({
  apply = process.argv.includes('--apply'),
} = {}) {
  const catalogs = await fetchMiniMvpCatalogs();
  const plan = planStructuralBaselineRepair(catalogs);
  console.log(`${apply ? 'APPLY' : 'DRY-RUN'} ${apiUrl()}: ${plan.length} structural repairs`);
  for (const item of plan) {
    console.log(`  ${apply ? '↻' : '✓'} ${item.cardNumber}: ${item.reason}`);
  }
  if (!apply || plan.length === 0) return plan;
  const token = await login();
  for (const item of plan) {
    await apiRequest(token, 'PUT', item.path, item.patch);
  }
  return plan;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runStructuralBaselineRepair().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
