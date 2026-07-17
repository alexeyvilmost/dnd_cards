#!/usr/bin/env node
/**
 * План 2026-07-15, задача 0.9 / KB-027: действие «Помощь» (2863e54d) имеет type=null, поэтому
 * не грузится как базовое (basicActions.ts: getActions({type:'basic'})) и не выдаётся классом →
 * на листе его нет вовсе, хотя механика (boon: преимущество союзнику) рабочая.
 * Фикс: type='basic' — как у Рывок/Отход/Уклонение (одно поле = действие на листе).
 *
 * NB: вторая половина 0.9 (KB-033 «боевой стиль») — ЛОЖНАЯ находка и НЕ реализуется: стиль уже
 * подключён через 10 черт category='fighting_style' + choice{source:'feat', filter:'fighting_style'}
 * в контейнерах Воин L1 / Паладин L2 / Следопыт L2 (есть тест fightingstyle.forge.mvp.test.ts).
 * Правка плана (тег эффектов type='Боевой стиль') создала бы ПАРАЛЛЕЛЬНЫЙ дублирующий пикер.
 *
 * Идемпотентно. Запуск: node scripts/content/fix-help-action-type.mjs [--apply]
 */
import { apiRequest, fetchAll, login } from './api.mjs';

const APPLY = process.argv.includes('--apply');
const dryRun = !APPLY;
const HELP_ID = '2863e54d-0d7e-4d2c-8291-0f222a7ce662';

async function main() {
  const token = APPLY ? await login() : null;
  const actions = await fetchAll('/api/actions', 'actions');
  const help = actions.find((a) => a.id === HELP_ID);
  if (!help) { console.error('«Помощь» не найдено'); process.exit(2); }

  console.log(`\n=== 0.9 / KB-027: «${help.name}» type=basic (${APPLY ? 'APPLY' : 'dry-run'}) ===\n`);
  if (help.type === 'basic') { console.log('  Уже type=basic.'); return; }
  console.log(`  «${help.name}»: type ${JSON.stringify(help.type)} → 'basic'`);
  await apiRequest(token, 'PUT', `/api/actions/${HELP_ID}`, { type: 'basic' }, { dryRun });
  if (!APPLY) console.log('\n(dry-run — записи не было; добавь --apply)');
}

if (process.argv[1] && /fix-help-action-type\.mjs$/.test(process.argv[1].replace(/\\/g, '/'))) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
