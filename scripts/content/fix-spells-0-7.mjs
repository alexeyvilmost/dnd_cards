#!/usr/bin/env node
/**
 * План 2026-07-15, задача 0.7 (KB-077 + KB-078 + KB-082): три заклинания, три правки данных.
 *
 * KB-077 «Ускорение» (haste, 1661dfe1): модификатор advantage на saving_throw БЕЗ фильтра →
 *   преимущество на ВСЕ спасброски (RAW — только Ловкости). Самоусиливалось (давало преимущество
 *   и на ТЕЛ-спас концентрации, удерживающий само Ускорение). Фикс: + filter:{ability:'dex'}.
 *
 * KB-078 «Паутина» (Web, 0446564e): в on_fail есть урон 2d4 огня + апкаст — у Web НЕТ ни урона,
 *   ни апкаста (RAW). Плюс restrained без duration → вечное состояние. Фикс: убрать damage-payload;
 *   restrained → duration {amount:600, type:'rounds'} (Web = концентрация до 1 часа = 600 раундов;
 *   resolveDuration знает только 'rounds'/until_*, не 'concentration').
 *
 * KB-082 «Огненный снаряд» (fire_bolt, 50626b5a): scaling.dice '1d6' вместо RAW '1d10' —
 *   единственный неверно масштабируемый заговор. Текст описания уже корректен (1к10).
 *
 * Идемпотентно. Запуск: node scripts/content/fix-spells-0-7.mjs [--apply]
 */
import { apiRequest, fetchAll, login } from './api.mjs';

const APPLY = process.argv.includes('--apply');
const dryRun = !APPLY;

const canon = (v) => {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
};

/** Ускорение: advantage на saving_throw → только Ловкости. */
export function fixHaste(mech) {
  const m = JSON.parse(JSON.stringify(mech));
  for (const eff of m.effects || []) {
    for (const p of eff.result || []) {
      if (p.kind === 'modifier' && p.op === 'advantage' && p.applies_to?.roll === 'saving_throw' && !p.applies_to.filter) {
        p.applies_to.filter = { ability: 'dex' };
      }
    }
  }
  return m;
}

/** Паутина: убрать урон огнём + апкаст; restrained → duration 600 раундов. */
export function fixWeb(mech) {
  const m = JSON.parse(JSON.stringify(mech));
  for (const eff of m.effects || []) {
    if (Array.isArray(eff.on_fail)) {
      eff.on_fail = eff.on_fail.filter((p) => !(p.kind === 'damage'));
      for (const p of eff.on_fail) {
        if (p.kind === 'condition' && p.value === 'restrained' && !p.duration) {
          p.duration = { amount: 600, type: 'rounds' };
        }
      }
    }
  }
  return m;
}

/** Огненный снаряд: scaling.dice 1d6 → 1d10. */
export function fixFireBolt(mech) {
  const m = JSON.parse(JSON.stringify(mech));
  for (const eff of m.effects || []) {
    for (const p of eff.on_hit || []) {
      if (p.kind === 'damage' && p.scaling?.dice === '1d6') p.scaling.dice = '1d10';
    }
  }
  return m;
}

const TARGETS = [
  { id: '1661dfe1-71c5-4b4a-92c9-660cc787ac5c', label: 'Ускорение', fix: fixHaste },
  { id: '0446564e-e986-4d00-9c81-29bc7bb96f71', label: 'Паутина', fix: fixWeb },
  { id: '50626b5a-33c5-46e0-af0e-50599f4306a0', label: 'Огненный снаряд', fix: fixFireBolt },
];

async function main() {
  const token = APPLY ? await login() : null;
  const spells = await fetchAll('/api/spells', 'spells');

  console.log(`\n=== 0.7 / KB-077+078+082: три заклинания (${APPLY ? 'APPLY' : 'dry-run'}) ===\n`);
  let changed = 0;
  for (const t of TARGETS) {
    const sp = spells.find((s) => s.id === t.id);
    if (!sp) { console.log(`  ⚠ «${t.label}» (${t.id.slice(0, 8)}) не найдено`); continue; }
    const next = t.fix(sp.mechanics);
    if (canon(next) === canon(sp.mechanics)) { console.log(`  «${sp.name}» уже актуально`); continue; }
    console.log(`  «${sp.name}»: механика обновлена`);
    await apiRequest(token, 'PUT', `/api/spells/${t.id}`, { mechanics: next }, { dryRun });
    changed++;
  }
  console.log(`\nОбновлено: ${changed}`);
  if (!APPLY) console.log('(dry-run — записи не было; добавь --apply)');
}

if (process.argv[1] && /fix-spells-0-7\.mjs$/.test(process.argv[1].replace(/\\/g, '/'))) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
