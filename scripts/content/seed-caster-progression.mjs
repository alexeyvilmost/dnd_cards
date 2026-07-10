#!/usr/bin/env node
/**
 * Прогрессия получения заклинаний фулл/полу-кастерам — по образцу Волшебника (правка D).
 *
 * У всех кастеров уже есть уровень-1 «Использование заклинаний» (заговоры + стартовые заклинания).
 * Не хватало ПОВТОРЯЕМОГО набора по уровням, как у Волшебника (wizard_spells_2):
 *   • recurring «+N заклинаний/уровень» — repeatable-эффект с filter.only_available_slots
 *     (предлагает круги 1..макс. доступный слот), прикреплён на уровнях 2..20;
 *   • рост заговоров — repeatable-эффект (levels:[0]) на 4 и 10 уровнях (у кого есть заговоры);
 *   • Колдун: пактовые ячейки по уровням (круг растёт 1→5, short_rest) — чтобы only_available_slots
 *     предлагал нужные круги.
 *
 * Идемпотентно: эффекты ищутся по card_number, level_progression не дублируется.
 * Запуск: node scripts/content/seed-caster-progression.mjs [--apply]
 *   dry-run по умолчанию (ничего не пишет, только печатает план).
 */
import { apiRequest, fetchAll, login } from './api.mjs';

const APPLY = process.argv.includes('--apply');

// N — сколько заклинаний выбирается на каждом уровне (по PHB 2024, приближение per-level).
// Волшебник (уже настроен) = 2; знающие/готовящие кастеры ~ +1/уровень; заговоры растут на 4/10.
const CASTERS = [
  { ru: 'бард',     name: 'Бард',        en: 'bard',     spellN: 1, cantrips: true },
  { ru: 'жрец',     name: 'Жрец',        en: 'cleric',   spellN: 1, cantrips: true },
  { ru: 'друид',    name: 'Друид',       en: 'druid',    spellN: 1, cantrips: true },
  { ru: 'чародей',  name: 'Чародей',     en: 'sorcerer', spellN: 1, cantrips: true },
  { ru: 'колдун',   name: 'Колдун',      en: 'warlock',  spellN: 1, cantrips: true, pact: true },
  { ru: 'паладин',  name: 'Паладин',     en: 'paladin',  spellN: 1, cantrips: false },
  { ru: 'следопыт', name: 'Следопыт',    en: 'ranger',   spellN: 1, cantrips: false },
];

const SPELL_LEVELS = Array.from({ length: 19 }, (_, i) => i + 2); // 2..20
const CANTRIP_LEVELS = [4, 10];

// Пактовые ячейки Колдуна (PHB 2024): один активный круг, растёт 1→5; счёт 1→4; short_rest.
// Ноли на переходах гасят младший круг, чтобы активной оставалась одна ступень.
const WARLOCK_PACT = {
  spell_slot_1: { by_level: { 1: 1, 2: 2, 3: 0 }, per: 'short_rest' },
  spell_slot_2: { by_level: { 3: 2, 5: 0 }, per: 'short_rest' },
  spell_slot_3: { by_level: { 5: 2, 7: 0 }, per: 'short_rest' },
  spell_slot_4: { by_level: { 7: 2, 9: 0 }, per: 'short_rest' },
  spell_slot_5: { by_level: { 9: 2, 11: 3, 17: 4 }, per: 'short_rest' },
};

const spellMech = (ru, en, n) => ({
  activation: { mode: 'passive' },
  effects: [{
    resolution: 'auto',
    result: [{
      kind: 'choice',
      id: `${en}_spells_recurring`,
      count: n,
      prompt: n > 1 ? `Выберите ${n} заклинания` : 'Выберите заклинание',
      resolution: 'on_acquire',
      grant: { kind: 'grant_spell', label: 'known' },
      options: { source: 'spell', filter: { classes: [ru], only_available_slots: true } },
    }],
  }],
});

