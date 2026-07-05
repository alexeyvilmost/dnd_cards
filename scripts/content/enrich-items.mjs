#!/usr/bin/env node
/**
 * Обогащение предметов универсальной механикой.
 * 1. Старый формат effects (17 карт) — детерминированная конвертация.
 * 2. Магические предметы с механическим текстом — генерация через
 *    /api/ai/mechanics (тот же конвейер, что кнопка «AI»), валидация схемой.
 * Только-narrative пассивки НЕ записываются (бесполезны) — попадают в отчёт
 * неподдерживаемых. Отчёт: scripts/content/batches/data/items-enrichment-report.json
 *
 * Запуск: node scripts/content/enrich-items.mjs [--apply] [--limit N]
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

const SKILL_MAP = { // старый targetSpecific → id навыка
  athletics: 'athletics', acrobatics: 'acrobatics', sleight_of_hand: 'sleight_of_hand',
  stealth: 'stealth', arcana: 'arcana', history: 'history', investigation: 'investigation',
  nature: 'nature', religion: 'religion', animal_handling: 'animal_handling',
  insight: 'insight', medicine: 'medicine', perception: 'perception', survival: 'survival',
  deception: 'deception', intimidation: 'intimidation', performance: 'performance', persuasion: 'persuasion',
};
const ABILITY_MAP = {
  strength: 'str', dexterity: 'dex', constitution: 'con',
  intelligence: 'int', wisdom: 'wis', charisma: 'cha',
};

function validateMech(id, name, mechanics) {
  const card = {
    schema_version: '1.0',
    id: String(id).replace(/[^a-z0-9-]/gi, '-').toLowerCase(),
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

/** Все payload-ы механики. */
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
  const mode = m.activation?.mode;
  // Пассивка из одних narrative бесполезна; активируемый narrative допустим (лог).
  if (mode === 'passive' && meaningful.length === 0) return false;
  return meaningful.length > 0 || mode === 'active';
}

/** Детерминированная конвертация старого формата effects. */
function convertOldEffects(card) {
  const mods = [];
  const unsupported = [];
  for (const e of card.effects || []) {
    const value = `${e.modifier === '-' ? '-' : '+'}${e.value}`;
    if (e.targetType === 'skill') {
      const skill = SKILL_MAP[e.targetSpecific];
      if (!skill) { unsupported.push(`навык «${e.targetSpecific}»`); continue; }
      mods.push({ kind: 'modifier', applies_to: { roll: 'ability_check', filter: { skill } }, op: 'add', value, source: card.name });
    } else if (e.targetType === 'saving_throw') {
      const ab = ABILITY_MAP[e.targetSpecific] || (e.targetSpecific === 'all' ? null : undefined);
      if (ab === undefined) { unsupported.push(`спасбросок «${e.targetSpecific}»`); continue; }
      mods.push({
        kind: 'modifier',
        applies_to: ab ? { roll: 'saving_throw', filter: { ability: ab } } : { roll: 'saving_throw' },
        op: 'add', value, source: card.name,
      });
    } else if (e.targetType === 'characteristic') {
      // Постоянное изменение значения характеристики движок не применяет.
      unsupported.push(`характеристика «${e.targetSpecific}» ${value} (бонусы к характеристикам не поддерживаются)`);
    }
  }
  if (!mods.length) return { mechanics: null, unsupported };
  return {
    mechanics: { activation: { mode: 'passive' }, effects: [{ resolution: 'auto', result: mods }] },
    unsupported,
  };
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
  const cards = await fetchAll('/api/cards', 'cards');
  const bonusRe = /(\+\d|преимуществ|помех|сопротивлен|невидим|скорост|заклинан|урон|бросок|спасбро|лечени|хиты|temp|заряд)/i;

  const hasMech = (c) => c.mechanics && typeof c.mechanics === 'object' && Object.keys(c.mechanics).length > 0;
  const oldFormat = cards.filter((c) => !hasMech(c) && Array.isArray(c.effects) && c.effects.length);
  const aiCandidates = cards.filter((c) =>
    !hasMech(c)
    && !(Array.isArray(c.effects) && c.effects.length)
    && c.rarity && c.rarity !== 'common'
    && bonusRe.test((c.description || '') + (c.detailed_description || '')),
  ).slice(0, LIMIT);

  console.log(`Карт: ${cards.length}; старый формат: ${oldFormat.length}; AI-кандидатов: ${aiCandidates.length}; режим: ${APPLY ? 'APPLY' : 'dry-run'}`);

  const token = APPLY ? await login() : null;
  const report = { converted: [], enriched: [], narrativeOnly: [], unsupported: [], failed: [] };

  // ── Старый формат ──
  for (const card of oldFormat) {
    const { mechanics, unsupported } = convertOldEffects(card);
    for (const u of unsupported) report.unsupported.push(`${card.name}: ${u}`);
    if (!mechanics) continue;
    const errs = validateMech(card.card_number || card.id, card.name, mechanics);
    if (errs.length) { report.failed.push(`${card.name}: схема — ${errs[0]}`); continue; }
    report.converted.push(card.name);
    if (APPLY) await apiRequest(token, 'PUT', `/api/cards/${card.id}`, { mechanics });
  }

  // ── AI-обогащение ──
  let done = 0;
  for (const card of aiCandidates) {
    done++;
    try {
      const mechanics = await aiMechanics(card);
      const errs = validateMech(card.card_number || card.id, card.name, mechanics);
      if (errs.length) { report.failed.push(`${card.name}: схема — ${errs[0]}`); continue; }
      if (!isUsefulMechanics(mechanics)) {
        report.narrativeOnly.push(`${card.name}: ${String(card.description).slice(0, 90)}`);
        continue;
      }
      report.enriched.push(card.name);
      if (APPLY) await apiRequest(token, 'PUT', `/api/cards/${card.id}`, { mechanics });
    } catch (e) {
      report.failed.push(`${card.name}: ${String(e).slice(0, 120)}`);
    }
    if (done % 20 === 0) console.log(`  …${done}/${aiCandidates.length} (обогащено ${report.enriched.length})`);
    await new Promise((r) => setTimeout(r, 150));
  }

  const out = join(__dirname, 'batches/data/items-enrichment-report.json');
  writeFileSync(out, JSON.stringify(report, null, 1));
  console.log(`Готово: конвертировано ${report.converted.length}, обогащено ${report.enriched.length}, ` +
    `narrative-only ${report.narrativeOnly.length}, неподдерживаемых пометок ${report.unsupported.length}, ошибок ${report.failed.length}`);
  console.log(`Отчёт: ${out}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
