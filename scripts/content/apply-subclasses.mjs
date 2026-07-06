#!/usr/bin/env node
/**
 * Импорт подклассов PHB 2024 из результата воркфлоу subclasses-2024-extract.
 * Для каждого подкласса: создаёт эффекты фич (по уровням) → создаёт класс-подкласс
 * (is_subclass, parent_class_id, subclass_level=3, level_progression).
 * Идемпотентен: существующие подклассы (по имени или slug) пропускаются.
 *
 * Запуск: node scripts/content/apply-subclasses.mjs <workflow-output.json> [--apply] [--limit N]
 */
import { readFileSync, writeFileSync } from 'node:fs';
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
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;
const srcPath = process.argv[2];

const KINDS = new Set(['damage', 'healing', 'temp_hp', 'condition', 'modifier', 'movement', 'resource', 'resistance', 'grant_action', 'boon', 'reroll', 'set_die', 'set_value', 'transform', 'narrative', 'grant_proficiency', 'grant_feat', 'grant_spell', 'grant_ability_score', 'grant_sense', 'grant_speed', 'choice']);
const EVENTS = new Set(['attack_roll_made', 'hit', 'miss', 'crit', 'damage_dealt', 'damage_taken', 'saving_throw_made', 'forced_save', 'ability_check_made', 'reduced_to_0_hp', 'creature_enters_reach', 'creature_leaves_reach', 'creature_moves', 'turn_start', 'turn_end', 'spell_cast', 'condition_applied', 'initiative_roll', 'short_rest', 'long_rest', 'on_acquire', 'level_gained']);
const SKILL_IDS = new Set(['athletics', 'acrobatics', 'sleight_of_hand', 'stealth', 'arcana', 'history', 'investigation', 'nature', 'religion', 'animal_handling', 'insight', 'medicine', 'perception', 'survival', 'deception', 'intimidation', 'performance', 'persuasion']);
const ABILITY_IDS = new Set(['str', 'dex', 'con', 'int', 'wis', 'cha']);

function mapEvent(text) {
  const t = String(text).toLowerCase();
  if (/заклинан|заговор/.test(t)) return 'spell_cast';
  if (/получ[а-я]* урон|урон вам|получении урона/.test(t)) return 'damage_taken';
  if (/нанос[а-я]* урон|наносите урон/.test(t)) return 'damage_dealt';
  if (/крит/.test(t)) return 'crit';
  if (/попадан|попадаете/.test(t)) return 'hit';
  if (/промах/.test(t)) return 'miss';
  if (/спасброс/.test(t)) return 'saving_throw_made';
  if (/проверк/.test(t)) return 'ability_check_made';
  if (/до 0|0 хитов/.test(t)) return 'reduced_to_0_hp';
  if (/начал[а-я]* ход|начале.*хода|начинает ход/.test(t)) return 'turn_start';
  if (/конце.*хода|заканчивает ход/.test(t)) return 'turn_end';
  if (/инициатив/.test(t)) return 'initiative_roll';
  if (/короткого отдыха/.test(t)) return 'short_rest';
  if (/долгого отдыха/.test(t)) return 'long_rest';
  if (/атак/.test(t)) return 'attack_roll_made';
  return null;
}

/** Чинит типовые огрехи экстракторов: обёртки без kind, свободный trigger.event, строковый filter. */
function sanitizeMech(m) {
  const fixPayload = (p) => {
    if (!p || typeof p !== 'object') return p;
    if (!p.kind) {
      // {resource:{...}} / {narrative:{...}} → {kind:'resource',...}
      const keys = Object.keys(p);
      if (keys.length === 1 && KINDS.has(keys[0]) && typeof p[keys[0]] === 'object') {
        return { kind: keys[0], ...p[keys[0]] };
      }
    }
    if (p.kind === 'modifier' && p.applies_to && typeof p.applies_to.filter === 'string') {
      const f = p.applies_to.filter.toLowerCase();
      if (SKILL_IDS.has(f)) p.applies_to.filter = { skill: f };
      else if (ABILITY_IDS.has(f)) p.applies_to.filter = { ability: f };
      else return { kind: 'narrative', description: `${p.op === 'advantage' ? 'Преимущество' : 'Модификатор'} (${p.applies_to.roll}): ${p.applies_to.filter}${p.source ? ` — ${p.source}` : ''}` };
    }
    return p;
  };
  for (const eff of m.effects || []) {
    for (const key of ['result', 'results', 'on_hit', 'on_crit', 'on_fail', 'on_success']) {
      if (Array.isArray(eff[key])) eff[key] = eff[key].map(fixPayload);
    }
  }
  const trig = m.activation?.trigger;
  if (trig && typeof trig === 'object') {
    if (!EVENTS.has(String(trig.event))) {
      const mapped = mapEvent(trig.event);
      if (mapped) {
        // Точная формулировка условия остаётся в описании фичи.
        delete trig.circumstances;
        trig.event = mapped;
      } else {
        // событие не выразимо — уносим текст в narrative первого interaction
        const first = (m.effects || []).find((e) => Array.isArray(e.result));
        if (first) first.result.unshift({ kind: 'narrative', description: `Срабатывание: ${trig.event}` });
        delete m.activation.trigger;
      }
    }
  }
  return m;
}

