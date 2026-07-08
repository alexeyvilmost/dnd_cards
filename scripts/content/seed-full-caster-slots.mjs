#!/usr/bin/env node
/**
 * D1 (слайс 1): ячейки заклинаний ПОЛНЫМ кастерам сеткой by_level (PHB 2024).
 *
 * Проблема: у полных кастеров (Бард/Жрец/Друид/Чародей/Волшебник) в resources лежит
 * только плейсхолдер spell_slot_1 = min(self_level+1,3), а spell_slot_2..9 нет вовсе.
 * Заклинание 2+ круга стоит {resource:'spell_slot', level:N} → costKey='spell_slot_N',
 * которого не существует → заклинание навсегда серое. Стена на 3 уровне.
 *
 * Решение (чистые данные, без кода): залить by_level-таблицы spell_slot_1..9 —
 * движок уже умеет их читать (engine/resources.ts:resolveByLevel, как у half/third
 * кастеров из seed-casters.mjs). Слияние {...resources, ...toResources(FULL)} ПЕРЕЗАПИШЕТ
 * старый spell_slot_1-плейсхолдер сеткой (замена ключа целиком) — это желаемо.
 *
 * Warlock НЕ трогаем: Pact Magic (все слоты одного круга, короткий отдых) — отдельная
 * задача с ключом warlock_spell_slot.
 *
 * Запуск: node scripts/content/seed-full-caster-slots.mjs         (dry-run)
 *         node scripts/content/seed-full-caster-slots.mjs --apply (запись в прод)
 */
import { apiRequest, fetchAll, login } from './api.mjs';

const APPLY = process.argv.includes('--apply');

// Сетка слотов полного кастера PHB 2024. Ключ — уровень персонажа, значение — число
// слотов; перечислены только точки ИЗМЕНЕНИЯ (resolveByLevel берёт значение с макс.
// ключом ≤ уровня). Соответствует стандартной таблице ячеек 1–20.
const FULL_CASTER = {
  spell_slot_1: { 1: 2, 2: 3, 3: 4 },
  spell_slot_2: { 3: 2, 4: 3 },
  spell_slot_3: { 5: 2, 6: 3 },
  spell_slot_4: { 7: 1, 8: 2, 9: 3 },
  spell_slot_5: { 9: 1, 10: 2, 18: 3 },
  spell_slot_6: { 11: 1, 19: 2 },
  spell_slot_7: { 13: 1, 20: 2 },
  spell_slot_8: { 15: 1 },
  spell_slot_9: { 17: 1 },
};

const toResources = (grid) => Object.fromEntries(
  Object.entries(grid).map(([id, byLevel]) => [id, { by_level: byLevel, per: 'long_rest' }]),
);

// Полные кастеры (RU-имена, как в прод-БД; сверяются при запуске).
const FULL_CASTERS = ['Бард', 'Жрец', 'Друид', 'Чародей', 'Волшебник'];

// Локальная копия resolveByLevel для sanity-проверки печатью (движок: engine/resources.ts).
function resolveByLevel(byLevel, level) {
  let best = null;
  for (const [k, v] of Object.entries(byLevel)) {
    const lvl = Number(k);
    if (lvl <= level && (best === null || lvl > best.lvl)) best = { lvl, v };
  }
  return best ? best.v : 0;
}

function slotsAtLevel(level) {
  const out = {};
  for (const [id, grid] of Object.entries(FULL_CASTER)) {
    const n = resolveByLevel(grid, level);
    if (n > 0) out[id] = n;
  }
  return out;
}

async function main() {
  const token = APPLY ? await login() : null;
  const classes = await fetchAll('/api/classes', 'classes');

  console.log(`\n=== D1: слоты полным кастерам (${APPLY ? 'APPLY' : 'dry-run'}) ===`);
  console.log('Все классы в прод-БД (не подклассы):',
    classes.filter((c) => !c.is_subclass).map((c) => c.name).join(', '));

  // Sanity: сетка слотов на ключевых уровнях.
  for (const lvl of [1, 3, 5, 9, 17, 20]) {
    console.log(`  проверка resolveByLevel L${lvl}:`, JSON.stringify(slotsAtLevel(lvl)));
  }

  let applied = 0;
  for (const name of FULL_CASTERS) {
    const c = classes.find((x) => x.name === name && !x.is_subclass);
    if (!c) { console.log(`  ⚠ НЕ НАЙДЕН класс «${name}» — пропуск`); continue; }
    const before = c.resources || {};
    const resources = { ...before, ...toResources(FULL_CASTER) };
    const oldSlot1 = JSON.stringify(before.spell_slot_1 ?? null);
    console.log(`  ${name} (${c.card_number}): spell_slot_1 ${oldSlot1} → by_level; +круги 2..9;` +
      ` прочих ресурсов сохранено: ${Object.keys(before).filter((k) => !k.startsWith('spell_slot_')).length}`);
    if (APPLY) {
      await apiRequest(token, 'PUT', `/api/classes/${c.id}`, { resources });
      applied++;
    }
  }
  console.log(APPLY ? `\n✓ Обновлено классов: ${applied}` : '\n(dry-run — запись не выполнялась; добавь --apply)');
}

main().catch((e) => { console.error(e); process.exit(1); });
