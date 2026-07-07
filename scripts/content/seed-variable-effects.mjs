#!/usr/bin/env node
/**
 * Переводит контент на систему переменных (docs/variables.md), соблюдая парадигму
 * гранулярности: КАЖДОЕ пороговое значение переменной — ОТДЕЛЬНЫЙ setter-эффект в
 * level_progression класса. Плюс чинит монашеские эффекты (проза → martial_arts_die)
 * и действие Ярость (использует rage_damage_modifier).
 *
 * Запуск: node scripts/content/seed-variable-effects.mjs [--apply]
 * (без --apply — dry-run, ничего не пишет)
 */
import { apiRequest, fetchAll, login } from './api.mjs';

const APPLY = process.argv.includes('--apply');

// Переменная → класс → пороги {уровень: значение}. Каждый порог = отдельный эффект.
const VARS = [
  {
    id: 'martial_arts_die', label: 'Кость боевых искусств', type: 'dice',
    classId: 'ed17e7b6-366f-43ef-a94c-2d62dd5d7b20', // Монах
    steps: { 1: '1d6', 5: '1d8', 11: '1d10', 17: '1d12' },
  },
  {
    id: 'rage_damage_modifier', label: 'Бонус урона Ярости', type: 'number',
    classId: '9cc3ffcd-8de0-4bc1-a1c3-0a0e67952ab8', // Варвар
    steps: { 1: '2', 9: '3', 16: '4' },
  },
  {
    id: 'bardic_inspiration_die', label: 'Кость Вдохновения барда', type: 'dice',
    classId: 'be96272c-8585-438d-ac32-b2788f1b1741', // Бард
    steps: { 1: '1d6', 5: '1d8', 10: '1d10', 15: '1d12' },
  },
];

const disp = (type, v) => (type === 'dice' ? String(v).replace(/^1d/, 'd') : v);
const slug = (id) => id.replace(/_/g, '-');

function setterEffectPayload(v, level, value) {
  const shown = disp(v.type, value);
  return {
    name: `${v.label}: ${shown}`,
    description: `Ваша переменная «${v.label}» становится ${shown} (с ${level} уровня).`,
    rarity: 'common',
    effect_type: 'class_ability',
    card_number: `VAR-${slug(v.id)}-${level}`,
    type: 'variable_setter',
    mechanics: {
      name: `${v.label}: ${shown}`,
      activation: { mode: 'passive' },
      effects: [{ resolution: 'auto', result: [{ kind: 'variable', op: 'set', id: v.id, value }] }],
    },
  };
}

// Формула-строка: проза монаха → токены движка.
function fixFormula(s) {
  if (typeof s !== 'string') return s;
  let out = s
    .replace(/Кость боевых искусств/gi, 'martial_arts_die')
    .replace(/модификатор Мудрости/gi, 'wis')
    .replace(/модификатор Силы/gi, 'str')
    .replace(/×/g, '*')
    .replace(/\((?:минимум|мин\.?)[^)]*\)/gi, '') // "(минимум 1 Хит)"
    .replace(/\s+/g, ' ')
    .trim();
  return out;
}

// Рекурсивно чинит поля-формулы (amount/dice/value/dc) в объекте механики.
function fixMechanicsFormulas(obj) {
  if (Array.isArray(obj)) return obj.map(fixMechanicsFormulas);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(obj)) {
      out[k] = ['amount', 'dice', 'value', 'dc'].includes(k) ? fixFormula(val) : fixMechanicsFormulas(val);
    }
    return out;
  }
  return obj;
}

async function upsertEffect(token, effects, payload, report) {
  const existing = effects.find((e) => e.card_number === payload.card_number);
  if (existing) {
    report.push(`  ~ effect ${payload.card_number} (${payload.name}) → PUT`);
    if (APPLY) {
      const r = await apiRequest(token, 'PUT', `/api/effects/${existing.id}`, payload);
      return r.id || existing.id;
    }
    return existing.id;
  }
  report.push(`  + effect ${payload.card_number} (${payload.name}) → POST`);
  if (APPLY) {
    const r = await apiRequest(token, 'POST', '/api/effects', payload);
    return r.id;
  }
  return `dry-${payload.card_number}`;
}

async function main() {
  const token = APPLY ? await login() : null;
  const report = [];
  const effects = await fetchAll('/api/effects', 'effects');
  const classes = await fetchAll('/api/classes', 'classes');

  // 1) Setter-эффекты + привязка к level_progression.
  for (const v of VARS) {
    report.push(`\n=== ${v.label} (${v.id}) ===`);
    const cl = classes.find((c) => c.id === v.classId);
    if (!cl) { report.push(`  ! класс ${v.classId} не найден`); continue; }
    const lp = { ...(cl.level_progression || {}) };
    for (const [levelStr, value] of Object.entries(v.steps)) {
      const level = Number(levelStr);
      const payload = setterEffectPayload(v, level, value);
      const effId = await upsertEffect(token, effects, payload, report);
      const entry = lp[level] ? { ...lp[level] } : { effects: [], actions: [] };
      const effList = Array.isArray(entry.effects) ? [...entry.effects] : [];
      if (!effList.includes(effId)) effList.push(effId);
      entry.effects = effList;
      lp[level] = entry;
    }
    report.push(`  → PUT ${cl.name}.level_progression (уровни: ${Object.keys(v.steps).join(', ')})`);
    if (APPLY) await apiRequest(token, 'PUT', `/api/classes/${cl.id}`, { ...cl, level_progression: lp });
  }

  // 2) Починить монашеские эффекты (проза → martial_arts_die).
  report.push(`\n=== фикс формул монаха ===`);
  const monkBroken = effects.filter((e) => {
    const m = JSON.stringify(e.mechanics || {});
    return /боевых искусств/i.test(m);
  });
  for (const e of monkBroken) {
    const fixed = fixMechanicsFormulas(e.mechanics);
    report.push(`  ~ ${e.card_number} (${e.name}): формулы → токены`);
    if (APPLY) await apiRequest(token, 'PUT', `/api/effects/${e.id}`, { ...e, mechanics: fixed });
  }

  // 3) Ярость: добавить модификатор урона из rage_damage_modifier (гранулярно —
  //    отдельным payload'ом), сохранив нарратив.
  const actions = await fetchAll('/api/actions', 'actions');
  const rage = actions.find((a) => a.card_number === 'ACT-rage');
  if (rage) {
    report.push(`\n=== Ярость (${rage.card_number}) ===`);
    const mech = JSON.parse(JSON.stringify(rage.mechanics || {}));
    const eff0 = (mech.effects && mech.effects[0]) || {};
    const results = Array.isArray(eff0.result) ? eff0.result : [];
    const hasVarMod = results.some((p) => p.kind === 'modifier' && String(p.value).includes('rage_damage_modifier'));
    if (!hasVarMod) {
      results.push({
        kind: 'modifier',
        applies_to: { roll: 'damage', filter: { ability: 'str' } },
        op: 'add', value: 'rage_damage_modifier',
        duration: { type: 'rounds', amount: 10 },
      });
      eff0.result = results;
      mech.effects[0] = eff0;
      report.push(`  + modifier damage += rage_damage_modifier`);
      if (APPLY) await apiRequest(token, 'PUT', `/api/actions/${rage.id}`, { ...rage, mechanics: mech });
    } else {
      report.push(`  = уже использует rage_damage_modifier`);
    }
  }

  console.log(report.join('\n'));
  console.log(`\n${APPLY ? 'ПРИМЕНЕНО' : 'DRY-RUN (без --apply ничего не записано)'}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
