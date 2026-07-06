#!/usr/bin/env node
/**
 * Владения оружием/бронёй классов (PHB 2024) + варианты стартового снаряжения.
 * Владения (поля есть в БД) применяются сразу. equipment_options требуют
 * миграции 061 — применяются, только если поле уже есть в ответе класса
 * (после деплоя backend); иначе секция пропускается с пометкой.
 *
 * Запуск: node scripts/content/seed-class-training.mjs [--apply]
 */
import { apiRequest, fetchAll, login } from './api.mjs';

const APPLY = process.argv.includes('--apply');

// [armor_training[], weapon_proficiencies[]] по PHB 2024 (упрощено до категорий).
const TRAINING = {
  'Бард':      [['light'], ['simple']],
  'Варвар':    [['light', 'medium', 'shields'], ['simple', 'martial']],
  'Воин':      [['light', 'medium', 'heavy', 'shields'], ['simple', 'martial']],
  'Волшебник': [[], ['simple']],
  'Друид':     [['light', 'medium', 'shields'], ['simple']],
  'Жрец':      [['light', 'medium', 'shields'], ['simple']],
  'Колдун':    [['light'], ['simple']],
  'Монах':     [[], ['simple', 'martial']],
  'Паладин':   [['light', 'medium', 'heavy', 'shields'], ['simple', 'martial']],
  'Плут':      [['light'], ['simple', 'martial']],
  'Следопыт':  [['light', 'medium', 'shields'], ['simple', 'martial']],
  'Чародей':   [[], ['simple']],
};

// Стартовое снаряжение (PHB 2024) — вариант А (предметы) и Б (золото).
// Предметы по названию; неразрешённые пропускаются с пометкой в отчёте.
const EQUIP = {
  'Бард':      { a: [['Кожаный доспех', 1], ['Кинжал', 2], ['Набор артиста', 1]], goldA: 19, goldB: 90 },
  'Варвар':    { a: [['Двуручный меч', 1], ['Ручной топор', 4], ['Набор исследователя подземелий', 1]], goldA: 15, goldB: 75 },
  'Воин':      { a: [['Кольчужная рубаха', 1], ['Длинный меч', 1], ['Щит', 1], ['Стрелы (20 шт.)', 1], ['Набор исследователя подземелий', 1]], goldA: 4, goldB: 155 },
  'Волшебник': { a: [['Боевой посох', 1], ['Кинжал', 1], ['Набор учёного', 1]], goldA: 5, goldB: 55 },
  'Друид':     { a: [['Кожаный доспех', 1], ['Щит', 1], ['Серп', 1], ['Набор путешественника', 1]], goldA: 9, goldB: 50 },
  'Жрец':      { a: [['Кольчужная рубаха', 1], ['Щит', 1], ['Булава', 1], ['Набор священника', 1]], goldA: 7, goldB: 110 },
  'Колдун':    { a: [['Кожаный доспех', 1], ['Кинжал', 2], ['Набор учёного', 1]], goldA: 15, goldB: 100 },
  'Монах':     { a: [['Копьё', 1], ['Кинжал', 5], ['Набор путешественника', 1]], goldA: 11, goldB: 50 },
  'Паладин':   { a: [['Кольчужная рубаха', 1], ['Щит', 1], ['Длинный меч', 1], ['Набор священника', 1]], goldA: 9, goldB: 150 },
  'Плут':      { a: [['Кожаный доспех', 1], ['Кинжал', 2], ['Короткий меч', 1], ['Воровские инструменты', 1], ['Набор взломщика', 1]], goldA: 8, goldB: 100 },
  'Следопыт':  { a: [['Кожаный доспех', 1], ['Короткий меч', 2], ['Короткий лук', 1], ['Стрелы (20 шт.)', 1], ['Набор исследователя подземелий', 1]], goldA: 7, goldB: 150 },
  'Чародей':   { a: [['Копьё', 1], ['Кинжал', 2], ['Набор путешественника', 1]], goldA: 28, goldB: 50 },
};

const norm = (s) => String(s).toLowerCase().replace(/ё/g, 'е').replace(/[,.()]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');

async function main() {
  const token = APPLY ? await login() : null;
  const classes = await fetchAll('/api/classes', 'classes');
  const cards = await fetchAll('/api/cards', 'cards');
  const byName = new Map();
  for (const c of cards) {
    const k = norm(c.name);
    if (!byName.has(k)) byName.set(k, c.id);
    const short = norm(c.name.replace(/\s*\(\d+ шт\.\)$/, ''));
    if (!byName.has(short)) byName.set(short, c.id);
  }
  const resolve = (name) => byName.get(norm(name)) || byName.get(norm(name.replace(/\s*\(.*\)$/, '')));

  // Есть ли поле equipment_options (миграция 061 задеплоена)?
  const probe = classes[0];
  const equipReady = probe && Object.prototype.hasOwnProperty.call(probe, 'equipment_options');
  console.log(`Режим: ${APPLY ? 'APPLY' : 'dry-run'}; equipment_options ${equipReady ? 'ГОТОВО' : 'ждёт деплоя (пропуск)'}`);

  const missing = [];
  for (const [name, [armor, weapon]] of Object.entries(TRAINING)) {
    const cl = classes.find((c) => c.name === name && !c.is_subclass);
    if (!cl) { console.log('НЕ НАЙДЕН класс', name); continue; }

    const body = { armor_training: armor, weapon_proficiencies: weapon };

    if (equipReady && EQUIP[name]) {
      const e = EQUIP[name];
      const items = [];
      for (const [itemName, qty] of e.a) {
        const id = resolve(itemName);
        if (id) items.push({ card_id: id, quantity: qty });
        else missing.push(`${name}: «${itemName}»`);
      }
      body.equipment_options = {
        option_a: { items, gold: e.goldA },
        option_b: { items: [], gold: e.goldB },
        option_c: null,
      };
    }

    console.log(`${name}: armor=${JSON.stringify(armor)} weapon=${JSON.stringify(weapon)}` +
      (body.equipment_options ? ` equipA=${body.equipment_options.option_a.items.length}предм+${EQUIP[name].goldA}зм / Б=${EQUIP[name].goldB}зм` : ''));
    if (APPLY) await apiRequest(token, 'PUT', `/api/classes/${cl.id}`, body);
  }
  if (missing.length) console.log('НЕ РАЗРЕШЕНЫ предметы:', missing);
  console.log('Готово.');
}

main().catch((e) => { console.error(e); process.exit(1); });
