#!/usr/bin/env node
/**
 * План 2026-07-15, задача 0.12 (KB-055): четыре фичи стоят не на своём уровне (RAW PHB 2024).
 * Перенос ссылки на эффект между ключами level_progression класса:
 *   • Первобытные знания (Варвар):     L1 → L3   (создать ключ L3 — его у Варвара нет);
 *   • Фокус монаха (Монах):            L1 → L2;
 *   • Ловкий исследователь (Следопыт): L1 → L2;
 *   • Мистические воззвания (Колдун):  L2 → L1   (ТОЛЬКО уровень; count:2→1/3 — задача C.2).
 *
 * Переносится только ссылка на эффект (не трогаем actions, count, саму механику эффекта —
 * остальные дефекты «Первобытных знаний» и count Воззваний закрывают C.6/C.2).
 *
 * Запуск:   node scripts/content/fix-feature-levels.mjs          (dry-run)
 *           node scripts/content/fix-feature-levels.mjs --apply
 */
import { apiRequest, fetchAll, login } from './api.mjs';

const APPLY = process.argv.includes('--apply');
const dryRun = !APPLY;

const MOVES = [
  { cls: 'Варвар', effect: '2d518b3d-35e2-4f42-8d93-70ca33a33630', from: '1', to: '3', label: 'Первобытные знания' },
  { cls: 'Монах', effect: '22906b8f-6324-4964-960a-57ad1cd11423', from: '1', to: '2', label: 'Фокус монаха' },
  { cls: 'Следопыт', effect: '8d0758b0-f96f-4fe7-891b-05a7a37d998b', from: '1', to: '2', label: 'Ловкий исследователь' },
  { cls: 'Колдун', effect: '39f2a896-dda5-4424-b976-bc7ceb60152b', from: '2', to: '1', label: 'Мистические воззвания' },
];

async function main() {
  const token = APPLY ? await login() : null;
  const classes = await fetchAll('/api/classes', 'classes');

  console.log(`\n=== 0.12 / KB-055: фичи на свои уровни (${APPLY ? 'APPLY' : 'dry-run'}) ===\n`);

  // Группируем по классу (несколько переносов у одного класса — один PUT).
  const byClass = new Map();
  for (const m of MOVES) {
    const c = classes.find((x) => x.name === m.cls && !x.is_subclass);
    if (!c) { console.log(`  ⚠ класс «${m.cls}» не найден — пропуск «${m.label}»`); continue; }
    if (!byClass.has(c.id)) byClass.set(c.id, { c, moves: [] });
    byClass.get(c.id).moves.push(m);
  }

  for (const { c, moves } of byClass.values()) {
    const prog = JSON.parse(JSON.stringify(c.level_progression || {}));
    let touched = false;
    for (const m of moves) {
      const fromRow = prog[m.from] || { effects: [], actions: [] };
      const inFrom = (fromRow.effects || []).includes(m.effect);
      const toRow = prog[m.to] || { effects: [], actions: [] };
      const inTo = (toRow.effects || []).includes(m.effect);
      if (!inFrom && inTo) { console.log(`  ${c.name}: «${m.label}» уже на L${m.to}`); continue; }
      if (!inFrom && !inTo) { console.log(`  ⚠ ${c.name}: «${m.label}» нет ни на L${m.from}, ни на L${m.to} — пропуск`); continue; }
      // снять с from
      prog[m.from] = { ...fromRow, effects: (fromRow.effects || []).filter((id) => id !== m.effect) };
      // добавить на to (создать ключ при отсутствии)
      prog[m.to] = { effects: [...(toRow.effects || []), m.effect], actions: toRow.actions || [] };
      console.log(`  ${c.name}: «${m.label}» L${m.from} → L${m.to}${prog[m.to].effects.length === 1 ? ' (создан ключ)' : ''}`);
      touched = true;
    }
    if (touched) await apiRequest(token, 'PUT', `/api/classes/${c.id}`, { level_progression: prog }, { dryRun });
  }

  if (!APPLY) console.log('\n(dry-run — записи не было; добавь --apply)');
}

if (process.argv[1] && /fix-feature-levels\.mjs$/.test(process.argv[1].replace(/\\/g, '/'))) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
