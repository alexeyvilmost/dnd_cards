#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { apiUrl, login } from './api.mjs';
import { buildCertificationIndex, certificationHashes } from './certification-hash.mjs';
import { assessMiniMvpCatalogs, fetchMiniMvpCatalogs } from './mini-mvp-audit.mjs';
import { MINI_MVP_MANIFEST } from './mini-mvp-manifest.mjs';

export const FIGHTING_STYLE_FORGE_SHEET_VERSION = 'mini-mvp-fighting-style-forge-sheet-v1';
export const NARRATIVE_FIGHTING_STYLE_CARD_NUMBERS = Object.freeze([
  'FEAT-0054', // Dueling
  'FEAT-0057', // Interception
  'FEAT-0058', // Unarmed Fighting
  'FEAT-0059', // Great Weapon Fighting
  'FEAT-0060', // Blind Fighting
  'FEAT-0062', // Thrown Weapon Fighting
]);

const fixture = JSON.parse(readFileSync(new URL(
  '../../frontend/src/canon/data/mini-mvp-fighting-style-fixture.v1.json',
  import.meta.url,
), 'utf8'));

function declaredStyleCardNumbers() {
  return MINI_MVP_MANIFEST.collections.fightingStyles
    .map((entry) => entry.selector.cardNumber);
}

export function fightingStyleForgeSheetCoverageProblems() {
  const problems = [];
  const expected = declaredStyleCardNumbers();
  if (fixture.schemaVersion !== 1 || fixture.strategy !== 'one-fighter-per-style-v1') {
    problems.push('Fighting Style fixture has an unsupported schema or strategy');
  }
  if (JSON.stringify(fixture.coverage?.fightingStyles) !== JSON.stringify(expected)) {
    problems.push('Fighting Style fixture coverage differs from the mini-MVP manifest');
  }
  const roots = fixture.roots?.map((root) => root.styleCardNumber) ?? [];
  if (JSON.stringify(roots) !== JSON.stringify(expected)) {
    problems.push('Fighting Style roots differ from the mini-MVP manifest');
  }
  for (const cardNumber of NARRATIVE_FIGHTING_STYLE_CARD_NUMBERS) {
    if (!expected.includes(cardNumber)) problems.push(`${cardNumber}: absent from mini-MVP styles`);
  }
  return problems;
}

function payloadKinds(value) {
  const kinds = [];
  const visit = (candidate) => {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (!candidate || typeof candidate !== 'object') return;
    if (typeof candidate.kind === 'string') kinds.push(candidate.kind);
    Object.values(candidate).forEach(visit);
  };
  visit(value);
  return kinds;
}

export function planFightingStyleForgeSheetSupport(report, catalogs) {
  const fixtureProblems = fightingStyleForgeSheetCoverageProblems();
  if (fixtureProblems.length > 0) throw new Error(fixtureProblems.join('; '));
  const targets = new Set(NARRATIVE_FIGHTING_STYLE_CARD_NUMBERS);
  return report.records
    .filter((record) => record.collection === 'fightingStyles' && targets.has(record.cardNumber))
    .map((record) => {
      const blocking = record.issues.filter((item) => (
        item.kind === 'data'
        || item.kind === 'mechanics'
        || item.code === 'reference_unresolved'
      ));
      if (blocking.length > 0) {
        throw new Error(`${record.cardNumber}: style is not structurally clean: ${blocking.map((item) => item.code).join(', ')}`);
      }
      const matches = (catalogs.feat ?? []).filter((entity) => entity.id === record.entityId);
      if (matches.length !== 1) {
        throw new Error(`${record.cardNumber}: expected one live feat, got ${matches.length}`);
      }
      const entity = matches[0];
      const references = Array.isArray(entity.related_effects) ? entity.related_effects : [];
      if (references.length !== 1) {
        throw new Error(`${record.cardNumber}: expected one referenced effect, got ${references.length}`);
      }
      const effects = (catalogs.effect ?? []).filter((effect) => (
        references.includes(effect.id) || references.includes(effect.card_number)
      ));
      if (effects.length !== 1) {
        throw new Error(`${record.cardNumber}: expected one resolved effect, got ${effects.length}`);
      }
      const kinds = payloadKinds(effects[0].mechanics);
      if (kinds.length === 0 || kinds.some((kind) => kind !== 'narrative')) {
        throw new Error(`${record.cardNumber}: refusing to overwrite a style that is no longer narrative-only`);
      }
      return { record, entity };
    });
}

export function fightingStyleForgeSheetSupportPayload(entity, index) {
  const hashes = certificationHashes(entity, 'feat', index);
  return {
    status: 'verified_partial',
    content_hash: hashes.contentHash,
    dependency_hash: hashes.dependencyHash,
    certification_version: FIGHTING_STYLE_FORGE_SHEET_VERSION,
    limitations: [
      'Стиль выбран через data-driven выбор Воина во время сборки и прошёл production UI: кузница, POST, повторное чтение и реальный лист.',
      'Связанный эффект пока содержит только narrative-заглушку и не изменяет состояние движка; механическая сертификация не выдана.',
    ],
    note: 'Боевой стиль подтверждён на уровнях данных и реального Forge→sheet; 2/3. Механика намеренно не заблокирована.',
    test_coverage: {
      schema_version: 1,
      scope: FIGHTING_STYLE_FORGE_SHEET_VERSION,
      required: 3,
      passed: 2,
      percent: 66,
    },
    mechanics_locked: false,
  };
}

export async function runFightingStyleForgeSheetSupport({
  apply = process.argv.includes('--apply'),
} = {}) {
  const catalogs = await fetchMiniMvpCatalogs();
  const report = assessMiniMvpCatalogs(catalogs);
  const plan = planFightingStyleForgeSheetSupport(report, catalogs);
  console.log(`${apply ? 'APPLY' : 'DRY-RUN'} ${apiUrl()}: ${plan.length} narrative Fighting Styles`);
  for (const item of plan) console.log(`  ${apply ? '◑' : '✓'} ${item.record.cardNumber} ${item.record.expectedName}`);
  if (!apply) return plan;
  if (!process.env.CONTENT_CERTIFICATION_KEY?.trim()) throw new Error('--apply requires CONTENT_CERTIFICATION_KEY');
  const token = await login();
  const index = buildCertificationIndex(catalogs);
  for (const item of plan) {
    const payload = fightingStyleForgeSheetSupportPayload(item.entity, index);
    const response = await fetch(`${apiUrl()}/api/content-support/feat/${item.entity.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Content-Certification-Key': process.env.CONTENT_CERTIFICATION_KEY.trim(),
      },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${item.record.key}: support update returned ${response.status}: ${text.slice(0, 500)}`);
    }
  }
  return plan;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runFightingStyleForgeSheetSupport().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
