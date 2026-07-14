/**
 * Заполняет оригинальные (английские) названия заклинаний — поле name_en.
 *
 * Источник имён — НЕ память модели, а канон из книги:
 *   officials/kb/phb-2024-en/toc.md — закладки PDF английского PHB 2024 (раздел Spell Descriptions).
 * Сопоставление RU→EN строится двумя путями и проверяется биекцией:
 *   1) у 248 заклинаний card_number уже английский (animal_shapes → Animal Shapes) — берём канон по слагу;
 *   2) у остальных слаг технический (SPELL-NNNN) — ручная таблица ниже.
 * Спорные пары разрешены по данным (уровень+школа+классы), а не на слух:
 *   Порча = ур.1 enchantment [бард,жрец,колдун] → Bane;  Сглаз = ур.1 enchantment [колдун] → Hex.
 *
 * Дефекты источника (оглавление PDF), исправлены явно:
 *   - OCR: «Darvision» → Darkvision, «Pantasmal Killer» → Phantasmal Killer;
 *   - потеряна закладка «Bane» (в разделе B её нет) — добавлена вручную;
 *   - у «Water Breathing» в оглавлении потеряна пометка (R), хотя в базе ritual=true (имя не затронуто).
 *
 * PATCH шлём минимальный — только {name_en}: в UpdateSpell все прочие поля под гвардом
 * (if req.X != "" / != nil), а name_en присваивается всегда, поэтому ничего не затирается.
 *
 * Запуск:
 *   node scripts/content/fill-name-en-spells.mjs           — dry-run (ничего не пишет)
 *   node scripts/content/fill-name-en-spells.mjs --apply   — записать в прод
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const BASE = process.env.API_URL || 'https://backend-production-41c3.up.railway.app';
const APPLY = process.argv.includes('--apply');

// Ключ сравнения: только буквы/цифры (снимает апострофы, дефисы, косые черты).
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');

// ─── Канон из оглавления английского PHB ──────────────────────────────────────
const OCR_FIX = { Darvision: 'Darkvision', 'Pantasmal Killer': 'Phantasmal Killer' };

function loadCanon() {
  const toc = fs.readFileSync(path.join(ROOT, 'officials/kb/phb-2024-en/toc.md'), 'utf8').split('\n');
  const start = toc.findIndex((l) => /^ {2}- Spell Descriptions/.test(l));
  if (start < 0) throw new Error('раздел Spell Descriptions не найден в toc.md');
  const names = [];
  for (let i = start + 1; i < toc.length; i++) {
    if (/^ {0,3}- /.test(toc[i])) break; // вышли из раздела
    const m = toc[i].match(/^ {6}- (.+?) … стр\. \d+\s*$/);
    if (!m) continue;
    let n = m[1].trim();
    if (n.endsWith('(R)')) n = n.slice(0, -3).trim();
    names.push(OCR_FIX[n] || n);
  }
  names.push('Bane'); // закладка потеряна в PDF, заклинание в книге есть
  return names;
}

// ─── Ручная таблица для слагов SPELL-NNNN ─────────────────────────────────────
const MANUAL = {
  'Безмолвный образ': 'Silent Image', 'Благословение': 'Bless', 'Божественная кара': 'Divine Smite',
  'Божественное благоволение': 'Divine Favor', 'Брызги кислоты': 'Acid Splash', 'Ведьмин снаряд': 'Witch Bolt',
  'Вечный огонь': 'Continual Flame', 'Видение невидимого': 'See Invisibility', 'Внушение': 'Suggestion',
  'Волна грома': 'Thunderwave', 'Волшебная аура Нистула': "Nystul's Magic Aura", 'Волшебная рука': 'Mage Hand',
  'Волшебная стрела': 'Magic Missile', 'Волшебные уста': 'Magic Mouth', 'Волшебный замок': 'Arcane Lock',
  'Воображаемая сила': 'Phantasmal Force', 'Вызов Зверя': 'Summon Beast', 'Вызов на дуэль': 'Compelled Duel',
  'Гадание': 'Augury', 'Героизм': 'Heroism', 'Глухота/Слепота': 'Blindness/Deafness', 'Гневная кара': 'Wrathful Smite',
  'Горящий клинок': 'Flame Blade', 'Град шипов': 'Hail of Thorns', 'Громовая кара': 'Thunderous Smite',
  'Диссонирующий шёпот': 'Dissonant Whispers', 'Добряника': 'Goodberry', 'Доспех Агатиса': 'Armor of Agathys',
  'Доспехи мага': 'Mage Armor', 'Дребезги': 'Shatter', 'Дружба': 'Friends', 'Дружба с животными': 'Animal Friendship',
  'Дубинка': 'Shillelagh', 'Дубовая кожа': 'Barkskin', 'Духовное оружие': 'Spiritual Weapon',
  'Дыхание дракона': "Dragon's Breath", 'Животные чувства': 'Beast Sense', 'Жуткий смех Таши': "Tasha's Hideous Laughter",
  'Завеса стрел': 'Cordon of Arrows', 'Защита от добра и зла': 'Protection from Evil and Good',
  'Защита от оружия': 'Blade Ward', 'Защита от яда': 'Protection from Poison', 'Звёздный светлячок': 'Starry Wisp',
  'Злая насмешка': 'Vicious Mockery', 'Иллюзорные письмена': 'Illusory Script', 'Кислотная стрела Мельфа': "Melf's Acid Arrow",
  'Корона безумия': 'Crown of Madness', 'Левитация': 'Levitate', 'Ледяной кинжал': 'Ice Knife',
  'Лечащее слово': 'Healing Word', 'Лечение ран': 'Cure Wounds', 'Лунный луч': 'Moonbeam', 'Луч холода': 'Ray of Frost',
  'Магическое оружие': 'Magic Weapon', 'Малое восстановление': 'Lesser Restoration', 'Маскировка': 'Disguise Self',
  'Метка охотника': "Hunter's Mark", 'Меткий удар': 'True Strike', 'Мистическая бодрость': 'Arcane Vigor',
  'Мистический заряд': 'Eldritch Blast', 'Молебен лечения': 'Prayer of Healing', 'Нанесение ран': 'Inflict Wounds',
  'Направляющий снаряд': 'Guiding Bolt', 'Наставление': 'Guidance', 'Невидимость': 'Invisibility',
  'Невидимый слуга': 'Unseen Servant', 'Нетленные останки': 'Gentle Repose', 'Облако кинжалов': 'Cloud of Daggers',
  'Область истины': 'Zone of Truth', 'Обнаружение болезней и яда': 'Detect Poison and Disease',
  'Обнаружение добра и зла': 'Detect Evil and Good', 'Обнаружение мыслей': 'Detect Thoughts',
  'Обретение скакуна': 'Find Steed', 'Обретение фамильяра': 'Find Familiar', 'Огненные ладони': 'Burning Hands',
  'Опознание': 'Identify', 'Опутывание': 'Entangle', 'Опутывающий удар': 'Ensnaring Strike', 'Открывание': 'Knock',
  'Отражения': 'Mirror Image', 'Охраняющая связь': 'Warding Bond', 'Очарование личности': 'Charm Person',
  'Очищение пищи и питья': 'Purify Food and Drink', 'Падение пёрышком': 'Feather Fall', 'Палящая кара': 'Searing Smite',
  'Палящий луч': 'Scorching Ray', 'Парящий диск Тензера': "Tenser's Floating Disk", 'Паутина': 'Web',
  'Паучье лазание': 'Spider Climb', 'Погребальный звон': 'Toll the Dead', 'Подмога': 'Aid',
  'Поиск животных или растений': 'Locate Animals or Plants', 'Поиск ловушек': 'Find Traps', 'Поиск объекта': 'Locate Object',
  'Понимание языков': 'Comprehend Languages', 'Поросль шипов': 'Spike Growth', 'Порча': 'Bane',
  'Порыв ветра': 'Gust of Wind', 'Поспешное отступление': 'Expeditious Retreat', 'Почтовое животное': 'Animal Messenger',
  'Приказ': 'Command', 'Пронзание разума': 'Mind Spike', 'Прыжок': 'Jump', 'Пылающий шар': 'Flaming Sphere',
  'Разговор с Животными': 'Speak with Animals', 'Размытый образ': 'Blur', 'Раскалённый металл': 'Heat Metal',
  'Раскат грома': 'Thunderclap', 'Расщепление разума': 'Mind Sliver', 'Речь златоуста': 'Enthrall',
  'Руки Хадара': 'Arms of Hadar', 'Сверкающие брызги': 'Color Spray', 'Священное пламя': 'Sacred Flame',
  'Сглаз': 'Hex', 'Сигнал тревоги': 'Alarm', 'Сияющая кара': 'Shining Smite', 'Слово сияния': 'Word of Radiance',
  'Смазка': 'Grease', 'Смена обличья': 'Alter Self', 'Сообщение': 'Message', 'Сопротивление': 'Resistance',
  'Сотворение или уничтожение воды': 'Create or Destroy Water', 'Сотворение пламени': 'Produce Flame',
  'Стихийность': 'Elementalism', 'Тёмное зрение': 'Darkvision', 'Терновый кнут': 'Thorn Whip', 'Тишина': 'Silence',
  'Трюк с верёвкой': 'Rope Trick', 'Туманное облако': 'Fog Cloud', 'Убежище': 'Sanctuary',
  'Увеличение/уменьшение': 'Enlarge/Reduce', 'Улучшение характеристики': 'Enhance Ability', 'Умиротворение': 'Calm Emotions',
  'Усыпление': 'Sleep', 'Уход за умирающим': 'Spare the Dying', 'Цветной шарик': 'Chromatic Orb',
  'Чародейский выброс': 'Sorcerous Burst', 'Щит': 'Shield', 'Щит веры': 'Shield of Faith', 'Электрошок': 'Shocking Grasp',
  // Слаг английский, но без притяжательных/пунктуации канона.
  'Великолепный особняк Морденкайнена': "Mordenkainen's Magnificent Mansion",
  'Неудержимая пляска Отто': "Otto's Irresistible Dance",
  'Воображаемый убийца': 'Phantasmal Killer',
  // Не из PHB — оригинала нет, оставляем пустым осознанно.
  'Астральный рывок': null,
  'Воплощение силы': null,
};

async function fetchAllSpells() {
  const out = [];
  for (let page = 1; ; page++) {
    const res = await fetch(`${BASE}/api/spells?page=${page}&limit=100`);
    if (!res.ok) throw new Error(`GET /api/spells HTTP ${res.status}`);
    const data = await res.json();
    const batch = data.spells || data.data || [];
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

async function main() {
  const canon = loadCanon();
  const canonByNorm = new Map(canon.map((n) => [norm(n), n]));
  const spells = await fetchAllSpells();
  console.log(`Канон PHB: ${canon.length} имён | заклинаний в базе: ${spells.length}`);

  const plan = [];
  const noName = [];
  for (const s of spells) {
    const manual = Object.prototype.hasOwnProperty.call(MANUAL, s.name) ? MANUAL[s.name] : undefined;
    const name = manual !== undefined ? manual : canonByNorm.get(norm(s.card_number)) || null;
    if (!name) { noName.push(s.name); continue; }
    plan.push({ id: s.id, ru: s.name, en: name, already: s.name_en });
  }

  // Проверки перед записью: ничего не выдумано, имена не повторяются.
  const invented = plan.filter((p) => !canonByNorm.has(norm(p.en)));
  const seen = new Map();
  for (const p of plan) seen.set(p.en, (seen.get(p.en) || 0) + 1);
  const dupes = [...seen].filter(([, c]) => c > 1);

  console.log(`К записи: ${plan.length} | без оригинала (не PHB): ${noName.length} → ${noName.join(', ') || '—'}`);
  console.log(`Проверка «не выдумано»: ${invented.length === 0 ? '✓' : '✗ ' + JSON.stringify(invented.map((p) => p.en))}`);
  console.log(`Проверка «биекция»:     ${dupes.length === 0 ? '✓' : '✗ ' + JSON.stringify(dupes)}`);
  if (invented.length || dupes.length) { console.error('Проверки не прошли — запись отменена.'); process.exit(1); }

  const changed = plan.filter((p) => p.already !== p.en);
  console.log(`Уже проставлено верно: ${plan.length - changed.length} | требуют записи: ${changed.length}`);

  if (!APPLY) {
    console.log('\nDRY-RUN. Примеры:');
    changed.slice(0, 8).forEach((p) => console.log(`  ${p.ru} → ${p.en}`));
    console.log(`\nЗапустите с --apply, чтобы записать ${changed.length} шт.`);
    return;
  }

  let ok = 0; const failed = [];
  for (const p of changed) {
    try {
      const res = await fetch(`${BASE}/api/spells/${p.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name_en: p.en }), // только name_en — остальное под гвардом
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      ok++;
      if (ok % 50 === 0) console.log(`  … ${ok}/${changed.length}`);
    } catch (err) {
      failed.push({ ru: p.ru, err: err.message });
    }
  }
  console.log(`\nЗаписано: ${ok} | ошибок: ${failed.length}`);
  if (failed.length) console.log(JSON.stringify(failed.slice(0, 10), null, 1));
}

main().catch((e) => { console.error(e); process.exit(1); });
