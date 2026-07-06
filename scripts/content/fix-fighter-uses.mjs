#!/usr/bin/env node
/**
 * «Второе дыхание» и «Всплеск действий» — не ресурсы персонажа, а заряды
 * самих действий (mechanics.uses). Убираем cost-траты resource second_wind/
 * action_surge, задаём uses; вычищаем эти ключи из klass.resources Воина и
 * из справочника /api/resources.
 *
 * Запуск: node scripts/content/fix-fighter-uses.mjs [--apply]
 */
import { apiRequest, fetchAll, login } from './api.mjs';

const APPLY = process.argv.includes('--apply');
const VIRT = new Set(['second_wind', 'action_surge']);

function stripVirtCost(mech) {
  const cost = mech?.activation?.cost;
  if (!Array.isArray(cost)) return mech;
  mech.activation.cost = cost.filter((c) => !(c && VIRT.has(c.resource)));
  return mech;
}

async function main() {
  const token = APPLY ? await login() : null;
  const actions = await fetchAll('/api/actions', 'actions');

  const WANT = {
    'ACT-second-wind': { count: 2, per: 'short_rest' },
    'ACT-action-surge': { count: 1, per: 'short_rest' },
  };
  for (const [card, uses] of Object.entries(WANT)) {
    const a = actions.find((x) => x.card_number === card);
    if (!a) { console.log('НЕ НАЙДЕНО действие', card); continue; }
    const mech = JSON.parse(JSON.stringify(a.mechanics || { activation: { mode: 'active', cost: [] }, effects: [] }));
    stripVirtCost(mech);
    mech.uses = uses;
    console.log(`${a.name} (${card}): cost=${JSON.stringify(mech.activation.cost)} uses=${JSON.stringify(uses)}`);
    if (APPLY) await apiRequest(token, 'PUT', `/api/actions/${a.id}`, { mechanics: mech });
  }

  // klass.resources Воина — убрать виртуальные ключи
  const classes = await fetchAll('/api/classes', 'classes');
  const fighter = classes.find((c) => c.name === 'Воин' && !c.is_subclass);
  if (fighter?.resources) {
    const resources = { ...fighter.resources };
    let changed = false;
    for (const k of VIRT) if (k in resources) { delete resources[k]; changed = true; }
    console.log(`Воин.resources → ${JSON.stringify(resources)}`);
    if (changed && APPLY) await apiRequest(token, 'PUT', `/api/classes/${fighter.id}`, { resources });
  }

  // справочник ресурсов — удалить second_wind/action_surge
  for (const rid of VIRT) {
    console.log(`DELETE /api/resources/${rid}`);
    if (APPLY) await apiRequest(token, 'DELETE', `/api/resources/${rid}`).catch((e) => console.log('  (нет записи)', String(e).slice(0, 60)));
  }
  console.log('Готово.');
}

main().catch((e) => { console.error(e); process.exit(1); });
