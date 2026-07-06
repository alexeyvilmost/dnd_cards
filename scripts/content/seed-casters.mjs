#!/usr/bin/env node
/**
 * Полу- и треть-кастеры (PHB 2024) + нормализация классов заклинаний.
 * A) spell.classes: EN → RU (wizard→волшебник...), дедуп.
 * B) фильтры choice(source:spell) в эффектах: classes EN → RU.
 * C) Паладин/Следопыт: убрать несуществующий выбор заговоров, count заклинаний = 2.
 * D) Паладин/Следопыт: слоты half-caster сеткой by_level (движок читает resolveByLevel).
 * E) Мистический рыцарь/Мистический ловкач: слоты third-caster by_level в resources
 *    подкласса + choices заговоров/заклинаний волшебника в фиче «Сотворение заклинаний».
 *
 * Запуск: node scripts/content/seed-casters.mjs [--apply]
 */
import { apiRequest, fetchAll, login } from './api.mjs';

const APPLY = process.argv.includes('--apply');

const EN2RU = {
  wizard: 'волшебник', sorcerer: 'чародей', bard: 'бард', warlock: 'колдун',
  druid: 'друид', cleric: 'жрец', paladin: 'паладин', ranger: 'следопыт',
};

// Сетки слотов PHB 2024. Ключ — уровень персонажа, значение — число слотов.
const HALF_CASTER = {
  spell_slot_1: { 1: 2, 3: 3, 5: 4 },
  spell_slot_2: { 5: 2, 7: 3 },
  spell_slot_3: { 9: 2, 11: 3 },
  spell_slot_4: { 13: 1, 15: 2, 17: 3 },
  spell_slot_5: { 17: 1, 19: 2 },
};
const THIRD_CASTER = {
  spell_slot_1: { 3: 2, 4: 3, 7: 4 },
  spell_slot_2: { 7: 2, 10: 3 },
  spell_slot_3: { 13: 2, 16: 3 },
  spell_slot_4: { 19: 1 },
};

const toResources = (grid) => Object.fromEntries(
  Object.entries(grid).map(([id, byLevel]) => [id, { by_level: byLevel, per: 'long_rest' }]),
);

function normalizeClasses(list) {
  const out = [];
  for (const c of list || []) {
    const ru = EN2RU[String(c).toLowerCase()] || String(c);
    if (!out.includes(ru)) out.push(ru);
  }
  return out;
}

/** Правит filter.classes во всех choice(source:spell) механики. Возвращает true, если менялось. */
function normalizeSpellChoiceFilters(mechanics) {
  let changed = false;
  const scan = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(scan); return; }
    if (node.kind === 'choice' && node.options?.source === 'spell') {
      const f = node.options.filter;
      if (f && typeof f === 'object' && Array.isArray(f.classes)) {
        const ru = normalizeClasses(f.classes);
        if (JSON.stringify(ru) !== JSON.stringify(f.classes)) { f.classes = ru; changed = true; }
      }
    }
    for (const v of Object.values(node)) scan(v);
  };
  scan(mechanics);
  return changed;
}

