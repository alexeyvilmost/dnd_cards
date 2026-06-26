// Парсер заклинаний 0–2 уровня из officials/Книга игрока 2024.txt -> POST /api/spells
// Запуск: node _spellimport.mjs           (dry-run: парсит, пишет _spells_parsed.json, печатает сводку)
//         node _spellimport.mjs --post     (отправляет в API)
import fs from 'fs';

const FILE = '../officials/Книга игрока 2024.txt';
const API = 'https://backend-production-41c3.up.railway.app/api/spells';
const POST = process.argv.includes('--post');

const SCHOOL = {
  'Ограждение': 'abjuration', 'Призыв': 'conjuration', 'Вызов': 'conjuration',
  'Прорицание': 'divination', 'Очарование': 'enchantment', 'Воплощение': 'evocation',
  'Иллюзия': 'illusion', 'Некромантия': 'necromancy', 'Преобразование': 'transmutation',
};
const CLASS = {
  'Бард': 'bard', 'Жрец': 'cleric', 'Друид': 'druid', 'Паладин': 'paladin',
  'Следопыт': 'ranger', 'Чародей': 'sorcerer', 'Колдун': 'warlock',
  'Волшебник': 'wizard', 'Изобретатель': 'artificer',
};
// слово типа урона (в разных падежах) -> enum
const DMG = [
  [/огн[ёея]м?|огня|пламен/i, 'fire'],
  [/холод/i, 'cold'],
  [/электричеств|молни/i, 'lightning'],
  [/звук/i, 'thunder'],
  [/кислот/i, 'acid'],
  [/яд(ом|а|овит)/i, 'poison'],
  [/некротическ/i, 'necrotic'],
  [/психическ/i, 'psychic'],
  [/силов/i, 'force'],
  [/излучени|свет/i, 'radiant'],
  [/дробящ/i, 'bludgeoning'],
  [/колющ/i, 'piercing'],
  [/рубящ/i, 'slashing'],
];
const SAVE = [
  [/спасбросок\s+Силы/i, 'str'], [/спасбросок\s+Ловкости/i, 'dex'],
  [/спасбросок\s+Телосложения/i, 'con'], [/спасбросок\s+Интеллекта/i, 'int'],
  [/спасбросок\s+Мудрости/i, 'wis'], [/спасбросок\s+Харизмы/i, 'cha'],
];

const raw = fs.readFileSync(FILE, 'utf8');
const lines = raw.split(/\r?\n/);

const isHeaderStart = (s) => /^(Заговор|\d+\s+уровень),/.test(s.trim());
const isNoise = (s) => {
  const t = s.trim();
  if (t === '') return true;
  if (/^\d{1,3}$/.test(t)) return true;                       // номер страницы
  if (/глава\s*7\s*\|\s*заклинани/i.test(t)) return true;     // колонтитул
  if (/^﻿?\d{1,3}\s*﻿?глава/i.test(t)) return true;
  return false;
};

// собрать полный заголовок (скобка классов может переноситься)
function readHeader(idx) {
  let h = lines[idx].trim();
  let j = idx;
  while (!h.includes(')') && j + 1 < lines.length && j - idx < 3) {
    j++; h += ' ' + lines[j].trim();
  }
  return { header: h, endIdx: j };
}

// индексы заголовков, после которых есть "Время сотворения:" в пределах 4 строк
const headers = [];
for (let i = 1; i < lines.length; i++) {
  if (!isHeaderStart(lines[i])) continue;
  let near = false;
  for (let k = i + 1; k <= i + 5 && k < lines.length; k++) {
    if (/^Время сотворения:/.test(lines[k].trim())) { near = true; break; }
  }
  if (near) headers.push(i);
}

const m = (re, s) => { const x = s.match(re); return x ? x[1].trim() : null; };

