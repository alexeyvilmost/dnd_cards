#!/usr/bin/env node
/**
 * План 2026-07-15, задача 0.3 (KB-002): 10 щитов уезжают в слот ТЕЛА и вытесняют доспех.
 *
 * Причина. Движок опознаёт щит ровно одним признаком — `isShield()` (engine/equipment.ts:28):
 *   card.type === 'shield' || card.defense_type === 'shield'
 * У этих десяти `type=null` и `defense_type='light'`, поэтому:
 *   • isShield() → false;
 *   • isBodyArmor() (equipment.ts:32) → `!!card.defense_type && !isShield(card)` → TRUE
 *     → щит надевается в слот body и ВЫТЕСНЯЕТ доспех;
 *   • shieldFromState() (engine/ac.ts:95) ищет щит только в руках и только по isShield
 *     → бонус щита к КЗ не начисляется вообще.
 * Репро: Латы (КЗ 18) + «Щит +2» → КЗ 11 (латы вытеснены), а не 20.
 *
 * Эталон — 3 уже рабочих щита («Простой щит», «Щит равновесия», «Малая эгида»):
 *   type='shield', slot='one_hand', defense_type='light'.
 *
 * ВНИМАНИЕ: список id ЯВНЫЙ, а не по имени. Фильтр /щит/i ловит «Броню заЩИТника Шар» и
 * «Доблесть заЩИТника» — это нагрудники (type=chest, КЗ 12 и 20). DoD плана «карт с именем
 * /щит/i и type!=='shield' = 0» ошибочен: он требует превратить их в щиты. Проверять по id.
 *
 * `defense_type` не трогаем (декоративное поле, KB §9).
 *
 * Запуск:   node scripts/content/fix-shield-type.mjs          (dry-run)
 *           node scripts/content/fix-shield-type.mjs --apply
 */
import { apiRequest, fetchAll, login } from './api.mjs';

const APPLY = process.argv.includes('--apply');
const dryRun = !APPLY;

// id → имя (имя только для лога; матчим строго по id).
const SHIELDS = [
  ['7e760ad1-4e9f-4510-9c28-ffcb5d455972', 'Щит Тьмы'],
  ['c1910eae-12a8-41cc-a732-69e8b068e1ae', 'Щит мести'],
  ['933af6f2-f084-40ac-a9ad-aab83003bd6e', 'Щит восстановления'],
  ['7686a783-3324-4825-87fe-81321487712d', 'Оплот надежды'],
  ['b0a5fd06-4b35-480a-8a99-02aa2a60fd6b', 'Щит'],
  ['d7a4d114-fcfd-442b-b451-2af14d432130', 'Щит черепахи'],
  ['c8e56d44-ddea-42a3-b5e1-6c243dc28a4b', 'Щит +1'],
  ['3fca9bc1-b9a5-421e-9e55-f8a76d1b1da6', 'Щит +2'],
  ['10f8d896-f5d1-405f-94f7-3ad96a1aa3e9', 'Щит +3'],
  ['dac8e582-cffd-4c2a-9bea-4ec2924e956c', 'Щит друида'],
];

async function main() {
  const token = APPLY ? await login() : null;
  const cards = await fetchAll('/api/cards', 'cards');
  const byId = new Map(cards.map((c) => [c.id, c]));

  console.log(`\n=== 0.3 / KB-002: щиты → type='shield' (${APPLY ? 'APPLY' : 'dry-run'}) ===\n`);

  let fixed = 0;
  let already = 0;
  for (const [id, label] of SHIELDS) {
    const card = byId.get(id);
    if (!card) {
      console.log(`  ⚠ НЕ найдена карта ${id} «${label}» — пропуск`);
      continue;
    }
    const patch = {};
    if (card.type !== 'shield') patch.type = 'shield';
    if (card.slot !== 'one_hand') patch.slot = 'one_hand';
    if (!Object.keys(patch).length) {
      console.log(`  «${card.name}» уже корректен`);
      already++;
      continue;
    }
    console.log(`  «${card.name}»: ${Object.entries(patch).map(([k, v]) => `${k}→${v}`).join(', ')}`);
    await apiRequest(token, 'PUT', `/api/cards/${id}`, patch, { dryRun });
    fixed++;
  }

  console.log(`\nИсправлено: ${fixed}, уже корректных: ${already}`);
  if (!APPLY) console.log('(dry-run — записи не было; добавь --apply)');
}

main().catch((e) => { console.error(e); process.exit(1); });
