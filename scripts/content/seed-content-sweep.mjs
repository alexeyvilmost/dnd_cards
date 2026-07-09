#!/usr/bin/env node
/**
 * Контент-свип narrative→choice: конвертирует эффекты из аудита в настоящие choice.
 * Источник правды — frontend/src/mechanics/contentSweep.fixtures.json (его же проверяет
 * юнит-тест contentSweep.test.ts). Сидим только НОВЫЕ (без "seeded":true — Музыкант/Аспект
 * уже в проде из слайсов 4/5). Идемпотентно (PUT по card_number).
 *
 * Запуск: node scripts/content/seed-content-sweep.mjs          (dry-run)
 *         node scripts/content/seed-content-sweep.mjs --apply   (запись в прод)
 */
import { readFileSync } from 'fs';
import { apiRequest, fetchAll, login } from './api.mjs';

const APPLY = process.argv.includes('--apply');
const dryRun = !APPLY;
const FIXTURES = JSON.parse(readFileSync(new URL('../../frontend/src/mechanics/contentSweep.fixtures.json', import.meta.url)));

async function main() {
  const token = APPLY ? await login() : null;
  const effects = await fetchAll('/api/effects', 'effects');
  const byCard = new Map(effects.filter((e) => e.card_number).map((e) => [e.card_number, e]));

  console.log(`\n=== Контент-свип narrative→choice (${APPLY ? 'APPLY' : 'dry-run'}) ===\n`);
  let applied = 0;
  for (const fx of FIXTURES) {
    if (fx.seeded) { console.log(`[skip] ${fx.card} «${fx.name}» — уже в проде`); continue; }
    const eff = byCard.get(fx.card);
    if (!eff) { console.log(`  ⚠ НЕ найден эффект ${fx.card}`); continue; }
    console.log(`[effect] ${fx.card} «${eff.name}»: ${fx.was}`);
    console.log(`         → ${JSON.stringify(fx.mechanics).slice(0, 130)}`);
    await apiRequest(token, 'PUT', `/api/effects/${eff.id}`, { mechanics: fx.mechanics }, { dryRun });
    applied++;
  }
  console.log(APPLY ? `\n✓ Обновлено эффектов: ${applied}` : '\n(dry-run — добавь --apply)');
}

main().catch((e) => { console.error(e); process.exit(1); });