const cantripMech = (ru, en) => ({
  activation: { mode: 'passive' },
  effects: [{
    resolution: 'auto',
    result: [{
      kind: 'choice',
      id: `${en}_cantrip_growth`,
      count: 1,
      prompt: 'Выберите заговор',
      resolution: 'on_acquire',
      grant: { kind: 'grant_spell', label: 'cantrip' },
      options: { source: 'spell', filter: { classes: [ru], levels: [0] } },
    }],
  }],
});

async function ensureEffect(token, effectsByNum, cardNumber, name, description, mechanics) {
  const existing = effectsByNum.get(cardNumber);
  if (existing) {
    // Обновляем механику/repeatable на случай правок скрипта.
    console.log(`  ~ эффект «${name}» уже есть (${cardNumber}) — обновляю механику`);
    if (APPLY) await apiRequest(token, 'PUT', `/api/effects/${existing.id}`, { name, mechanics, repeatable: true });
    return existing.id;
  }
  console.log(`  + создаю эффект «${name}» (${cardNumber}), repeatable`);
  if (!APPLY) return `NEW:${cardNumber}`;
  const created = await apiRequest(token, 'POST', '/api/effects', {
    name, description, rarity: 'common', card_number: cardNumber,
    effect_type: 'passive', mechanics, repeatable: true, author: 'system',
  });
  return created.id;
}

function addToLevels(lp, effectId, levels) {
  const next = JSON.parse(JSON.stringify(lp || {}));
  let added = 0;
  for (const L of levels) {
    const key = String(L);
    next[key] = next[key] || { effects: [], actions: [] };
    next[key].effects = next[key].effects || [];
    if (!next[key].effects.includes(effectId)) { next[key].effects.push(effectId); added++; }
  }
  return { lp: next, added };
}

async function main() {
  const token = APPLY ? await login() : null;
  console.log(APPLY ? '=== APPLY (пишем в прод) ===' : '=== DRY-RUN (только план) ===');

  const effects = await fetchAll('/api/effects', 'effects');
  const classes = await fetchAll('/api/classes', 'classes');
  const effectsByNum = new Map(effects.filter((e) => e.card_number).map((e) => [e.card_number, e]));

  for (const c of CASTERS) {
    console.log(`\n── ${c.name} ──`);
    const klass = classes.find((x) => x.name === c.name && !x.is_subclass);
    if (!klass) { console.log(`  ! класс не найден — пропуск`); continue; }

    const spellId = await ensureEffect(
      token, effectsByNum, `caster-${c.en}-spells`,
      `Заклинания (${c.ru})`,
      `Выбор заклинаний ${c.ru}а на уровне (доступные круги). Повторяемый: по одному на уровень.`,
      spellMech(c.ru, c.en, c.spellN),
    );
    let lp = klass.level_progression || {};
    const s = addToLevels(lp, spellId, SPELL_LEVELS);
    lp = s.lp;
    console.log(`  → уровни заклинаний 2..20: добавлено ${s.added}`);

    if (c.cantrips) {
      const cantripId = await ensureEffect(
        token, effectsByNum, `caster-${c.en}-cantrips`,
        `Заговоры (${c.ru})`,
        `Дополнительные заговоры ${c.ru}а. Повторяемый: по одному на прикрепление.`,
        cantripMech(c.ru, c.en),
      );
      const g = addToLevels(lp, cantripId, CANTRIP_LEVELS);
      lp = g.lp;
      console.log(`  → заговоры 4/10: добавлено ${g.added}`);
    }

    const body = { level_progression: lp };
    if (c.pact) {
      const kept = Object.fromEntries(Object.entries(klass.resources || {}).filter(([k]) => !/^spell_slot_/.test(k)));
      body.resources = { ...kept, ...WARLOCK_PACT };
      console.log(`  → пактовые ячейки (круг 1→5, short_rest) заменены`);
    }
    if (APPLY) await apiRequest(token, 'PUT', `/api/classes/${klass.id}`, body);
  }

  console.log('\nГотово.');
}

main().catch((e) => { console.error(e); process.exit(1); });
