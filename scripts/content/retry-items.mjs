#!/usr/bin/env node
/**
 * Добивочный проход обогащения предметов после items-enrichment-report.json:
 * 1) failed — повторная генерация (обновлённый системный промпт со строгими enum);
 * 2) narrativeOnly с текстом про устойчивость/иммунитет — теперь есть payload resistance.
 * Результат пишется поверх отчёта (секции failed/narrativeOnly пересчитываются).
 *
 * Запуск: node scripts/content/retry-items.mjs [--apply]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { apiRequest, apiUrl, fetchAll, login } from './api.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const Ajv = require(join(__dirname, '../../frontend/node_modules/ajv/dist/ajv.js')).default;
const addFormats = require(join(__dirname, '../../frontend/node_modules/ajv-formats/dist/index.js')).default;
const schema = JSON.parse(readFileSync(join(__dirname, '../../frontend/src/schemas/mechanics.schema.json'), 'utf8'));

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validateCard = ajv.compile(schema);

const APPLY = process.argv.includes('--apply');
const REPORT_PATH = join(__dirname, 'batches/data/items-enrichment-report.json');

function validateMech(id, name, mechanics) {
  const card = {
    schema_version: '1.0',
    id: String(id).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+/, '') || 'item',
    name,
    kind: 'passive_effect',
    activation: mechanics.activation || { mode: 'passive' },
    interactions: mechanics.effects || [],
    ...(mechanics.uses ? { uses: mechanics.uses } : {}),
    ...(mechanics.targeting ? { targeting: mechanics.targeting } : {}),
  };
  if (validateCard(card)) return [];
  return (validateCard.errors || []).map((e) => `${e.instancePath}: ${e.message}`);
}

function allPayloads(m) {
  const out = [];
  for (const eff of m.effects || []) {
    for (const key of ['result', 'results', 'on_hit', 'on_crit', 'on_fail', 'on_success']) {
      if (Array.isArray(eff[key])) out.push(...eff[key]);
    }
  }
  return out;
}

function isUsefulMechanics(m) {
  const payloads = allPayloads(m);
  if (!payloads.length) return false;
  const meaningful = payloads.filter((p) => p.kind && p.kind !== 'narrative');
  if (m.activation?.mode === 'passive' && meaningful.length === 0) return false;
  return meaningful.length > 0 || m.activation?.mode === 'active';
}

async function aiMechanics(card) {
  const body = {
    kind: 'item',
    name: card.name,
    description: [card.description, card.detailed_description].filter(Boolean).join('\n'),
    extra: [
      card.type ? `Тип: ${card.type}` : '',
      card.requires_attunement ? 'Требует настройки' : '',
      card.rarity ? `Редкость: ${card.rarity}` : '',
    ].filter(Boolean).join('; '),
  };
  const res = await fetch(`${apiUrl()}/api/ai/mechanics`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`AI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).mechanics;
}

async function main() {
  const report = JSON.parse(readFileSync(REPORT_PATH, 'utf8'));
  const failedNames = report.failed.map((f) => f.split(':')[0].trim());
  const resistRe = /(устойчивост|сопротивлен|иммунитет|уязвимост|тёмное зрение|темное зрение|скорост)/i;
  const narrativeNames = report.narrativeOnly
    .filter((n) => resistRe.test(n))
    .map((n) => n.split(':')[0].trim());
  const targetNames = new Set([...failedNames, ...narrativeNames]);

  const cards = await fetchAll('/api/cards', 'cards');
  const hasMech = (c) => c.mechanics && typeof c.mechanics === 'object' && Object.keys(c.mechanics).length > 0;
  const targets = cards.filter((c) => targetNames.has(c.name) && !hasMech(c));
  console.log(`Целей: ${targets.length} (failed ${failedNames.length}, narrative-повтор ${narrativeNames.length}); режим: ${APPLY ? 'APPLY' : 'dry-run'}`);

  const token = APPLY ? await login() : null;
  const enriched = [], stillFailed = [], stillNarrative = [];

  for (const card of targets) {
    try {
      const mechanics = await aiMechanics(card);
      const errs = validateMech(card.card_number || card.id, card.name, mechanics);
      if (errs.length) { stillFailed.push(`${card.name}: схема — ${errs[0]}`); continue; }
      if (!isUsefulMechanics(mechanics)) {
        stillNarrative.push(`${card.name}: ${String(card.description).slice(0, 90)}`);
        continue;
      }
      enriched.push(card.name);
      if (APPLY) await apiRequest(token, 'PUT', `/api/cards/${card.id}`, { mechanics });
    } catch (e) {
      stillFailed.push(`${card.name}: ${String(e).slice(0, 120)}`);
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  // Пересобираем отчёт: удаляем закрытые пункты, добавляем свежие результаты.
  const enrichedSet = new Set(enriched);
  report.enriched = [...report.enriched, ...enriched];
  report.failed = [
    ...report.failed.filter((f) => !targetNames.has(f.split(':')[0].trim())),
    ...stillFailed,
  ];
  report.narrativeOnly = [
    ...report.narrativeOnly.filter((n) => !enrichedSet.has(n.split(':')[0].trim())),
    ...stillNarrative.filter((n) => !report.narrativeOnly.some((o) => o.split(':')[0].trim() === n.split(':')[0].trim())),
  ];
  if (APPLY) writeFileSync(REPORT_PATH, JSON.stringify(report, null, 1));
  console.log(`Retry: обогащено ${enriched.length}, всё ещё сбой ${stillFailed.length}, narrative ${stillNarrative.length}`);
  for (const f of stillFailed) console.log('  fail:', f.slice(0, 110));
}

main().catch((e) => { console.error(e); process.exit(1); });
