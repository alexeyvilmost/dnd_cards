#!/usr/bin/env node
/**
 * Оптимальный point-buy расклад характеристик для 12 классов (PHB 2024,
 * рекомендованные значения из описаний классов; сумма всегда = 27 очков:
 * 15/14/13/12/10/8). Пишет classes.recommended_abilities.
 * Запуск: node scripts/content/seed-recommended-abilities.mjs [--apply]
 */
import { apiRequest, fetchAll, login } from './api.mjs';

const APPLY = process.argv.includes('--apply');

const RECOMMENDED = {
  'CLASS-barbarian': { str: 15, con: 14, dex: 13, wis: 12, cha: 10, int: 8 },
  'CLASS-bard':      { cha: 15, dex: 14, con: 13, wis: 12, str: 10, int: 8 },
  'CLASS-warrior':   { str: 15, con: 14, dex: 13, wis: 12, cha: 10, int: 8 },
  'CLASS-wizard':    { int: 15, con: 14, dex: 13, wis: 12, cha: 10, str: 8 },
  'CLASS-druid':     { wis: 15, con: 14, dex: 13, int: 12, cha: 10, str: 8 },
  'CLASS-cleric':    { wis: 15, str: 14, con: 13, dex: 12, cha: 10, int: 8 },
  'CLASS-warlock':   { cha: 15, con: 14, dex: 13, wis: 12, int: 10, str: 8 },
  'CLASS-monk':      { dex: 15, wis: 14, con: 13, str: 12, int: 10, cha: 8 },
  'CLASS-paladin':   { str: 15, cha: 14, con: 13, wis: 12, dex: 10, int: 8 },
  'CLASS-rogue':     { dex: 15, con: 14, int: 13, wis: 12, cha: 10, str: 8 },
  'CLASS-ranger':    { dex: 15, wis: 14, con: 13, str: 12, int: 10, cha: 8 },
  'CLASS-sorcerer':  { cha: 15, con: 14, dex: 13, int: 12, wis: 10, str: 8 },
};

async function main() {
  const classes = await fetchAll('/api/classes', 'classes');
  const token = APPLY ? await login() : null;
  for (const cl of classes) {
    const rec = RECOMMENDED[cl.card_number];
    if (!rec) { console.log(`— пропуск: ${cl.card_number}`); continue; }
    console.log(`${cl.name}: ${JSON.stringify(rec)}`);
    if (APPLY) {
      await apiRequest(token, 'PUT', `/api/classes/${cl.id}`, { recommended_abilities: rec });
    }
  }
  console.log(APPLY ? 'Записано.' : 'Dry-run (запустите с --apply).');
}

main().catch((e) => { console.error(e); process.exit(1); });
