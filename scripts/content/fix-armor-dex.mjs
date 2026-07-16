#!/usr/bin/env node
/**
 * План 2026-07-15, задача B.1 (KB-001 + KB-003, ОДНОЙ правкой): доспехи не дают Ловкость.
 *
 * ac.ts:armorAc добавляет ЛВК к КЗ только если bonus_value содержит `dex`. В проде у всех
 * лёгких/средних доспехов bonus_value — плоское число, поэтому надевание доспеха СНИЖАЕТ КЗ
 * (плут ЛВК+5 без доспеха 15 → «Проклёпанный кожаный» 12).
 *
 * Фикс данными (движок готов — armorAc парсит `+ dex` и `+ min(dex, N)`, formula.ts знает min):
 *   • ЛЁГКИЙ доспех:  `${base} + dex`            (полная Ловкость);
 *   • СРЕДНИЙ доспех: `${base} + min(dex, 2)`     (кап Ловкости +2, RAW 2024).
 * KB-001 и KB-003 закрываются ВМЕСТЕ: наивный `14 + dex` без капа перевернул бы ошибку в
 * перебор (Кираса при ЛВК+5 → 19 вместо 16, §8.5.19).
 *
 * ГРАНИЦЫ (что НЕ трогаем, чтобы не сломать соседние правила):
 *   • type='shield' — щиты (bonus '+N'), аддитивны, не база доспеха (чинены в 0.3);
 *   • props 'cloth'/'clothing' — ОДЕЖДА, не доспех: dex ей не даём и НЕ превращаем в доспех
 *     (иначе isNonArmorBody перестанет считать её одеждой и заблокирует Защиту без доспехов);
 *   • props 'heavy_armor' — тяжёлый доспех без ЛВК, даже если ошибочно defense_type='light'
 *     («Складная сбруя» 17 — отдельная правка категории, не здесь);
 *   • уже содержащие dex — идемпотентность.
 * `base` берём из текущего плоского bonus_value (это база КЗ; значения баз не корректируем —
 * это отдельная задача точности контента).
 *
 * Запуск:   node scripts/content/fix-armor-dex.mjs          (dry-run)
 *           node scripts/content/fix-armor-dex.mjs --apply
 */
import { apiRequest, fetchAll, login } from './api.mjs';

const APPLY = process.argv.includes('--apply');
const dryRun = !APPLY;

const props = (c) => (Array.isArray(c.properties) ? c.properties.map(String) : []);
const isCloth = (c) => props(c).includes('cloth') || props(c).includes('clothing');
const isHeavyProp = (c) => props(c).includes('heavy_armor');
const hasDex = (c) => /dex/i.test(String(c.bonus_value ?? ''));

/** База КЗ из плоского bonus_value ("12" → 12). null, если не плоское число. */
export function flatBase(bonusValue) {
  const s = String(bonusValue ?? '').trim();
  return /^\d+$/.test(s) ? Number(s) : null;
}

/** Новая формула КЗ для доспеха по типу. null — если карту трогать не надо. */
export function armorDexFormula(card) {
  if (card.bonus_type !== 'defense') return null;
  if (card.type === 'shield') return null;
  if (isCloth(card) || isHeavyProp(card) || hasDex(card)) return null;
  const base = flatBase(card.bonus_value);
  if (base == null) return null;
  if (card.defense_type === 'light') return `${base} + dex`;
  if (card.defense_type === 'medium') return `${base} + min(dex, 2)`;
  return null; // heavy / прочее — без ЛВК
}

async function main() {
  const token = APPLY ? await login() : null;
  const cards = await fetchAll('/api/cards', 'cards');

  console.log(`\n=== B.1 / KB-001+003: ЛВК в доспехах (${APPLY ? 'APPLY' : 'dry-run'}) ===\n`);

  const targets = [];
  for (const c of cards) {
    const formula = armorDexFormula(c);
    if (formula && formula !== String(c.bonus_value)) targets.push({ c, formula });
  }
  const light = targets.filter((t) => t.c.defense_type === 'light');
  const medium = targets.filter((t) => t.c.defense_type === 'medium');
  console.log(`Лёгкий доспех (${light.length}): base + dex`);
  for (const { c, formula } of light) console.log(`  «${c.name}»: «${c.bonus_value}» → «${formula}»`);
  console.log(`\nСредний доспех (${medium.length}): base + min(dex, 2)`);
  for (const { c, formula } of medium) console.log(`  «${c.name}»: «${c.bonus_value}» → «${formula}»`);

  for (const { c, formula } of targets) {
    await apiRequest(token, 'PUT', `/api/cards/${c.id}`, { bonus_value: formula }, { dryRun });
  }

  console.log(`\nВсего обновлено: ${targets.length} (лёгких ${light.length} + средних ${medium.length})`);
  if (!APPLY) console.log('(dry-run — записи не было; добавь --apply)');
}

if (process.argv[1] && /fix-armor-dex\.mjs$/.test(process.argv[1].replace(/\\/g, '/'))) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
