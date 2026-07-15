#!/usr/bin/env node
/**
 * План 2026-07-15, задача 0.4 (KB-005): «Защита без доспехов» Варвара и Монаха не считается.
 *
 * Оба эффекта несут только {kind:'narrative'} — текст «КД = 10 + ЛВК + ТЕЛ» человек читает,
 * движок игнорирует. Варвар ЛВК+2/ТЕЛ+3 без доспеха получает КЗ 12 (10+ЛВК) вместо 15.
 *
 * Движок готов, код не нужен: acBaseFormulas (engine/ac.ts:37) собирает КАЖДЫЙ
 * `set_value ac_base` как метод-кандидат, computeAC берёт максимум применимого
 * (парадигма №3 «методы расчёта»). Живой образец той же формы — «Доспехи мага» (EFFECT-0256):
 *   {kind:'set_value', target:'ac_base', formula:'13 + dex'}
 *
 * Условие «без доспеха» обеспечено самим движком: ветка acBaseFormulas работает только когда
 * armorFromState() пуст (ac.ts:147). Формулы ASCII (`dex`/`con`/`wis`) — токенизатор кириллицу
 * не понимает и роняет расчёт (KB-004, задача 0.1).
 *
 * RAW PHB 2024:
 *   Варвар — AC = 10 + мод.ЛВК + мод.ТЕЛ (щит разрешён);
 *   Монах  — AC = 10 + мод.ЛВК + мод.МДР (щит НЕ разрешён).
 * ⚠ Оговорка «монах без щита» здесь НЕ моделируется: computeAC добавляет бонус щита
 * аддитивно к любому методу. Нужен предикат «щит не надет» — отдельная находка, не эта задача.
 *
 * Не трогаем: эффект-сироту `effect_barbarian_defense` (15e944a8, mechanics=null) — он не
 * висит в level_progression Варвара и удалять/править его не наша задача (парадигма №6 +
 * инцидент pf_-слотов: «похоже на дубль» ≠ «мусор»).
 *
 * Запуск:   node scripts/content/fix-unarmored-defense.mjs          (dry-run)
 *           node scripts/content/fix-unarmored-defense.mjs --apply
 */
import { apiRequest, fetchAll, login } from './api.mjs';

const APPLY = process.argv.includes('--apply');
const dryRun = !APPLY;

// Механика: narrative-текст СОХРАНЯЕМ (он показывается игроку), рядом кладём исполнимый payload.
// Гранулярность (парадигма №4): описание и расчёт — разные payload'ы одного эффекта.
const unarmoredMech = (formula, text) => ({
  activation: { mode: 'passive' },
  effects: [
    {
      resolution: 'auto',
      result: [
        { kind: 'narrative', description: text },
        { kind: 'set_value', target: 'ac_base', formula },
      ],
    },
  ],
});

const TARGETS = [
  {
    id: 'f39414a1-9ad6-42c2-ab83-f5fb57004798',
    card: 'EFF-barbarian-unarmored',
    label: 'Защита без доспехов (Варвар)',
    formula: '10 + dex + con',
    text: 'Без доспеха: КД = 10 + модификатор Ловкости + модификатор Телосложения. Щит разрешён.',
  },
  {
    id: 'e18cf12b-63e3-4da0-b5cd-be2dc2072082',
    card: 'EFF-monk-unarmored',
    label: 'Защита без доспехов (Монах)',
    formula: '10 + dex + wis',
    text: 'Без доспеха и щита: КД = 10 + модификатор Ловкости + модификатор Мудрости.',
  },
];

const canon = (v) => {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
};

async function main() {
  const token = APPLY ? await login() : null;
  const effects = await fetchAll('/api/effects', 'effects');
  const byId = new Map(effects.map((e) => [e.id, e]));

  console.log(`\n=== 0.4 / KB-005: Защита без доспехов (${APPLY ? 'APPLY' : 'dry-run'}) ===\n`);

  let changed = 0;
  for (const t of TARGETS) {
    const eff = byId.get(t.id);
    if (!eff) {
      console.log(`  ⚠ НЕ найден эффект ${t.id} «${t.label}» — пропуск`);
      continue;
    }
    const mech = unarmoredMech(t.formula, t.text);
    if (canon(eff.mechanics) === canon(mech)) {
      console.log(`  «${eff.name}» уже актуален`);
      continue;
    }
    console.log(`  «${eff.name}» (${t.card}): set_value ac_base = «${t.formula}»`);
    await apiRequest(token, 'PUT', `/api/effects/${t.id}`, { mechanics: mech }, { dryRun });
    changed++;
  }

  console.log(`\nОбновлено эффектов: ${changed}`);
  if (!APPLY) console.log('(dry-run — записи не было; добавь --apply)');
}

main().catch((e) => { console.error(e); process.exit(1); });
