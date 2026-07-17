#!/usr/bin/env node
/**
 * План 2026-07-15, задача 0.5 (KB-052): Ярость — сопротивление физическому урону и преимущество
 * на СИЛ были только в тексте. Исполним лишь бонус урона.
 *
 * Ядро Ярости — действие ACT-rage (id 815f7963). В result сейчас: narrative + один рабочий
 * payload (modifier add rage_damage_modifier к урону СИЛ). Движок умеет применять и resistance
 * (applyResistancePayload), и advantage из действия — не хватает ДАННЫХ.
 *
 * Досеваем в result (сохраняя narrative и бонус урона), длительность как у бонуса урона (10 раундов):
 *   • 3× resistance к физическому урону (bludgeoning/piercing/slashing) — внутренний тип урона
 *     АНГЛИЙСКИЙ (как у «Драконьего сопротивления» и DAMAGE_TYPES SheetHpPanel);
 *   • 2× advantage: проверки характеристики СИЛ и спасброски СИЛ (filter ability:'str').
 *
 * Идемпотентно: если payload'ы уже есть (по kind+damage_type / roll+op), не дублируем.
 *
 * Запуск:   node scripts/content/fix-rage-effects.mjs          (dry-run)
 *           node scripts/content/fix-rage-effects.mjs --apply
 */
import { apiRequest, fetchAll, login } from './api.mjs';

const APPLY = process.argv.includes('--apply');
const dryRun = !APPLY;

const RAGE_ID = '815f7963-ccac-4480-8a4d-6c790d8d2bcb'; // ACT-rage
const DURATION = { amount: 10, type: 'rounds' };

const RESIST = ['bludgeoning', 'piercing', 'slashing'].map((dt) => ({
  kind: 'resistance', damage_type: dt, value: 'resistance', duration: { ...DURATION },
}));
const ADVANTAGE = ['ability_check', 'saving_throw'].map((roll) => ({
  kind: 'modifier', op: 'advantage', applies_to: { roll, filter: { ability: 'str' } }, duration: { ...DURATION },
}));

const hasResist = (result, dt) => result.some((p) => p.kind === 'resistance' && p.damage_type === dt);
const hasAdv = (result, roll) => result.some((p) => p.kind === 'modifier' && p.op === 'advantage'
  && p.applies_to?.roll === roll && p.applies_to?.filter?.ability === 'str');

/** Возвращает {mech, added} — добавляет отсутствующие payload'ы в первый result-блок. */
export function addRagePayloads(mech) {
  const block = mech?.effects?.find((e) => Array.isArray(e.result));
  if (!block) return { mech, added: 0 };
  const result = [...block.result];
  let added = 0;
  for (const r of RESIST) if (!hasResist(result, r.damage_type)) { result.push(r); added++; }
  for (const a of ADVANTAGE) if (!hasAdv(result, a.applies_to.roll)) { result.push(a); added++; }
  if (!added) return { mech, added: 0 };
  const effects = mech.effects.map((e) => (e === block ? { ...e, result } : e));
  return { mech: { ...mech, effects }, added };
}

async function main() {
  const token = APPLY ? await login() : null;
  const actions = await fetchAll('/api/actions', 'actions');
  const rage = actions.find((a) => a.id === RAGE_ID);
  if (!rage) { console.error('ACT-rage не найдено'); process.exit(2); }

  console.log(`\n=== 0.5 / KB-052: Ярость — сопротивление + преимущество СИЛ (${APPLY ? 'APPLY' : 'dry-run'}) ===\n`);
  const { mech, added } = addRagePayloads(rage.mechanics);
  if (!added) { console.log('  Уже актуально — payload’ы на месте.'); return; }
  console.log(`  «${rage.name}»: +${added} payload (3 resistance + 2 advantage, отсутствовавшие)`);
  await apiRequest(token, 'PUT', `/api/actions/${RAGE_ID}`, { mechanics: mech }, { dryRun });
  if (!APPLY) console.log('\n(dry-run — записи не было; добавь --apply)');
}

if (process.argv[1] && /fix-rage-effects\.mjs$/.test(process.argv[1].replace(/\\/g, '/'))) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
