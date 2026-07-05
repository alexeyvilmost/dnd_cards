#!/usr/bin/env node
/**
 * Импорт заклинаний D&D 2024 из batch-файлов воркфлоу (spells2024-batch-N.json)
 * в прод через POST /api/spells. Существующие имена пропускаются, механика
 * валидируется схемой (невалидная — заклинание создаётся без неё, в отчёт).
 *
 * Запуск: node scripts/content/apply-spells-2024.mjs [--apply] [--limit N]
 * Отчёт: scripts/content/batches/data/spells2024-apply-report.json
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { apiRequest, fetchAll, login } from './api.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'batches/data');
const require = createRequire(import.meta.url);
const Ajv = require(join(__dirname, '../../frontend/node_modules/ajv/dist/ajv.js')).default;
const addFormats = require(join(__dirname, '../../frontend/node_modules/ajv-formats/dist/index.js')).default;
const schema = JSON.parse(readFileSync(join(__dirname, '../../frontend/src/schemas/mechanics.schema.json'), 'utf8'));

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validateCard = ajv.compile(schema);

const APPLY = process.argv.includes('--apply');
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

const SCHOOLS = new Set(['abjuration', 'conjuration', 'divination', 'enchantment', 'evocation', 'illusion', 'necromancy', 'transmutation']);

function validateMech(slug, name, mechanics) {
  const card = {
    schema_version: '1.0',
    id: String(slug).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+/, '') || 'spell',
    name,
    kind: 'spell',
    activation: mechanics.activation || { mode: 'active', cost: [] },
    interactions: mechanics.effects || [],
    ...(mechanics.uses ? { uses: mechanics.uses } : {}),
    ...(mechanics.targeting ? { targeting: mechanics.targeting } : {}),
  };
  if (validateCard(card)) return [];
  return (validateCard.errors || []).map((e) => `${e.instancePath}: ${e.message}`);
}

function loadBatches() {
  const seen = new Map(); // name(lower) → record; дедуп между батчами
  const files = readdirSync(DATA_DIR).filter((f) => /^spells2024-batch-\d+\.json$/.test(f)).sort();
  for (const f of files) {
    let arr;
    try { arr = JSON.parse(readFileSync(join(DATA_DIR, f), 'utf8')); } catch (e) {
      console.error(`  ! ${f}: не парсится — ${e.message}`);
      continue;
    }
    for (const rec of Array.isArray(arr) ? arr : []) {
      if (!rec?.name || !rec?.description) continue;
      const key = rec.name.toLowerCase();
      if (!seen.has(key)) seen.set(key, { ...rec, _file: f });
    }
  }
  return [...seen.values()];
}

function toPayload(rec) {
  const damage = (Array.isArray(rec.damage) ? rec.damage : [])
    .filter((d) => d && d.dice && d.damage_type)
    .map((d) => ({ dice: String(d.dice), damage_type: String(d.damage_type) }));
  return {
    name: rec.name,
    description: rec.description,
    card_number: String(rec.slug || '').slice(0, 30),
    rarity: 'common',
    level: Number(rec.level) || 0,
    school: SCHOOLS.has(rec.school) ? rec.school : null,
    casting_time: rec.casting_time || null,
    range: rec.range || null,
    area: rec.area || null,
    component_verbal: !!rec.component_verbal,
    component_somatic: !!rec.component_somatic,
    component_material: !!rec.component_material,
    material_text: rec.material_text || null,
    duration: rec.duration || null,
    concentration: !!rec.concentration,
    ritual: !!rec.ritual,
    classes: Array.isArray(rec.classes) && rec.classes.length ? rec.classes : null,
    attack_roll: !!rec.attack_roll,
    saving_throw: !!rec.saving_throw,
    save_types: Array.isArray(rec.save_types) && rec.save_types.length ? rec.save_types : null,
    save_outcome: rec.save_outcome || null,
    damage: damage.length ? damage : null,
    is_healing: !!rec.is_healing,
    heal_dice: rec.heal_dice || null,
    upcast_description: rec.upcast_description || null,
    source: rec.source_page ? `PHB 2024, стр. ${rec.source_page}` : 'PHB 2024',
    author: 'Admin',
  };
}

async function main() {
  const records = loadBatches();
  const existing = await fetchAll('/api/spells', 'spells');
  const existingNames = new Set(existing.map((s) => s.name.toLowerCase()));
  const existingSlugs = new Set(existing.map((s) => String(s.card_number || '').toLowerCase()));

  const fresh = records.filter((r) => !existingNames.has(r.name.toLowerCase())).slice(0, LIMIT);
  console.log(`Записей в батчах: ${records.length}; уже в базе: ${records.length - fresh.length}; к созданию: ${fresh.length}; режим: ${APPLY ? 'APPLY' : 'dry-run'}`);

  const token = APPLY ? await login() : null;
  const report = { created: [], skippedExisting: records.length - fresh.length, mechanicsDropped: [], failed: [] };

  for (const rec of fresh) {
    const payload = toPayload(rec);
    if (existingSlugs.has(payload.card_number.toLowerCase())) payload.card_number = ''; // бэкенд сгенерирует
    if (rec.mechanics && typeof rec.mechanics === 'object') {
      const errs = validateMech(rec.slug || rec.name, rec.name, rec.mechanics);
      if (errs.length) report.mechanicsDropped.push(`${rec.name}: ${errs[0]}`);
      else payload.mechanics = rec.mechanics;
    }
    if (!APPLY) { report.created.push(`${rec.name} (L${payload.level}${payload.mechanics ? ', mech' : ''})`); continue; }
    try {
      await apiRequest(token, 'POST', '/api/spells', payload);
      report.created.push(`${rec.name} (L${payload.level}${payload.mechanics ? ', mech' : ''})`);
    } catch (e) {
      report.failed.push(`${rec.name}: ${String(e).slice(0, 200)}`);
    }
    if (report.created.length % 25 === 0) console.log(`  …создано ${report.created.length}/${fresh.length}`);
  }

  const out = join(DATA_DIR, 'spells2024-apply-report.json');
  writeFileSync(out, JSON.stringify(report, null, 1));
  console.log(`Готово: создано ${report.created.length}, механика отброшена у ${report.mechanicsDropped.length}, ошибок ${report.failed.length}`);
  console.log(`Отчёт: ${out}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
