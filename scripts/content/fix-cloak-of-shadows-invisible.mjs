#!/usr/bin/env node
/**
 * План 2026-07-15, задача 0.10 / KB-023: «Покров теней» (EFFECT-0164) кладёт
 * condition value:'Невидимый' — русское ИМЯ вместо ключа реестра 'invisible'
 * (BUILTIN_CONDITION_RULES.invisible, label 'Невидим') → невидимость не наступает.
 *
 * Единственный ВРЕДНЫЙ из нерезолвимых condition-ключей прода (2 других — polymorphed op:remove
 * и т.п. — безвредные no-op'ы, §8.5). Фикс: value 'Невидимый' → 'invisible'.
 *
 * Идемпотентно. Запуск: node scripts/content/fix-cloak-of-shadows-invisible.mjs [--apply]
 */
import { apiRequest, fetchAll, login } from './api.mjs';

const APPLY = process.argv.includes('--apply');
const dryRun = !APPLY;
const ID = 'f7217b9b-cb34-4d22-bd58-44eb6432865d'; // EFFECT-0164 «Покров теней»

/** Заменяет condition value 'Невидимый' → 'invisible' в механике. {mech, changed}. */
export function fixInvisible(mech) {
  const m = JSON.parse(JSON.stringify(mech));
  let changed = false;
  for (const eff of m.effects || []) {
    for (const p of eff.result || []) {
      if (p.kind === 'condition' && p.value === 'Невидимый') { p.value = 'invisible'; changed = true; }
    }
  }
  return { mech: m, changed };
}

async function main() {
  const token = APPLY ? await login() : null;
  const effects = await fetchAll('/api/effects', 'effects');
  const eff = effects.find((e) => e.id === ID);
  if (!eff) { console.error('«Покров теней» не найден'); process.exit(2); }

  console.log(`\n=== 0.10 / KB-023: «${eff.name}» invisible (${APPLY ? 'APPLY' : 'dry-run'}) ===\n`);
  const { mech, changed } = fixInvisible(eff.mechanics);
  if (!changed) { console.log('  Уже value=invisible (или ключа нет).'); return; }
  console.log('  «Покров теней»: condition value «Невидимый» → «invisible»');
  await apiRequest(token, 'PUT', `/api/effects/${ID}`, { mechanics: mech }, { dryRun });
  if (!APPLY) console.log('\n(dry-run — записи не было; добавь --apply)');
}

if (process.argv[1] && /fix-cloak-of-shadows-invisible\.mjs$/.test(process.argv[1].replace(/\\/g, '/'))) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
