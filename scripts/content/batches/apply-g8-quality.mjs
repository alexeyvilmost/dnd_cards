#!/usr/bin/env node
/**
 * Применяет качественный проход G8–G9/G7: механики заклинаний из
 * data/g8-output-*.json (action=upgrade) и сущности черт из
 * data/g7-output-feats.json. Всё валидируется по mechanics.schema.json.
 * Запуск: node scripts/content/batches/apply-g8-quality.mjs [--apply]
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { apiRequest, fetchAll, login } from '../api.mjs';
import { ContentSeeder } from '../seed-framework.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, 'data');
const require = createRequire(import.meta.url);
const Ajv = require(join(__dirname, '../../../frontend/node_modules/ajv/dist/ajv.js')).default;
const addFormats = require(join(__dirname, '../../../frontend/node_modules/ajv-formats/dist/index.js')).default;
const schema = JSON.parse(readFileSync(join(__dirname, '../../../frontend/src/schemas/mechanics.schema.json'), 'utf8'));

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validateCard = ajv.compile(schema);
const APPLY = process.argv.includes('--apply');

function validate(id, name, kind, mechanics) {
  const card = {
    schema_version: '1.0',
    id: String(id).replace(/[^a-z0-9-]/gi, '-').toLowerCase(),
    name,
    kind,
    activation: mechanics.activation || { mode: 'passive' },
    interactions: mechanics.effects || [],
    ...(mechanics.uses ? { uses: mechanics.uses } : {}),
    ...(mechanics.targeting ? { targeting: mechanics.targeting } : {}),
  };
  if (validateCard(card)) return [];
  return (validateCard.errors || []).map((e) => `${e.instancePath}: ${e.message}`);
}

async function main() {
  const errors = [];

  // ── Заклинания ──
  const spells = await fetchAll('/api/spells', 'spells');
  const byCn = new Map(spells.map((s) => [s.card_number, s]));
  const upgrades = [];
  for (const f of readdirSync(DATA).filter((f) => /^g8-output-\d+\.json$/.test(f)).sort()) {
    for (const rec of JSON.parse(readFileSync(join(DATA, f), 'utf8'))) {
      if (rec.action !== 'upgrade' || !rec.mechanics) continue;
      const spell = byCn.get(rec.card_number);
      if (!spell) { errors.push(`${f}: заклинание не найдено: ${rec.card_number}`); continue; }
      const errs = validate(rec.card_number, rec.name, 'spell', rec.mechanics);
      if (errs.length) { errors.push(`${f} ${rec.name}: ${errs.slice(0, 3).join('; ')}`); continue; }
      upgrades.push({ spell, mechanics: rec.mechanics, name: rec.name });
    }
  }
  console.log(`Заклинаний к апгрейду: ${upgrades.length}`);

  // ── Черты ──
  const featsData = JSON.parse(readFileSync(join(DATA, 'g7-output-feats.json'), 'utf8'));
  for (const feat of featsData) {
    for (const e of feat.effects || []) {
      const errs = validate(e.cardNumber, e.name, 'passive_effect', e.mechanics);
      if (errs.length) errors.push(`feat ${feat.feat_name} / ${e.cardNumber}: ${errs.slice(0, 3).join('; ')}`);
    }
    for (const a of feat.actions || []) {
      const errs = validate(a.cardNumber, a.name, 'action', a.mechanics);
      if (errs.length) errors.push(`feat ${feat.feat_name} / ${a.cardNumber}: ${errs.slice(0, 3).join('; ')}`);
    }
  }
  console.log(`Черт: ${featsData.length} (${featsData.reduce((s, f) => s + (f.effects?.length || 0), 0)} эффектов, ${featsData.reduce((s, f) => s + (f.actions?.length || 0), 0)} действий)`);

  if (errors.length) {
    console.log('── Ошибки валидации:');
    for (const e of errors) console.log(' ', e);
    process.exit(1);
  }
  if (!APPLY) { console.log('Dry-run OK. Запустите с --apply.'); return; }

  const token = await login();

  for (const { spell, mechanics, name } of upgrades) {
    await apiRequest(token, 'PUT', `/api/spells/${spell.id}`, { mechanics });
    console.log(`  spell ✓ ${name}`);
  }

  const seeder = new ContentSeeder({ token });
  await seeder.loadIndexes();
  const feats = await fetchAll('/api/feats', 'feats');
  const featByCn = new Map(feats.map((x) => [x.card_number, x]));

  for (const feat of featsData) {
    const dbFeat = featByCn.get(feat.feat_card_number);
    if (!dbFeat) { console.log(`  feat ✗ не найдена: ${feat.feat_card_number}`); continue; }
    const effectIds = [];
    const actionIds = [];
    for (const e of feat.effects || []) {
      const created = await seeder.upsertEffect({
        cardNumber: e.cardNumber, name: e.name, description: e.description, mechanics: e.mechanics,
      });
      if (created?.id) effectIds.push(created.id);
    }
    for (const a of feat.actions || []) {
      const created = await seeder.upsertAction({
        cardNumber: a.cardNumber, name: a.name, description: a.description,
        resource: a.resource || 'action', resources: a.resources, mechanics: a.mechanics,
      });
      if (created?.id) actionIds.push(created.id);
    }
    const re = [...new Set([...(dbFeat.related_effects || []), ...effectIds])];
    const ra = [...new Set([...(dbFeat.related_actions || []), ...actionIds])];
    await apiRequest(token, 'PUT', `/api/feats/${dbFeat.id}`, { related_effects: re, related_actions: ra });
    console.log(`  feat ✓ ${feat.feat_name}: +${effectIds.length} эфф., +${actionIds.length} дейст.`);
  }
  console.log('Готово.');
}

main().catch((e) => { console.error(e); process.exit(1); });
