#!/usr/bin/env node
/**
 * План 2026-07-15, задача 0.2 (KB-025): «Уклонение» не даёт помеху атакам по вам.
 *
 * Главный эффект Уклонения — «атаки по вам с помехой» — смоделирован мёртвой конвенцией
 * `applies_to:{roll:'attack', filter:{against:'self'}}`. Движок проецирует модификаторы
 * цель→атакующий ТОЛЬКО по `scope:'target'` (execute.ts projectedAgainst:126); ключа `against`
 * не читает НИКТО в проде. Итог: Уклонение тратит действие и молча ничего не делает.
 *
 * Фикс: заменить `filter:{against:'self'}` на `scope:'target'` у payload помехи атаки. Тогда,
 * когда враг атакует уклоняющегося (ctx.target = уклоняющийся), projectedAgainst читает
 * scope:'target' помеху. Self-коллектор при этом ИСКЛЮЧАЕТ scope:'target' (modifiers.ts:93),
 * поэтому свои атаки уклоняющегося помеху НЕ получают.
 *
 * Часть с преимуществом на спас Ловкости (scope по умолчанию 'self') корректна — не трогаем.
 *
 * Правим ОБА действия «Уклонение»: b0085bf7 (type=basic, живое) и дубль 070e89cf (type=null).
 * Список id явный.
 *
 * Запуск:   node scripts/content/fix-dodge-scope.mjs          (dry-run)
 *           node scripts/content/fix-dodge-scope.mjs --apply
 */
import { apiRequest, fetchAll, login } from './api.mjs';

const APPLY = process.argv.includes('--apply');
const dryRun = !APPLY;

const DODGE_IDS = [
  'b0085bf7-130a-41c9-956d-54a093a1df99', // Уклонение (type=basic)
  '070e89cf-ef2e-4d5a-9526-e2d6e7c9fc6e', // Уклонение (дубль, type=null)
];

/** Приводит payload помехи атаки: filter:{against:'self'} → scope:'target'. Прочие payload'ы
 *  (преимущество на спас ЛВК) не трогает. Возвращает {mech, changed}. */
export function fixDodgeMechanics(mech) {
  if (!mech || !Array.isArray(mech.effects)) return { mech, changed: false };
  let changed = false;
  const effects = mech.effects.map((eff) => {
    if (!Array.isArray(eff.result)) return eff;
    const result = eff.result.map((p) => {
      const applies = p && p.applies_to;
      const isDodgeAttackMod = p && p.kind === 'modifier' && p.op === 'disadvantage'
        && applies && applies.roll === 'attack' && applies.filter && applies.filter.against === 'self';
      if (!isDodgeAttackMod) return p;
      changed = true;
      // Убираем мёртвый filter.against, добавляем scope:'target' (проекция на атакующего).
      const { against, ...restFilter } = applies.filter;
      const nextApplies = { roll: applies.roll };
      if (Object.keys(restFilter).length) nextApplies.filter = restFilter;
      return { ...p, applies_to: nextApplies, scope: 'target' };
    });
    return { ...eff, result };
  });
  return { mech: { ...mech, effects }, changed };
}

async function main() {
  const token = APPLY ? await login() : null;
  const actions = await fetchAll('/api/actions', 'actions');
  const byId = new Map(actions.map((a) => [a.id, a]));

  console.log(`\n=== 0.2 / KB-025: «Уклонение» scope:'target' (${APPLY ? 'APPLY' : 'dry-run'}) ===\n`);

  let changedCount = 0;
  for (const id of DODGE_IDS) {
    const act = byId.get(id);
    if (!act) { console.log(`  ⚠ НЕ найдено действие ${id} — пропуск`); continue; }
    const { mech, changed } = fixDodgeMechanics(act.mechanics);
    if (!changed) { console.log(`  «${act.name ?? id}» уже актуально`); continue; }
    console.log(`  «${act.name ?? id}» (${id.slice(0, 8)}): помеха атаки → scope:'target'`);
    await apiRequest(token, 'PUT', `/api/actions/${id}`, { mechanics: mech }, { dryRun });
    changedCount++;
  }

  console.log(`\nОбновлено: ${changedCount}`);
  if (!APPLY) console.log('(dry-run — записи не было; добавь --apply)');
}

if (process.argv[1] && /fix-dodge-scope\.mjs$/.test(process.argv[1].replace(/\\/g, '/'))) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
