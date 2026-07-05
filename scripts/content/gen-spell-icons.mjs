#!/usr/bin/env node
/**
 * Генерация иконок заклинаний в стиле существующих (BG3-глиф на прозрачном фоне).
 * Конвейер тот же, что кнопка генерации на сайте: POST /api/images/generate-standalone
 * со style=spell_icon (промпт собирает backend/openai_service.go: generateSpellIconPrompt).
 *
 * Кандидаты: заклинания без image_url. Subject — EN-имя (из батчей импорта
 * spells2024-batch-*.json, RU→EN), стихия — damage_type / healing / школа.
 * Итог: PUT /api/spells/:id {image_url: <Yandex Storage URL>}.
 *
 * Запуск: node scripts/content/gen-spell-icons.mjs [--apply] [--limit N]
 * Отчёт: scripts/content/batches/data/spell-icons-report.json
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { apiRequest, apiUrl, fetchAll, login } from './api.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'batches/data');

const APPLY = process.argv.includes('--apply');
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;
const CONCURRENCY = 3;

// Школа → стихия (ключи spellEnergyColors в backend/openai_service.go);
// '' → нейтральный "glowing arcane" на стороне бэкенда.
const SCHOOL_ELEMENT = {
  abjuration: 'cold',
  conjuration: 'force',
  divination: 'radiant',
  enchantment: 'psychic',
  evocation: 'force',
  illusion: 'psychic',
  necromancy: 'necrotic',
  transmutation: '',
};

// Композиция как у эталонных иконок: тонкие штрихи, глиф ~70% кадра.
const EXTRA = 'Thin elegant strokes of energy. The symbol occupies about 70% of the frame, centered, with clear margins on all sides.';

// EN-имена заклинаний, которых нет в батчах импорта (сеялись раньше).
const LEGACY_EN = {
  'Волшебная аура Нистула': "Nystul's Magic Aura",
  'Волшебные уста': 'Magic Mouth',
  'Волшебный замок': 'Arcane Lock',
  'Воображаемая сила': 'Phantasmal Force',
  'Вызов Зверя': 'Summon Beast',
  'Гадание': 'Augury',
  'Глухота/Слепота': 'Blindness/Deafness',
  'Горящий клинок': 'Flame Blade',
  'Дребезги': 'Shatter',
  'Дубовая кожа': 'Barkskin',
  'Духовное оружие': 'Spiritual Weapon',
  'Дыхание дракона': "Dragon's Breath",
  'Животные чувства': 'Beast Sense',
  'Завеса стрел': 'Cordon of Arrows',
  'Защита от яда': 'Protection from Poison',
  'Кислотная стрела Мельфа': "Melf's Acid Arrow",
  'Корона безумия': 'Crown of Madness',
  'Левитация': 'Levitate',
  'Лунный луч': 'Moonbeam',
  'Луч слабости': 'Ray of Enfeeblement',
  'Магическое оружие': 'Magic Weapon',
  'Малое восстановление': 'Lesser Restoration',
  'Мистическая бодрость': 'Arcane Vigor',
  'Молебен лечения': 'Prayer of Healing',
  'Невидимость': 'Invisibility',
  'Нетленные останки': 'Gentle Repose',
  'Облако кинжалов': 'Cloud of Daggers',
  'Область истины': 'Zone of Truth',
  'Обнаружение мыслей': 'Detect Thoughts',
  'Обретение скакуна': 'Find Steed',
  'Открывание': 'Knock',
  'Отражения': 'Mirror Image',
  'Охраняющая связь': 'Warding Bond',
  'Палящий луч': 'Scorching Ray',
  'Паутина': 'Web',
  'Паучье лазание': 'Spider Climb',
  'Подмога': 'Aid',
  'Поиск животных или растений': 'Locate Animals or Plants',
  'Поиск ловушек': 'Find Traps',
  'Поиск объекта': 'Locate Object',
  'Поросль шипов': 'Spike Growth',
  'Порыв ветра': 'Gust of Wind',
  'Почтовое животное': 'Animal Messenger',
  'Пронзание разума': 'Mind Spike',
  'Пылающий шар': 'Flaming Sphere',
  'Размытый образ': 'Blur',
  'Раскалённый металл': 'Heat Metal',
  'Речь златоуста': 'Enthrall',
  'Сияющая кара': 'Shining Smite',
  'Смена обличья': 'Alter Self',
  'Тёмное зрение': 'Darkvision',
  'Тишина': 'Silence',
  'Трюк с верёвкой': 'Rope Trick',
  'Туманный шаг': 'Misty Step',
  'Тьма': 'Darkness',
  'Увеличение/уменьшение': 'Enlarge/Reduce',
  'Удержание личности': 'Hold Person',
  'Улучшение характеристики': 'Enhance Ability',
  'Умиротворение': 'Calm Emotions',
};

function loadEnNames() {
  const map = new Map();
  for (const [ru, en] of Object.entries(LEGACY_EN)) map.set(ru.toLowerCase(), en);
  for (const f of readdirSync(DATA_DIR)) {
    if (!/^spells2024-batch-\d+\.json$/.test(f)) continue;
    try {
      const arr = JSON.parse(readFileSync(join(DATA_DIR, f), 'utf8'));
      for (const rec of Array.isArray(arr) ? arr : []) {
        if (rec.name && rec.en_name) map.set(rec.name.toLowerCase(), rec.en_name);
      }
    } catch { /* повреждённый батч — пропускаем */ }
  }
  return map;
}

