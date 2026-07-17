#!/usr/bin/env node
/**
 * План 2026-07-15, задача 0.8 (KB-092): «Вызов Зверя» (Summon Beast, SPELL-0178) —
 * concentration=false, хотя RAW это концентрация до 1 часа. Единственное расхождение
 * концентрации на 393 заклинаниях (коммит 7c6acf0 вылечил 2 соседей, это пропустил).
 * Следствия отсутствия флага: нет вытеснения прежней концентрации, нет спаса ТЕЛ при уроне,
 * нет запрета для Недееспособного, нет строки на вики, не находится фильтром библиотеки.
 *
 * Идемпотентно. Запуск: node scripts/content/fix-summon-beast-concentration.mjs [--apply]
 */
import { apiRequest, fetchAll, login } from './api.mjs';

const APPLY = process.argv.includes('--apply');
const dryRun = !APPLY;
const CARD = 'SPELL-0178';

async function main() {
  const token = APPLY ? await login() : null;
  const spells = await fetchAll('/api/spells', 'spells');
  const sp = spells.find((s) => s.card_number === CARD);
  if (!sp) { console.error(`${CARD} не найдено`); process.exit(2); }

  console.log(`\n=== 0.8 / KB-092: «${sp.name}» concentration (${APPLY ? 'APPLY' : 'dry-run'}) ===\n`);
  if (sp.concentration === true) { console.log('  Уже concentration=true.'); return; }
  console.log(`  «${sp.name}»: concentration ${sp.concentration} → true`);
  await apiRequest(token, 'PUT', `/api/spells/${sp.id}`, { concentration: true }, { dryRun });
  if (!APPLY) console.log('\n(dry-run — записи не было; добавь --apply)');
}

if (process.argv[1] && /fix-summon-beast-concentration\.mjs$/.test(process.argv[1].replace(/\\/g, '/'))) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
