/**
 * Искусность оружия — привязка МАСТЕРСТВА К ОРУЖИЮ (card.mastery), канон PHB 2024 (RU, стр. 216).
 *
 * Раньше связь жила только текстовой ссылкой в description и стояла почти лишь на ШАБЛОНАХ
 * (36 из 38), а у реальных предметов — у 3 из 102: все магические кинжалы/мечи/молоты остались
 * без искусности. Теперь ставим структурное поле card.mastery ВСЕМ оружиям по weapon_type
 * (и по имени, если weapon_type пуст — он null у трети оружия), а дублирующую текстовую строку
 * из description убираем.
 *
 * Требует миграции 076 (колонка cards.mastery). Идемпотентно.
 * Грабли: /api/cards МОЛЧА обрезает limit до 500 при total ~765 → тянем постранично.
 *
 * Запуск: node scripts/content/weapon-mastery-weapons.mjs [--dry]
 */
const BASE = process.env.API_URL || 'https://backend-production-41c3.up.railway.app';
const DRY = process.argv.includes('--dry');

// id эффектов-мастерств (EFFECT-0248..0255) — менять нельзя, на них ссылается контент.
const M = {
  topple: '1464fb09-59c1-4bc5-8143-92abae8657b1', // Опрокидывающее
  sap: '4cfe0660-ba1c-415b-b1ed-15e3c708a8e3',    // Ослабляющее
  slow: 'c7d07a67-374c-49f6-b34b-40e85c26674e',   // Замедляющее
  nick: 'c00b501c-2e9a-4f32-89e7-1c5ed898d7b2',   // Быстрое
  vex: '2877d5fd-f912-4186-867d-53d353570ded',    // Отвлекающее
  push: '82ec5a23-18f9-4c68-9119-470c1ef120d9',   // Отталкивающее
  cleave: '3ad18858-a1a9-44fc-a412-4748d8daaeaa', // Рассекающее
  graze: '651f4b6a-74c1-4ecf-a787-d98580bc9495',  // Задевающее
};

/** weapon_type → мастерство. Таблица «Оружие» PHB 2024 (RU) целиком. net — без искусности. */
const BY_TYPE = {
  // Простое рукопашное
  quarterstaff: M.topple, mace: M.sap, club: M.slow, dagger: M.nick, spear: M.sap,
  light_hammer: M.nick, javelin: M.slow, handaxe: M.vex, greatclub: M.push, sickle: M.nick,
  // Простое дальнобойное
  light_crossbow: M.slow, dart: M.vex, shortbow: M.vex, sling: M.slow,
  // Воинское рукопашное
  halberd: M.cleave, war_pick: M.sap, warhammer: M.push, battleaxe: M.topple, glaive: M.graze,
  greatsword: M.graze, lance: M.topple, longsword: M.sap, whip: M.slow, shortsword: M.vex,
  maul: M.topple, morningstar: M.sap, pike: M.push, rapier: M.vex, greataxe: M.cleave,
  scimitar: M.nick, trident: M.topple, flail: M.sap,
  // Воинское дальнобойное
  hand_crossbow: M.vex, heavy_crossbow: M.push, longbow: M.slow, blowgun: M.vex,
  musket: M.slow, pistol: M.vex,
};