function elementOf(spell) {
  const dt = spell.damage?.[0]?.damage_type;
  if (dt) return dt;
  if (spell.is_healing) return 'healing';
  return SCHOOL_ELEMENT[spell.school] ?? '';
}

async function generateIcon(subject, element) {
  const res = await fetch(`${apiUrl()}/api/images/generate-standalone`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ style: 'spell_icon', subject, element, extra: EXTRA, quality: 'medium' }),
  });
  if (!res.ok) throw new Error(`gen ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  if (!data.image_url) throw new Error('нет image_url в ответе');
  return data.image_url;
}

async function main() {
  const enNames = loadEnNames();
  const spells = await fetchAll('/api/spells', 'spells');
  const candidates = spells.filter((s) => !s.image_url).slice(0, LIMIT);
  console.log(`Заклинаний: ${spells.length}; без иконки: ${candidates.length}; EN-имён: ${enNames.size}; режим: ${APPLY ? 'APPLY' : 'dry-run'}`);

  const token = APPLY ? await login() : null;
  const report = { generated: [], failed: [], dataUrlFallback: [] };
  let done = 0;

  async function worker(queue) {
    for (;;) {
      const spell = queue.shift();
      if (!spell) return;
      const en = enNames.get(spell.name.toLowerCase());
      const subject = en ? `${en} (${spell.name})` : spell.name;
      const element = elementOf(spell);
      if (!APPLY) {
        console.log(`[DRY] ${spell.name} → subject="${subject}" element="${element || 'arcane'}"`);
        report.generated.push({ name: spell.name, subject, element });
        continue;
      }
      try {
        let url;
        try {
          url = await generateIcon(subject, element);
        } catch (e1) {
          await new Promise((r) => setTimeout(r, 5000));
          url = await generateIcon(subject, element); // одна повторная попытка
          void e1;
        }
        if (url.startsWith('data:')) report.dataUrlFallback.push(spell.name);
        await apiRequest(token, 'PUT', `/api/spells/${spell.id}`, { image_url: url });
        report.generated.push({ name: spell.name, element, url: url.slice(0, 100) });
      } catch (e) {
        report.failed.push(`${spell.name}: ${String(e).slice(0, 150)}`);
      }
      done++;
      if (done % 10 === 0) console.log(`  …${done}/${candidates.length} (ошибок ${report.failed.length})`);
    }
  }

  const queue = [...candidates];
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));

  const out = join(DATA_DIR, 'spell-icons-report.json');
  writeFileSync(out, JSON.stringify(report, null, 1));
  console.log(`Готово: сгенерировано ${report.generated.length}, ошибок ${report.failed.length}, data-url fallback ${report.dataUrlFallback.length}`);
  console.log(`Отчёт: ${out}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
