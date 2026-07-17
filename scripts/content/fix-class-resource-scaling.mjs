#!/usr/bin/env node
/**
 * План 2026-07-15, задача 0.6 (KB-053 + KB-054): заряды Ярости и Вдохновение барда.
 *
 * KB-053 — Ярость зафиксирована на 2 для всех 20 уровней. RAW (canon rage_uses):
 *   {1:2, 3:3, 6:4, 12:5, 17:6}. NB: DoD плана «L9→3, L16→4» — это рага-УРОН (rage_damage
 *   {1:2,9:3,16:4}), НЕ заряды; заряды на L9=4, L16=5.
 * KB-054 — Вдохновение считалось от prof_bonus вместо модификатора Харизмы. RAW: = мод. ХАР,
 *   минимум 1 → формула max(cha, 1). L1 ХАР+3 → 3 (было 2 по prof_bonus).
 *
 * ДВОЙНОЙ ГЕЙТ (почему правки только classes.json мало): у действия есть explicit-cost на
 * класс-ресурс (rage_charge / bardic_inspiration) И mechanics.uses, который normalizeActiveMechanics
 * добавляет как ВТОРОЙ пул uses_<key> (applyActionUsesCost). uses_ACT-rage=2 держал Ярость на 2
 * даже при by_level в rage_charge. usesFromMechanics не знает by_level.
 *
 * Решение: класс-ресурс — ЕДИНСТВЕННЫЙ источник пула; редундантный mechanics.uses УДАЛЯЕМ у
 * обоих действий (у них уже есть explicit-cost на класс-ресурс, поэтому действие остаётся
 * оплачиваемым). Это заодно снимает двойной-гейт-footgun.
 *
 * Запуск:   node scripts/content/fix-class-resource-scaling.mjs          (dry-run)
 *           node scripts/content/fix-class-resource-scaling.mjs --apply
 */
import { apiRequest, fetchAll, login } from './api.mjs';

const APPLY = process.argv.includes('--apply');
const dryRun = !APPLY;

const RAGE_USES = { 1: 2, 3: 3, 6: 4, 12: 5, 17: 6 };
const ACT_RAGE_ID = '815f7963-ccac-4480-8a4d-6c790d8d2bcb';
const INSPIRATION_ID = '507a13bf-ca6a-4d14-89e4-21016293e0a7';

const canon = (v) => {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
};

/** Убрать mechanics.uses (редундантный второй пул). Возвращает {mech, changed}. */
export function stripUses(mech) {
  if (!mech || mech.uses === undefined) return { mech, changed: false };
  const { uses, ...rest } = mech;
  return { mech: rest, changed: true };
}

async function main() {
  const token = APPLY ? await login() : null;
  const [classes, actions] = await Promise.all([fetchAll('/api/classes', 'classes'), fetchAll('/api/actions', 'actions')]);

  console.log(`\n=== 0.6 / KB-053+054: масштабирование класс-ресурсов (${APPLY ? 'APPLY' : 'dry-run'}) ===\n`);

  // 1. Варвар: rage_charge → by_level.
  const barb = classes.find((c) => c.name === 'Варвар' && !c.is_subclass);
  if (barb) {
    const res = { ...(barb.resources || {}) };
    const nextRage = { by_level: RAGE_USES, per: 'long_rest' };
    if (canon(res.rage_charge) !== canon(nextRage)) {
      res.rage_charge = nextRage;
      console.log(`  Варвар: rage_charge → by_level ${JSON.stringify(RAGE_USES)}`);
      await apiRequest(token, 'PUT', `/api/classes/${barb.id}`, { resources: res }, { dryRun });
    } else console.log('  Варвар: rage_charge уже актуален');
  } else console.log('  ⚠ Варвар не найден');

  // 2. Бард: bardic_inspiration count → max(cha, 1).
  const bard = classes.find((c) => c.name === 'Бард' && !c.is_subclass);
  if (bard) {
    const res = { ...(bard.resources || {}) };
    const bi = { ...(res.bardic_inspiration || {}) };
    const oldCount = bi.count;
    if (String(oldCount) !== 'max(cha, 1)') {
      bi.count = 'max(cha, 1)';
      res.bardic_inspiration = bi;
      console.log(`  Бард: bardic_inspiration count → «max(cha, 1)» (было «${oldCount ?? '?'}»)`);
      await apiRequest(token, 'PUT', `/api/classes/${bard.id}`, { resources: res }, { dryRun });
    } else console.log('  Бард: bardic_inspiration уже актуален');
  } else console.log('  ⚠ Бард не найден');

  // 3. Убрать редундантный mechanics.uses у обоих действий (единственный пул — класс-ресурс).
  for (const [id, label] of [[ACT_RAGE_ID, 'Ярость'], [INSPIRATION_ID, 'Вдохновение барда']]) {
    const act = actions.find((a) => a.id === id);
    if (!act) { console.log(`  ⚠ действие ${label} не найдено`); continue; }
    const { mech, changed } = stripUses(act.mechanics);
    if (changed) {
      console.log(`  «${act.name ?? label}»: удаляю mechanics.uses (редундантный второй пул)`);
      await apiRequest(token, 'PUT', `/api/actions/${id}`, { mechanics: mech }, { dryRun });
    } else console.log(`  «${act.name ?? label}»: mechanics.uses уже нет`);
  }

  if (!APPLY) console.log('\n(dry-run — записи не было; добавь --apply)');
}

if (process.argv[1] && /fix-class-resource-scaling\.mjs$/.test(process.argv[1].replace(/\\/g, '/'))) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
