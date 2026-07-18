#!/usr/bin/env node
/**
 * G8–G9: автоконвертер структурных полей заклинаний → унифицированная механика.
 *
 * Высокая уверенность (реальная механика):
 *   - attack_roll + damage        → resolution: attack_roll (ability: spellcasting)
 *   - saving_throw + save_types + damage → resolution: save (dc: 8+prof+spellcasting)
 *   - is_healing + heal_dice      → resolution: auto, kind: healing (+spellcasting)
 * Всё остальное → narrative-фолбэк с корректной стоимостью (казуется, пишет в лог).
 * Скейлинг парсится из upcast_description («увеличивается на NкM»).
 *
 * Запуск: node scripts/content/spell-mechanics-converter.mjs        (dry-run отчёт)
 *         node scripts/content/spell-mechanics-converter.mjs --apply
 * Уже заполненные mechanics не перезаписываются (FORCE=1 — перезаписать).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { apiRequest, fetchAll, login } from './api.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const Ajv = require(join(__dirname, '../../frontend/node_modules/ajv/dist/ajv.js')).default;
const addFormats = require(join(__dirname, '../../frontend/node_modules/ajv-formats/dist/index.js')).default;

const schema = JSON.parse(readFileSync(join(__dirname, '../../frontend/src/schemas/mechanics.schema.json'), 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validateCard = ajv.compile(schema);

const APPLY = process.argv.includes('--apply');
const FORCE = process.env.FORCE === '1';

const SPELL_DC = '8 + prof + spellcasting';

function hasMechanics(s) {
  return !!s.mechanics && typeof s.mechanics === 'object' && Object.keys(s.mechanics).length > 0;
}

/** «Бонусное действие…» → bonus_action; «Реакция…» → reaction; иначе action. */
function castingResource(castingTime) {
  const ct = String(castingTime || '').toLowerCase();
  if (ct.startsWith('бонусное действие')) return 'bonus_action';
  if (ct.startsWith('реакция')) return 'reaction';
  return 'action';
}

function activationFor(spell) {
  const cost = [{ resource: castingResource(spell.casting_time) }];
  // Канон схемы: {resource:'spell_slot', level:N}; рантайм маппит в spell_slot_N (costKey).
  if (spell.level >= 1) cost.push({ resource: 'spell_slot', level: spell.level, amount: 1 });
  return { mode: 'active', cost };
}

/** «увеличивается на 1к8» из upcast_description → { per, dice }. */
function scalingFor(spell) {
  const text = String(spell.upcast_description || '');
  const m = text.match(/увеличивается на (\d+)к(\d+)/i);
  if (!m) return null;
  const dice = `${m[1]}d${m[2]}`;
  return spell.level === 0
    ? { per: 'character_level', dice }
    : { per: 'spell_slot_above', dice };
}

function damagePayloads(spell, { half = false } = {}) {
  const scaling = scalingFor(spell);
  return (spell.damage || []).map((d, i) => ({
    kind: 'damage',
    dice: d.dice,
    type: d.damage_type || 'force',
    ...(i === 0 && scaling ? { scaling } : {}),
    ...(half ? { on_success: 'half' } : {}),
  }));
}

function targetingFor(spell) {
  const range = String(spell.range || '').toLowerCase();
  if (range.includes('на себя')) return { shape: 'self' };
  return { shape: 'single', range: spell.range || undefined, filter: 'any' };
}

function attackKind(spell) {
  const range = String(spell.range || '').toLowerCase();
  return range.includes('касание') || range.includes('на себя') ? 'spell_melee' : 'spell_ranged';
}

function convert(spell) {
  const activation = activationFor(spell);
  const targeting = targetingFor(spell);

  if (spell.attack_roll && spell.damage?.length) {
    return {
      category: 'attack',
      mechanics: {
        activation,
        targeting,
        effects: [{
          resolution: 'attack_roll',
          attack_kind: attackKind(spell),
          ability: 'spellcasting',
          vs: 'ac',
          on_hit: damagePayloads(spell),
        }],
      },
    };
  }

  if (spell.saving_throw && spell.save_types?.length && spell.damage?.length) {
    const halfOnSuccess = /полов/i.test(String(spell.save_outcome || ''));
    return {
      category: 'save',
      mechanics: {
        activation,
        targeting,
        effects: [{
          resolution: 'save',
          who: 'target',
          ability: spell.save_types[0],
          dc: SPELL_DC,
          on_fail: damagePayloads(spell),
          on_success: halfOnSuccess ? damagePayloads(spell, { half: true }) : [],
        }],
      },
    };
  }

  if (spell.is_healing && spell.heal_dice) {
    const scaling = scalingFor(spell);
    return {
      category: 'heal',
      mechanics: {
        activation,
        targeting,
        effects: [{
          resolution: 'auto',
          result: [{
            kind: 'healing',
            amount: `${spell.heal_dice} + spellcasting`,
            ...(scaling ? { scaling } : {}),
          }],
        }],
      },
    };
  }

  return {
    category: 'narrative',
    mechanics: {
      activation,
      targeting,
      effects: [{
        resolution: 'auto',
        result: [{ kind: 'narrative', description: `${spell.name}: см. описание заклинания.` }],
      }],
    },
  };
}

function validate(spell, mechanics) {
  const id = String(spell.card_number || spell.id || '')
    .trim()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'draft';
  const card = {
    schema_version: '1.0',
    id,
    name: spell.name,
    kind: 'spell',
    activation: mechanics.activation,
    interactions: mechanics.effects,
    ...(mechanics.targeting ? { targeting: mechanics.targeting } : {}),
  };
  if (validateCard(card)) return [];
  return (validateCard.errors || []).map((e) => `${e.instancePath}: ${e.message}`);
}

async function main() {
  const spells = (await fetchAll('/api/spells', 'spells')).filter((s) => s.level <= 1);
  console.log(`Заклинаний L0–1: ${spells.length}; режим: ${APPLY ? 'APPLY' : 'dry-run'}${FORCE ? ' +FORCE' : ''}`);

  const stats = { attack: 0, save: 0, heal: 0, narrative: 0, skipped: 0, invalid: 0 };
  const narrativeNames = [];
  const invalid = [];
  const toApply = [];

  for (const spell of spells) {
    if (hasMechanics(spell) && !FORCE) { stats.skipped++; continue; }
    const { category, mechanics } = convert(spell);
    const errors = validate(spell, mechanics);
    if (errors.length) {
      stats.invalid++;
      invalid.push({ name: spell.name, errors: errors.slice(0, 3) });
      continue;
    }
    stats[category]++;
    if (category === 'narrative') narrativeNames.push(`${spell.name} (${spell.card_number})`);
    toApply.push({ spell, mechanics });
  }

  console.log('Категории:', JSON.stringify(stats));
  if (invalid.length) {
    console.log('── Ошибки схемы:');
    for (const e of invalid) console.log(`  ${e.name}: ${e.errors.join('; ')}`);
  }
  console.log(`── Narrative-фолбэк (${narrativeNames.length}) — кандидаты на ручную механику:`);
  for (const n of narrativeNames) console.log(`  ${n}`);

  if (!APPLY) { console.log('\nDry-run: ничего не записано. Запустите с --apply.'); return; }

  const token = await login();
  let applied = 0;
  for (const { spell, mechanics } of toApply) {
    await apiRequest(token, 'PUT', `/api/spells/${spell.id}`, { mechanics });
    applied++;
    if (applied % 20 === 0) console.log(`  …${applied}/${toApply.length}`);
  }
  console.log(`Записано механик: ${applied}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
