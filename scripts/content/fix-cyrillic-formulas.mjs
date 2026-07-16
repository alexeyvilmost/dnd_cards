#!/usr/bin/env node
/**
 * План 2026-07-15, задача 0.1 (KB-004), data-часть: кириллица в bonus_value.
 *
 * Токенизатор формул (engine/formula.ts:159) понимает только ASCII-идентификаторы и бросает
 * FormulaError на кириллице. Карта «Одежды темного юстициара» несёт КЗ-формулу «12 + ЛВК» —
 * при надевании расчёт КЗ падал непойманным исключением и (до ErrorBoundary из этой же задачи)
 * уносил лист в белый экран. Ещё 7 карт несут русскую кость урона «1к6/1к4/2к8».
 *
 * Чиним ДАННЫЕ (движок кириллице не учим — это узаконило бы два словаря):
 *   • русская кость NкM → NdM;
 *   • аббревиатуры характеристик ЛВК→dex, СИЛ→str, ТЕЛ→con, ИНТ→int, МДР→wis, ХАР→cha.
 * Правка идемпотентна и самонаводящаяся: обходит ВСЕ карты, конвертит любую кириллицу в
 * bonus_value, а не фиксированный список — если контент насеет ещё, следующий прогон подчистит.
 *
 * Запуск:   node scripts/content/fix-cyrillic-formulas.mjs          (dry-run)
 *           node scripts/content/fix-cyrillic-formulas.mjs --apply
 */
import { apiRequest, fetchAll, login } from './api.mjs';

const APPLY = process.argv.includes('--apply');
const dryRun = !APPLY;

const ABILITY = { ЛВК: 'dex', СИЛ: 'str', ТЕЛ: 'con', ИНТ: 'int', МДР: 'wis', ХАР: 'cha' };

/** ASCII-изация формулы. Возвращает {out, ok}: ok=false, если кириллица осталась (не смогли перевести). */
export function asciiizeFormula(raw) {
  let out = String(raw);
  // Русская кость: «1к6», «2 к 8» → «1d6», «2d8».
  out = out.replace(/(\d+)\s*[кК]\s*(\d+)/g, '$1d$2');
  // Аббревиатуры характеристик (в т.ч. в нижнем регистре).
  for (const [ru, en] of Object.entries(ABILITY)) {
    out = out.replace(new RegExp(ru, 'gi'), en);
  }
  const ok = !/[А-Яа-я]/.test(out);
  return { out, ok };
}

async function main() {
  const token = APPLY ? await login() : null;
  const cards = await fetchAll('/api/cards', 'cards');

  console.log(`\n=== 0.1 / KB-004 (data): кириллица в bonus_value (${APPLY ? 'APPLY' : 'dry-run'}) ===\n`);

  let fixed = 0;
  let unresolved = 0;
  for (const c of cards) {
    const raw = c.bonus_value;
    if (!raw || !/[А-Яа-я]/.test(String(raw))) continue;
    const { out, ok } = asciiizeFormula(raw);
    if (!ok) {
      console.log(`  ⚠ НЕ смог перевести «${c.name}»: «${raw}» → «${out}» (осталась кириллица) — пропуск`);
      unresolved++;
      continue;
    }
    if (out === raw) continue;
    console.log(`  «${c.name}»: bonus_value «${raw}» → «${out}»`);
    await apiRequest(token, 'PUT', `/api/cards/${c.id}`, { bonus_value: out }, { dryRun });
    fixed++;
  }

  console.log(`\nИсправлено: ${fixed}${unresolved ? `, НЕ переведено: ${unresolved}` : ''}`);
  if (!APPLY) console.log('(dry-run — записи не было; добавь --apply)');
}

// Запуск только как скрипт (не при импорте в тест): argv[1] заканчивается именем файла.
if (process.argv[1] && /fix-cyrillic-formulas\.mjs$/.test(process.argv[1].replace(/\\/g, '/'))) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
