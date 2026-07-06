#!/usr/bin/env node
/**
 * Применяет вердикты аудита механик предметов:
 *   null → сброс механики (PUT mechanics: {} — бэкенд пишет NULL);
 *   fix  → валидация схемой и запись исправленной механики.
 * Вход: JSON-файл воркфлоу (поле result.verdicts).
 *
 * Запуск: node scripts/content/apply-item-audit.mjs <path-to-output.json> [--apply]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { apiRequest, login } from './api.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const Ajv = require(join(__dirname, '../../frontend/node_modules/ajv/dist/ajv.js')).default;
const addFormats = require(join(__dirname, '../../frontend/node_modules/ajv-formats/dist/index.js')).default;
const schema = JSON.parse(readFileSync(join(__dirname, '../../frontend/src/schemas/mechanics.schema.json'), 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validateCard = ajv.compile(schema);

const APPLY = process.argv.includes('--apply');
const srcPath = process.argv[2];

function validateMech(name, mechanics) {
  const card = {
    schema_version: '1.0',
    id: 'audit-fix', name,
    kind: 'passive_effect',
    activation: mechanics.activation || { mode: 'passive' },
    interactions: mechanics.effects || [],
    ...(mechanics.uses ? { uses: mechanics.uses } : {}),
    ...(mechanics.targeting ? { targeting: mechanics.targeting } : {}),
  };
  if (validateCard(card)) return [];
  return (validateCard.errors || []).map((e) => `${e.instancePath}: ${e.message}`);
}

async function main() {
  const doc = JSON.parse(readFileSync(srcPath, 'utf8'));
  const verdicts = doc.result?.verdicts || doc.verdicts || [];
  const nulls = verdicts.filter((v) => v.verdict === 'null');
  const fixes = verdicts.filter((v) => v.verdict === 'fix');
  console.log(`Вердиктов: ${verdicts.length} (null ${nulls.length}, fix ${fixes.length}); режим: ${APPLY ? 'APPLY' : 'dry-run'}`);

  const token = APPLY ? await login() : null;
  const report = { cleared: [], fixed: [], schemaFail: [], failed: [] };

  for (const v of nulls) {
    report.cleared.push(v.name);
    if (APPLY) {
      try { await apiRequest(token, 'PUT', `/api/cards/${v.id}`, { mechanics: {} }); }
      catch (e) { report.failed.push(`${v.name}: ${String(e).slice(0, 120)}`); }
    }
  }
  for (const v of fixes) {
    const mech = v.fixed_mechanics;
    if (!mech || typeof mech !== 'object' || !Array.isArray(mech.effects)) {
      report.schemaFail.push(`${v.name}: fix без корректной механики → сброс`);
      if (APPLY) {
        try { await apiRequest(token, 'PUT', `/api/cards/${v.id}`, { mechanics: {} }); }
        catch (e) { report.failed.push(`${v.name}: ${String(e).slice(0, 120)}`); }
      }
      continue;
    }
    const errs = validateMech(v.name, mech);
    if (errs.length) {
      // невалидный фикс — по политике владельца безопаснее сбросить
      report.schemaFail.push(`${v.name}: ${errs[0]} → сброс`);
      if (APPLY) {
        try { await apiRequest(token, 'PUT', `/api/cards/${v.id}`, { mechanics: {} }); }
        catch (e) { report.failed.push(`${v.name}: ${String(e).slice(0, 120)}`); }
      }
      continue;
    }
    report.fixed.push(v.name);
    if (APPLY) {
      try { await apiRequest(token, 'PUT', `/api/cards/${v.id}`, { mechanics: mech }); }
      catch (e) { report.failed.push(`${v.name}: ${String(e).slice(0, 120)}`); }
    }
  }

  const out = join(__dirname, 'batches/data/item-audit-report.json');
  writeFileSync(out, JSON.stringify({ ...report, reasons: verdicts.map((v) => ({ name: v.name, verdict: v.verdict, reason: v.reason?.slice(0, 200) })) }, null, 1));
  console.log(`Сброшено: ${report.cleared.length}; починено: ${report.fixed.length}; невалидный фикс→сброс: ${report.schemaFail.length}; ошибок API: ${report.failed.length}`);
  console.log(`Отчёт: ${out}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