const spells = [];
const seen = new Set();
for (let hi = 0; hi < headers.length; hi++) {
  const i = headers[hi];
  const { header, endIdx } = readHeader(i);
  const hm = header.match(/^(Заговор|(\d+)\s+уровень),\s*(.+?)\s*\((.+)\)\s*$/);
  if (!hm) continue;
  const level = hm[1] === 'Заговор' ? 0 : parseInt(hm[2], 10);
  if (level > 2) continue;
  const name = (lines[i - 1] || '').trim();
  if (!name || isHeaderStart(name) || isNoise(name)) continue;
  if (seen.has(name)) continue;

  const schoolRu = hm[3].trim();
  const school = SCHOOL[schoolRu] || null;
  const classes = hm[4].split(',').map(s => CLASS[s.trim()] || null).filter(Boolean);

  // тело: от endIdx+1 до строки перед следующим заголовком (минус строка-имя)
  const nextH = hi + 1 < headers.length ? headers[hi + 1] : lines.length + 1;
  const bodyEnd = Math.min(nextH - 1, lines.length); // строка nextH-1 = имя следующего
  const body = lines.slice(endIdx + 1, bodyEnd);

  // разобрать маркеры
  let castParts = [], range = null, comp = null, duration = null;
  let di = 0;
  // casting time (может занимать несколько строк до "Дистанция:")
  while (di < body.length && !/^Время сотворения:/.test(body[di].trim())) di++;
  if (di < body.length) {
    castParts.push(body[di].replace(/^Время сотворения:\s*/, '').trim());
    di++;
    while (di < body.length && !/^Дистанция:/.test(body[di].trim())) { castParts.push(body[di].trim()); di++; }
  }
  if (di < body.length && /^Дистанция:/.test(body[di].trim())) { range = body[di].replace(/^Дистанция:\s*/, '').trim(); di++; }
  if (di < body.length && /^Компоненты:/.test(body[di].trim())) { comp = body[di].replace(/^Компоненты:\s*/, '').trim(); di++; }
  if (di < body.length && /^Длительность:/.test(body[di].trim())) { duration = body[di].replace(/^Длительность:\s*/, '').trim(); di++; }

  // описание = остаток, без шума
  let descLines = body.slice(di).filter(s => !isNoise(s)).map(s => s.trim());
  let descFull = descLines.join('\n');

  // отделить апкаст
  let upcast = null;
  const upRe = /(Использование ячейки большего уровня\.|Усиление заговора\.)/;
  const upM = descFull.match(upRe);
  if (upM) {
    const idx = descFull.indexOf(upM[0]);
    upcast = descFull.slice(idx + upM[0].length).trim();
    descFull = descFull.slice(0, idx).trim();
  }
  // схлопнуть переносы строк в пробелы внутри абзаца (OCR рвёт строки)
  const collapse = (t) => t ? t.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim() : t;
  descFull = collapse(descFull);
  upcast = collapse(upcast);

  // компоненты
  const component_verbal = /(^|[^а-я])В([,\s)]|$)/.test(comp || '');
  const component_somatic = /(^|[^а-я])С([,\s)]|$)/.test(comp || '');
  const component_material = /(^|[^а-я])М([,\s(]|$)/.test(comp || '');
  let material_text = null;
  const matM = (comp || '').match(/\(([^)]+)\)/);
  if (component_material && matM) material_text = matM[1].trim();

  const castStr = castParts.join(' ').trim();
  const ritual = /ритуал/i.test(castStr);
  const casting_time = castStr.replace(/\s*,?\s*или Ритуал/i, '').trim() || null;

  const concentration = /Концентрац/i.test(duration || '');

  // спасбросок
  const saving_throw = /спасбросок/i.test(descFull);
  let save_types = [];
  if (saving_throw) {
    for (const [re, v] of SAVE) if (re.test(descFull)) { save_types = [v]; break; }
  }
  // атака
  const attack_roll = /атаку заклинанием|дальнобойную атаку|рукопашную атаку|атаку\s+заклинанием/i.test(descFull);

  // урон: все вхождения "NкN ... <тип>"
  const damage = [];
  const dmgRe = /(\d+к\d+(?:\s*\+\s*\d+)?)\s+урона?\s+([А-Яа-яё]+)/g;
  let dm;
  while ((dm = dmgRe.exec(descFull)) !== null) {
    const diceRu = dm[1];
    const word = dm[2];
    let type = null;
    for (const [re, v] of DMG) if (re.test(word)) { type = v; break; }
    if (type) damage.push({ dice: diceRu.replace(/к/g, 'd'), damage_type: type });
  }
  // дедуп по (dice,type)
  const dedupD = [];
  const dk = new Set();
  for (const d of damage) { const k = d.dice + d.damage_type; if (!dk.has(k)) { dk.add(k); dedupD.push(d); } }

  // лечение
  const is_healing = /восстанавлива/i.test(descFull) && dedupD.length === 0;
  let heal_dice = null;
  if (is_healing) {
    const seg = descFull.match(/восстанавлива[а-я]*[^.]*/i);
    if (seg) {
      const h = seg[0].match(/(\d+к\d+)(\s*\+\s*[^.,;]*модификатор[^.,;]*)?/i);
      if (h) heal_dice = (h[1].replace(/к/g, 'd') + (h[2] ? ' + модификатор заклинателя' : '')).trim();
    }
  }

  // область
  let area = null;
  const ar = descFull.match(/(\d+[‑-]?футов[а-я]*)\s+(Сфер[а-я]*|Куб[а-я]*|Конус[а-я]*|Цилиндр[а-я]*|Лини[а-я]*|Эманаци[а-я]*)/i);
  if (ar) area = ar[1].replace('‑', '-') + ' (' + ar[2] + ')';

  if (!descFull) continue; // пропускаем пустые
  seen.add(name);
  spells.push({
    name, level, school, casting_time, range, duration,
    component_verbal, component_somatic, component_material, material_text,
    classes, subclasses: [], attack_roll, saving_throw, concentration, ritual,
    save_types, damage: dedupD, area, is_healing, heal_dice,
    description: descFull, upcast_description: upcast, source: 'PHB 2024',
  });
}

const byLvl = { 0: 0, 1: 0, 2: 0 };
spells.forEach(s => byLvl[s.level]++);
console.log(`Спарсено: ${spells.length} (заговоры ${byLvl[0]}, 1ур ${byLvl[1]}, 2ур ${byLvl[2]})`);
fs.writeFileSync('_spells_parsed.json', JSON.stringify(spells, null, 2));
console.log('Записано в _spells_parsed.json');
console.log('--- ПРИМЕРЫ ---');
for (const s of spells.slice(0, 3)) console.log(JSON.stringify(s, null, 1));

if (POST) {
  let ok = 0, fail = 0;
  for (const s of spells) {
    try {
      const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s) });
      if (r.status === 201) ok++; else { fail++; console.log('FAIL', s.name, r.status, (await r.text()).slice(0, 120)); }
    } catch (e) { fail++; console.log('ERR', s.name, e.message); }
  }
  console.log(`POST готово: ok=${ok} fail=${fail}`);
}
