#!/usr/bin/env node
/**
 * Ячейки заклинаний 1 уровня для кастеров (PHB 2024, уровни персонажа 1–2).
 * Полные кастеры: 2 ячейки на L1, 3 на L2 → формула min(self_level + 1, 3).
 * Полукастеры (паладин/следопыт, 2024): 2 ячейки с 1 уровня.
 * Колдун (Pact Magic): 1 на L1, 2 на L2, восстановление на коротком отдыхе.
 * Запуск: node scripts/content/seed-spell-slots.mjs [--apply]
 */
import { apiRequest, fetchAll, login } from './api.mjs';

const APPLY = process.argv.includes('--apply');

const SLOTS = {
  'CLASS-bard':     { spell_slot_1: { count: 'min(self_level + 1, 3)', per: 'long_rest' } },
  'CLASS-cleric':   { spell_slot_1: { count: 'min(self_level + 1, 3)', per: 'long_rest' } },
  'CLASS-druid':    { spell_slot_1: { count: 'min(self_level + 1, 3)', per: 'long_rest' } },
  'CLASS-sorcerer': { spell_slot_1: { count: 'min(self_level + 1, 3)', per: 'long_rest' } },
  'CLASS-wizard':   { spell_slot_1: { count: 'min(self_level + 1, 3)', per: 'long_rest' } },
  'CLASS-paladin':  { spell_slot_1: { count: 2, per: 'long_rest' } },
  'CLASS-ranger':   { spell_slot_1: { count: 2, per: 'long_rest' } },
  'CLASS-warlock':  { spell_slot_1: { count: 'min(self_level, 2)', per: 'short_rest' } },
};

async function main() {
  const classes = await fetchAll('/api/classes', 'classes');
  const token = APPLY ? await login() : null;
  for (const cl of classes) {
    const slots = SLOTS[cl.card_number];
    if (!slots) continue;
    const merged = { ...(cl.resources || {}), ...slots };
    console.log(`${cl.name}: ${JSON.stringify(merged)}`);
    if (APPLY) await apiRequest(token, 'PUT', `/api/classes/${cl.id}`, { resources: merged });
  }
  console.log(APPLY ? 'Записано.' : 'Dry-run (--apply для записи).');
}

main().catch((e) => { console.error(e); process.exit(1); });