/** Русские имена видов (для оружия с пустым weapon_type — выводим вид из названия). */
const RU_TO_TYPE = {
  'боевой посох': 'quarterstaff', 'посох': 'quarterstaff', // 'посох' однозначен: в PHB единственное древковое-посох — Боевой посох
  'булава': 'mace', 'дубинка': 'club', 'кинжал': 'dagger',
  'копьё': 'spear', 'копье': 'spear', 'лёгкий молот': 'light_hammer', 'легкий молот': 'light_hammer',
  'метательное копьё': 'javelin', 'метательное копье': 'javelin', 'палица': 'greatclub',
  'ручной топор': 'handaxe', 'одноручный топор': 'handaxe', 'серп': 'sickle',
  'арбалет, лёгкий': 'light_crossbow', 'лёгкий арбалет': 'light_crossbow', 'дротик': 'dart',
  'короткий лук': 'shortbow', 'праща': 'sling',
  'алебарда': 'halberd', 'боевая кирка': 'war_pick', 'клевец': 'war_pick', 'боевой молот': 'warhammer',
  'боевой топор': 'battleaxe', 'глефа': 'glaive', 'двуручный меч': 'greatsword',
  'длинное копьё': 'lance', 'кавалерийское копьё': 'lance', 'длинный меч': 'longsword',
  'кнут': 'whip', 'короткий меч': 'shortsword', 'молот': 'maul', 'моргенштерн': 'morningstar',
  'пика': 'pike', 'рапира': 'rapier', 'секира': 'greataxe', 'скимитар': 'scimitar',
  'трезубец': 'trident', 'цеп': 'flail',
  'арбалет, ручной': 'hand_crossbow', 'ручной арбалет': 'hand_crossbow',
  'арбалет, тяжёлый': 'heavy_crossbow', 'тяжёлый арбалет': 'heavy_crossbow',
  'длинный лук': 'longbow', 'духовая трубка': 'blowgun', 'мушкет': 'musket', 'пистоль': 'pistol',
};

/** Вид оружия из названия: самое ДЛИННОЕ совпадение (иначе «Молот» съест «Боевой молот»). */
function typeFromName(name) {
  const n = String(name || '').toLowerCase();
  let best = null;
  for (const [ru, t] of Object.entries(RU_TO_TYPE)) {
    if (n.includes(ru) && (!best || ru.length > best.ru.length)) best = { ru, t };
  }
  return best?.t ?? null;
}

/** Убрать дублирующую текстовую строку мастерства — теперь это структурное поле. */
function stripMasteryText(desc) {
  if (!desc) return desc;
  return desc
    .replace(/\[\[Мастерство\|concept:weapon_mastery\]\]\s*:\s*\[\[[^\]]*\]\]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function fetchAllCards() {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const r = await (await fetch(`${BASE}/api/cards?limit=500&page=${page}`)).json();
    const cards = r.cards || [];
    out.push(...cards);
    const total = r.total ?? out.length;
    if (out.length >= total || !cards.length) break;
  }
  return out;
}

async function main() {
  const cards = await fetchAllCards();
  const weapons = cards.filter((c) => c.type === 'weapon');
  console.log(`карт всего: ${cards.length} | оружия: ${weapons.length}`);

  const stats = { set: 0, already: 0, noType: [], noMastery: [], fail: 0 };
  for (const c of weapons) {
    const wtype = c.weapon_type || typeFromName(c.name);
    if (!wtype) { stats.noType.push(c.name); continue; }
    const mastery = BY_TYPE[wtype];
    if (!mastery) { stats.noMastery.push(`${c.name} (${wtype})`); continue; }

    const newDesc = stripMasteryText(c.description);
    if (c.mastery === mastery && newDesc === (c.description ?? '').trim()) { stats.already++; continue; }
    if (DRY) { stats.set++; continue; }

    const body = { ...c, mastery, description: newDesc, weapon_type: wtype };
    const res = await fetch(`${BASE}/api/cards/${c.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (res.ok) stats.set++;
    else { stats.fail++; console.log(`FAIL ${c.name}: ${res.status} ${(await res.text()).slice(0, 120)}`); }
  }

  console.log(`\nпроставлено: ${stats.set} | уже было: ${stats.already} | ошибок: ${stats.fail}`);
  if (stats.noType.length) console.log(`без вида оружия (пропущено ${stats.noType.length}): ${stats.noType.slice(0, 12).join(', ')}`);
  if (stats.noMastery.length) console.log(`вид без искусности по PHB (${stats.noMastery.length}): ${stats.noMastery.join(', ')}`);
  console.log('DONE' + (DRY ? ' (dry-run)' : ''));
}
main().catch((e) => { console.error(e); process.exit(1); });
