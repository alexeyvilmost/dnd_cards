#!/usr/bin/env node
/**
 * Унификация выборов, слайс 4: черта «Музыкант» — выбор инструментов (был narrative).
 *
 * Эффект «Обученность инструментам» (EFF-feat-music-training) описывал «владение тремя
 * музыкальными инструментами по вашему выбору» ТЕКСТОМ (kind:'narrative') — без выбора.
 * Теперь это настоящий choice(source:'instrument', count:3) → grant_proficiency tool.
 * Домен инструментов добавлен в реестр (registries.ts) и в схему (source enum).
 *
 * Запуск: node scripts/content/seed-musician.mjs          (dry-run)
 *         node scripts/content/seed-musician.mjs --apply   (запись в прод)
 */
import { apiRequest, fetchAll, login } from './api.mjs';

const APPLY = process.argv.includes('--apply');
const dryRun = !APPLY;
const CARD = 'EFF-feat-music-training';

const MECH = {
  activation: { mode: 'passive' },
  effects: [
    {
      kind: 'choice',
      id: 'music_instruments',
      prompt: 'Выберите 3 музыкальных инструмента',
      count: 3,
      grant: { kind: 'grant_proficiency', prof: 'tool' },
      options: { source: 'instrument' },
    },
  ],
};

async function main() {
  const token = APPLY ? await login() : null;
  const effects = await fetchAll('/api/effects', 'effects');
  const eff = effects.find((e) => e.card_number === CARD);
  console.log(`\n=== Слайс 4: «Музыкант» — выбор инструментов (${APPLY ? 'APPLY' : 'dry-run'}) ===\n`);
  if (!eff) { console.log(`⚠ НЕ найден эффект ${CARD}`); return; }
  console.log(`Эффект: «${eff.name}» (${eff.id})`);
  console.log('Было:', JSON.stringify(eff.mechanics));
  console.log('Станет:', JSON.stringify(MECH));
  await apiRequest(token, 'PUT', `/api/effects/${eff.id}`, { mechanics: MECH }, { dryRun });
  console.log(APPLY ? '\n✓ Обновлено' : '\n(dry-run — записи не было; добавь --apply)');
}

main().catch((e) => { console.error(e); process.exit(1); });
