#!/usr/bin/env node
/**
 * Линтер механик по mechanics.schema.json (ajv).
 * Запуск: node scripts/lint-mechanics.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const Ajv = require(join(__dirname, '../frontend/node_modules/ajv/dist/ajv.js')).default;
const addFormats = require(join(__dirname, '../frontend/node_modules/ajv-formats/dist/index.js')).default;

const schema = JSON.parse(readFileSync(join(__dirname, '../frontend/src/schemas/mechanics.schema.json'), 'utf8'));
const API_URL = process.env.API_URL || 'https://backend-production-41c3.up.railway.app';

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

function normalize(mechanics, meta) {
  if (!mechanics) return null;
  return {
    schema_version: '1.0',
    id: (meta.id || 'draft').replace(/[^a-z0-9-]/gi, '-').toLowerCase(),
    name: meta.name || 'draft',
    kind: meta.kind,
    activation: mechanics.activation || { mode: 'passive' },
    interactions: mechanics.effects || mechanics.interactions || [],
    ...(mechanics.uses ? { uses: mechanics.uses } : {}),
    ...(mechanics.targeting ? { targeting: mechanics.targeting } : {}),
  };
}

async function fetchAll(path, key) {
  const items = [];
  let page = 1;
  while (true) {
    const res = await fetch(`${API_URL}${path}?page=${page}&limit=100`);
    if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
    const data = await res.json();
    const batch = data[key] || [];
    items.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return items;
}

async function main() {
  console.log(`API: ${API_URL}`);
  const checks = [
    ...(await fetchAll('/api/effects', 'effects')).map((e) => ({
      label: `effect:${e.card_number || e.id}`,
      mechanics: e.mechanics,
      kind: 'passive_effect',
      name: e.name,
      id: e.card_number || e.id,
    })),
    ...(await fetchAll('/api/actions', 'actions')).map((a) => ({
      label: `action:${a.card_number || a.id}`,
      mechanics: a.mechanics,
      kind: 'action',
      name: a.name,
      id: a.card_number || a.id,
    })),
  ];

  const errors = [];
  for (const c of checks) {
    if (!c.mechanics) continue;
    const card = normalize(c.mechanics, { id: c.id, name: c.name, kind: c.kind });
    if (!validate(card)) {
      errors.push({
        label: c.label,
        details: (validate.errors || []).map((e) => `${e.instancePath}: ${e.message}`).slice(0, 3),
      });
    }
  }

  console.log(`Проверено сущностей с механикой: ${checks.filter((c) => c.mechanics).length}`);
  if (errors.length === 0) {
    console.log('✅ Все механики проходят схему');
  } else {
    console.log(`❌ Ошибок: ${errors.length}`);
    for (const e of errors) {
      console.log(`  ${e.label}: ${e.details.join('; ')}`);
    }
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