function validateMech(name, mechanics) {
  const card = {
    schema_version: '1.0', id: 'subclass-feature', name, kind: 'passive_effect',
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
  const subclasses = (doc.result?.subclasses || doc.subclasses || []).slice(0, LIMIT);
  const classes = await fetchAll('/api/classes', 'classes');
  const parents = new Map(classes.filter((c) => !c.is_subclass).map((c) => [c.name, c]));
  const existingNames = new Set(classes.map((c) => c.name.toLowerCase()));
  const existingSlugs = new Set(classes.map((c) => String(c.card_number || '').toLowerCase()));

  console.log(`Подклассов на входе: ${subclasses.length}; режим: ${APPLY ? 'APPLY' : 'dry-run'}`);
  const token = APPLY ? await login() : null;
  const report = { created: [], skipped: [], mechDropped: [], failed: [] };

  for (const sc of subclasses) {
    const parent = parents.get(sc.class_name);
    if (!parent) { report.failed.push(`${sc.name}: родитель «${sc.class_name}» не найден`); continue; }
    if (existingNames.has(sc.name.toLowerCase()) || existingSlugs.has(String(sc.slug).toLowerCase())) {
      report.skipped.push(sc.name); continue;
    }

    // 1) эффекты фич по уровням
    const levelProgression = {};
    let ok = true;
    for (const f of sc.features || []) {
      let mechanics = null;
      if (f.mechanics && typeof f.mechanics === 'object') {
        const fixed = sanitizeMech(JSON.parse(JSON.stringify(f.mechanics)));
        const errs = validateMech(f.name, fixed);
        if (errs.length) report.mechDropped.push(`${sc.name} / ${f.name}: ${errs[0]}`);
        else mechanics = fixed;
      }
      const payload = {
        name: f.name,
        description: f.description,
        rarity: 'common',
        effect_type: 'class_ability',
        source: `PHB 2024${sc.source_print_page ? `, стр. ${sc.source_print_page}` : ''}`,
        ...(mechanics ? { mechanics } : {}),
      };
      if (!APPLY) {
        (levelProgression[String(f.level)] ||= { effects: [], actions: [] }).effects.push(`<dry:${f.name}>`);
        continue;
      }
      try {
        const created = await apiRequest(token, 'POST', '/api/effects', payload);
        const id = created?.id || created?.effect?.id;
        if (!id) throw new Error('нет id в ответе');
        (levelProgression[String(f.level)] ||= { effects: [], actions: [] }).effects.push(id);
      } catch (e) {
        report.failed.push(`${sc.name} / ${f.name}: ${String(e).slice(0, 140)}`);
        ok = false;
        break;
      }
    }
    if (!ok) continue;

    // 2) сам подкласс
    const clPayload = {
      name: sc.name,
      description: sc.description,
      card_number: String(sc.slug || '').slice(0, 30),
      is_subclass: true,
      parent_class_id: parent.id,
      subclass_level: 3,
      level_progression: levelProgression,
      source: `PHB 2024${sc.source_print_page ? `, стр. ${sc.source_print_page}` : ''}`,
    };
    if (!APPLY) { report.created.push(`${sc.name} (${sc.class_name}, фич: ${(sc.features || []).length})`); continue; }
    try {
      await apiRequest(token, 'POST', '/api/classes', clPayload);
      report.created.push(`${sc.name} (${sc.class_name}, фич: ${(sc.features || []).length})`);
    } catch (e) {
      report.failed.push(`${sc.name}: ${String(e).slice(0, 160)}`);
    }
  }

  const out = join(__dirname, 'batches/data/subclasses-apply-report.json');
  writeFileSync(out, JSON.stringify(report, null, 1));
  console.log(`Создано: ${report.created.length}; пропущено: ${report.skipped.length}; механика отброшена: ${report.mechDropped.length}; ошибок: ${report.failed.length}`);
  for (const f of report.failed.slice(0, 10)) console.log(' fail:', f);
  for (const m of report.mechDropped.slice(0, 10)) console.log(' mech:', m);
  console.log(`Отчёт: ${out}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