async function main() {
  const token = APPLY ? await login() : null;
  const log = (...a) => console.log(...a);

  // ── A) классы заклинаний EN → RU ──
  const spells = await fetchAll('/api/spells', 'spells');
  let fixedSpells = 0;
  for (const s of spells) {
    const ru = normalizeClasses(s.classes);
    if (JSON.stringify(ru) !== JSON.stringify(s.classes || [])) {
      fixedSpells++;
      if (APPLY) await apiRequest(token, 'PUT', `/api/spells/${s.id}`, { classes: ru });
    }
  }
  log(`A) заклинаний с EN-классами исправлено: ${fixedSpells}/${spells.length}`);

  // ── B) фильтры spell-choices в эффектах ──
  const effects = await fetchAll('/api/effects', 'effects');
  let fixedEffects = 0;
  for (const e of effects) {
    if (!e.mechanics || !JSON.stringify(e.mechanics).includes('"spell"')) continue;
    const mech = JSON.parse(JSON.stringify(e.mechanics));
    if (normalizeSpellChoiceFilters(mech)) {
      fixedEffects++;
      if (APPLY) await apiRequest(token, 'PUT', `/api/effects/${e.id}`, { mechanics: mech });
    }
  }
  log(`B) эффектов с EN-фильтрами исправлено: ${fixedEffects}`);

  // ── C) паладин/следопыт: убрать выбор заговоров ──
  for (const name of ['Использование заклинаний (паладин)', 'Использование заклинаний (следопыт)']) {
    const e = effects.find((x) => x.name === name);
    if (!e) { log(`C) НЕ НАЙДЕН: ${name}`); continue; }
    const mech = JSON.parse(JSON.stringify(e.mechanics));
    const before = mech.effects.length;
    mech.effects = mech.effects.filter((it) => !(it.kind === 'choice' && /cantrip/.test(String(it.id))
      && JSON.stringify(it.options?.filter?.levels) === '[0]'));
    normalizeSpellChoiceFilters(mech);
    log(`C) ${name}: интеракций ${before} → ${mech.effects.length}`);
    if (APPLY) await apiRequest(token, 'PUT', `/api/effects/${e.id}`, { mechanics: mech });
  }

  // ── D) слоты полукастеров ──
  const classes = await fetchAll('/api/classes', 'classes');
  for (const name of ['Паладин', 'Следопыт']) {
    const c = classes.find((x) => x.name === name && !x.is_subclass);
    const resources = { ...(c.resources || {}), ...toResources(HALF_CASTER) };
    log(`D) ${name}: слоты half-caster by_level (кругов: ${Object.keys(HALF_CASTER).length})`);
    if (APPLY) await apiRequest(token, 'PUT', `/api/classes/${c.id}`, { resources });
  }

  // ── E) треть-кастеры ──
  const THIRD = [
    { slug: 'fighter_eldritch_knight', idPrefix: 'ek' },
    { slug: 'rogue_arcane_trickster', idPrefix: 'at' },
  ];
  for (const { slug, idPrefix } of THIRD) {
    const sub = classes.find((x) => x.card_number === slug);
    if (!sub) { log(`E) НЕ НАЙДЕН подкласс ${slug}`); continue; }
    // ресурсы подкласса (вливаются в класс при сборке)
    if (APPLY) await apiRequest(token, 'PUT', `/api/classes/${sub.id}`, { resources: toResources(THIRD_CASTER) });
    // фича «Сотворение заклинаний» 3 уровня: + choices заговоров и заклинаний волшебника
    const featureIds = sub.level_progression?.['3']?.effects || [];
    let target = null;
    for (const id of featureIds) {
      const e = effects.find((x) => x.id === id) || await fetch(`https://backend-production-41c3.up.railway.app/api/effects/${id}`).then((r) => r.json());
      if (/Сотворение заклинаний/i.test(e.name)) { target = e; break; }
    }
    if (!target) { log(`E) фича «Сотворение заклинаний» не найдена у ${slug}`); continue; }
    const mech = JSON.parse(JSON.stringify(target.mechanics || { activation: { mode: 'passive' }, effects: [] }));
    const hasChoice = JSON.stringify(mech).includes('"choice"');
    if (!hasChoice) {
      mech.effects = mech.effects || [];
      mech.effects.push(
        {
          kind: 'choice', id: `${idPrefix}_cantrips`, count: 2,
          prompt: 'Выберите 2 заговора волшебника',
          options: { source: 'spell', filter: { classes: ['волшебник'], levels: [0] } },
          grant: { kind: 'grant_spell', label: 'cantrip' },
          resolution: 'on_acquire',
        },
        {
          kind: 'choice', id: `${idPrefix}_spells_l1`, count: 3,
          prompt: 'Выберите 3 заклинания волшебника 1-го круга',
          options: { source: 'spell', filter: { classes: ['волшебник'], levels: [1] } },
          grant: { kind: 'grant_spell', label: 'known' },
          resolution: 'on_acquire',
        },
      );
      log(`E) ${slug}: добавлены выборы заговоров/заклинаний`);
      if (APPLY) await apiRequest(token, 'PUT', `/api/effects/${target.id}`, { mechanics: mech });
    } else {
      log(`E) ${slug}: choices уже есть — пропуск`);
    }
  }

  log('Готово.');
}

main().catch((e) => { console.error(e); process.exit(1); });
