/**
 * Заполняет оригинальные (английские) названия предысторий — поле name_en.
 *
 * Источник — канон из оглавления английского PHB 2024 (officials/kb/phb-2024-en/toc.md,
 * раздел «Background Descriptions»): ровно 16 имён, и в базе ровно 16 предысторий,
 * то есть сопоставление — биекция и проверяется машинно.
 *
 * Слаги предысторий технические (BG-0001), английского в них нет, поэтому таблица ручная.
 *
 * PATCH минимальный — только {name_en}: в UpdateBackground прочие поля под гвардом.
 *
 * Запуск:
 *   node scripts/content/fill-name-en-backgrounds.mjs           — dry-run
 *   node scripts/content/fill-name-en-backgrounds.mjs --apply   — записать в прод
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const BASE = process.env.API_URL || 'https://backend-production-41c3.up.railway.app';
const APPLY = process.argv.includes('--apply');

const MAP = {
  'Артист': 'Entertainer',
  'Благородный': 'Noble',
  'Бродяга': 'Wayfarer',
  'Моряк': 'Sailor',
  'Мудрец': 'Sage',
  'Отшельник': 'Hermit',
  'Писарь': 'Scribe',
  'Преступник': 'Criminal',
  'Прислужник': 'Acolyte',
  'Проводник': 'Guide',
  'Ремесленник': 'Artisan',
  'Солдат': 'Soldier',
  'Стражник': 'Guard',
  'Торговец': 'Merchant',
  'Фермер': 'Farmer',
  'Шарлатан': 'Charlatan',
};

function loadCanon() {
  const toc = fs.readFileSync(path.join(ROOT, 'officials/kb/phb-2024-en/toc.md'), 'utf8').split('\n');
  const i = toc.findIndex((l) => /^ {2}- Background Descriptions/.test(l));
  if (i < 0) throw new Error('раздел Background Descriptions не найден');
  const out = [];
  for (let j = i + 1; j < toc.length; j++) {
    const indent = (toc[j].match(/^ */) || [''])[0].length;
    if (/^ *- /.test(toc[j]) && indent <= 2) break;
    const m = toc[j].match(/^ *- (.+?) … стр\./);
    if (m) out.push(m[1].trim());
  }
  return out;
}

async function main() {
  const canon = loadCanon();
  const res = await fetch(`${BASE}/api/backgrounds?limit=200`);
  if (!res.ok) throw new Error(`GET /api/backgrounds HTTP ${res.status}`);
  const data = await res.json();
  const list = data.backgrounds || data.data || [];

  console.log(`Канон PHB: ${canon.length} | предысторий в базе: ${list.length}`);

  const plan = [];
  const noName = [];
  for (const b of list) {
    const en = MAP[b.name];
    if (!en) { noName.push(b.name); continue; }
    plan.push({ id: b.id, ru: b.name, en, already: b.name_en });
  }

  const canonSet = new Set(canon);
  const invented = plan.filter((p) => !canonSet.has(p.en));
  const seen = new Map();
  for (const p of plan) seen.set(p.en, (seen.get(p.en) || 0) + 1);
  const dupes = [...seen].filter(([, c]) => c > 1);
  const unused = canon.filter((c) => !plan.some((p) => p.en === c));

  console.log(`К записи: ${plan.length} | без сопоставления: ${noName.length} ${noName.join(', ')}`);
  console.log(`Проверка «не выдумано»:      ${invented.length === 0 ? '✓' : '✗ ' + JSON.stringify(invented.map((p) => p.en))}`);
  console.log(`Проверка «биекция»:          ${dupes.length === 0 ? '✓' : '✗ ' + JSON.stringify(dupes)}`);
  console.log(`Проверка «канон весь занят»: ${unused.length === 0 ? '✓' : '✗ осталось: ' + unused.join(', ')}`);
  if (invented.length || dupes.length || unused.length || noName.length) {
    console.error('Проверки не прошли — запись отменена.');
    process.exit(1);
  }

  if (!APPLY) {
    console.log('\nDRY-RUN:');
    plan.forEach((p) => console.log(`  ${p.ru} → ${p.en}`));
    console.log('\nЗапустите с --apply, чтобы записать.');
    return;
  }

  let ok = 0; const failed = [];
  for (const p of plan) {
    try {
      const r = await fetch(`${BASE}/api/backgrounds/${p.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name_en: p.en }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      ok++;
    } catch (err) {
      failed.push({ ru: p.ru, err: err.message });
    }
  }
  console.log(`\nЗаписано: ${ok} | ошибок: ${failed.length}`);
  if (failed.length) console.log(JSON.stringify(failed, null, 1));
}

main().catch((e) => { console.error(e); process.exit(1); });
