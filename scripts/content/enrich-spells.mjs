#!/usr/bin/env node
/**
 * Обогащение механикой существующих заклинаний без mechanics (в осн. 2-й круг,
 * посеянный до конвейера механик). Генерация через /api/ai/mechanics
 * (kind=spell, структурированные факты в extra), валидация схемой,
 * детерминированная страховка стоимости: у заклинания N-го круга в cost
 * обязан быть {resource:'spell_slot', level:N} + действие по casting_time.
 *
 * Запуск: node scripts/content/enrich-spells.mjs [--apply] [--limit N]
 * Отчёт: scripts/content/batches/data/spells-enrichment-report.json
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
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

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

function actionCost(castingTime) {
  const ct = String(castingTime || '').toLowerCase();
  if (ct.includes('бонус')) return { resource: 'bonus_action' };
  if (ct.includes('реакц')) return { resource: 'reaction' };
  if (ct.includes('действие') || ct === '1 action') return { resource: 'action' };
  return null; // ритуалы/минуты — оставляем как сгенерировано
}

/** Страховка: слот своего круга и тип действия в cost. */
function fixCost(mechanics, spell) {
  const activation = mechanics.activation || (mechanics.activation = { mode: 'active', cost: [] });
  if (!Array.isArray(activation.cost)) activation.cost = [];
  const cost = activation.cost;
  if (spell.level > 0) {
    const slot = cost.find((c) => c && c.resource === 'spell_slot');
    if (!slot) cost.push({ resource: 'spell_slot', level: spell.level, amount: 1 });
    else if (slot.level !== spell.level) slot.level = spell.level;
  }
  const act = actionCost(spell.casting_time);
  if (act && !cost.some((c) => c && ['action', 'bonus_action', 'reaction'].includes(c.resource))) {
    cost.unshift(act);
  }
}

async function aiMechanics(spell) {
  const facts = [
    `Круг: ${spell.level}`,
    spell.school ? `Школа: ${spell.school}` : '',
    spell.casting_time ? `Время накладывания: ${spell.casting_time}` : '',
    spell.range ? `Дистанция: ${spell.range}` : '',
    spell.area ? `Область: ${spell.area}` : '',
    spell.duration ? `Длительность: ${spell.duration}` : '',
    spell.concentration ? 'Концентрация' : '',
    spell.attack_roll ? 'Требуется бросок атаки заклинанием' : '',
    spell.saving_throw ? `Спасбросок: ${(spell.save_types || []).join(', ') || '?'}; при успехе: ${spell.save_outcome || '?'}` : '',
    spell.damage?.length ? `Урон: ${spell.damage.map((d) => `${d.dice} ${d.damage_type}`).join(' + ')}` : '',
    spell.is_healing ? `Лечение: ${spell.heal_dice || ''}` : '',
  ].filter(Boolean).join('; ');
  const body = {
    kind: 'spell',
    name: spell.name,
    description: [spell.description, spell.upcast_description ? `На высоких кругах: ${spell.upcast_description}` : '']
      .filter(Boolean).join('\n'),
    extra: facts,
  };
  const res = await fetch(`${apiUrl()}/api/ai/mechanics`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`AI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).mechanics;
}

async function main() {
  const spells = await fetchAll('/api/spells', 'spells');
  const hasMech = (s) => s.mechanics && typeof s.mechanics === 'object' && Object.keys(s.mechanics).length > 0;
  const candidates = spells.filter((s) => !hasMech(s)).slice(0, LIMIT);
  console.log(`Заклинаний: ${spells.length}; без механики: ${candidates.length}; режим: ${APPLY ? 'APPLY' : 'dry-run'}`);

  const token = APPLY ? await login() : null;
  const report = { enriched: [], failed: [] };
  let done = 0;

  for (const spell of candidates) {
    done++;
    try {
      const mechanics = await aiMechanics(spell);
      fixCost(mechanics, spell);
      const errs = validateMech(spell.card_number || spell.id, spell.name, mechanics);
      if (errs.length) { report.failed.push(`${spell.name}: схема — ${errs[0]}`); continue; }
      report.enriched.push(`${spell.name} (L${spell.level})`);
      if (APPLY) await apiRequest(token, 'PUT', `/api/spells/${spell.id}`, { mechanics });
    } catch (e) {
      report.failed.push(`${spell.name}: ${String(e).slice(0, 150)}`);
    }
    if (done % 15 === 0) console.log(`  …${done}/${candidates.length} (ошибок ${report.failed.length})`);
    await new Promise((r) => setTimeout(r, 150));
  }

  const out = join(__dirname, 'batches/data/spells-enrichment-report.json');
  writeFileSync(out, JSON.stringify(report, null, 1));
  console.log(`Готово: обогащено ${report.enriched.length}, ошибок ${report.failed.length}`);
  console.log(`Отчёт: ${out}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
