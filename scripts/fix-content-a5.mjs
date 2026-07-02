#!/usr/bin/env node
/**
 * Фаза A5: чистка контента прод-БД через API.
 * Запуск: node scripts/fix-content-a5.mjs
 * Переменные: API_URL, AUTH_USER, AUTH_PASS, DRY_RUN=1
 */
const API_URL = process.env.API_URL || 'https://backend-production-41c3.up.railway.app';
const AUTH_USER = process.env.AUTH_USER || 'importer_user';
const AUTH_PASS = process.env.AUTH_PASS || 'importer_pass123';
const DRY_RUN = process.env.DRY_RUN === '1';

const SKILL_RU_TO_ID = {
  'тайная магия': 'arcana',
  'магия': 'arcana',
};

const ORIGIN_FEAT_BY_NAME = {
  'музыкант': 'FEAT-0007',
  'одарённый': 'FEAT-0008',
  'одаренный': 'FEAT-0008',
  'везунчик': 'FEAT-0002',
  'дебошир': 'FEAT-0003',
  'посвящённый в магию (волшебник)': 'FEAT-0009',
  'посвященный в магию (волшебник)': 'FEAT-0009',
  'посвящённый в магию: волшебник': 'FEAT-0009',
  'посвященный в магию: волшебник': 'FEAT-0009',
  'лекарь': 'FEAT-0006',
  'бдительный': 'FEAT-0001',
  'посвящённый в магию (жрец)': 'FEAT-0077',
  'посвященный в магию (жрец)': 'FEAT-0077',
  'посвящённый в магию: жрец': 'FEAT-0077',
  'посвященный в магию: жрец': 'FEAT-0077',
  'посвящённый в магию (друид)': 'FEAT-0078',
  'посвященный в магию (друид)': 'FEAT-0078',
  'посвящённый в магию: друид': 'FEAT-0078',
  'посвященный в магию: друид': 'FEAT-0078',
  'самоделкин': 'FEAT-0010',
  'дикий атакующий': 'FEAT-0004',
  'крепкий': 'FEAT-0005',
};

/** slug → варианты русского названия для поиска заклинания */
const SPELL_SLUG_NAMES = {
  light: ['Свет'],
  thaumaturgy: ['Чудотворство'],
  fire_bolt: ['Огненный снаряд'],
  poison_spray: ['Ядовитые брызги'],
  minor_illusion: ['Малая иллюзия'],
  prestidigitation: ['Фокусы', 'Волшебство'],
  dancing_lights: ['Пляшущие огоньки'],
  faerie_fire: ['Огонь фей'],
  detect_magic: ['Обнаружение магии'],
  mending: ['Починка'],
  chill_touch: ['Леденящее прикосновение'],
  false_life: ['Ложная жизнь', 'Поддельная жизнь', 'Псевдожизнь'],
  ray_of_sickness: ['Луч болезни'],
  hold_person: ['Удержание личности', 'Паралич личности'],
  hellish_rebuke: ['Адское возмездие'],
  darkness: ['Тьма'],
  misty_step: ['Туманный шаг'],
  druidcraft: ['Друидизм', 'Искусство друидов'],
  longstrider: ['Скороход'],
  pass_without_trace: ['Бесследное передвижение'],
  ray_of_enfeeblement: ['Луч слабости'],
};

function norm(s) {
  return String(s || '').trim().toLowerCase().replace(/ё/g, 'е');
}

async function fetchAll(path, key) {
  const items = [];
  let page = 1;
  while (true) {
    const res = await fetch(`${API_URL}${path}?page=${page}&limit=100`);
    if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
    const data = await res.json();
    const batch = data[key] || [];
    items.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return items;
}

async function login() {
  await fetch(`${API_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: AUTH_USER,
      password: AUTH_PASS,
      email: `${AUTH_USER}@example.com`,
      display_name: 'Content Fixer',
    }),
  }).catch(() => {});

  const res = await fetch(`${API_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: AUTH_USER, password: AUTH_PASS }),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  if (!data.token) throw new Error('No token in login response');
  return data.token;
}

async function api(token, method, path, body, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${API_URL}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { /* */ }
      if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
      return json;
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  return null;
}

function spellUpdatePayload(spell, overrides = {}) {
  return {
    name: spell.name,
    description: spell.description || '',
    detailed_description: spell.detailed_description,
    image_url: spell.image_url || '',
    rarity: spell.rarity || 'common',
    level: spell.level,
    school: spell.school,
    casting_time: spell.casting_time,
    range: spell.range,
    component_verbal: spell.component_verbal,
    component_somatic: spell.component_somatic,
    component_material: spell.component_material,
    material_text: spell.material_text,
    duration: spell.duration,
    classes: spell.classes,
    subclasses: spell.subclasses,
    attack_roll: spell.attack_roll,
    saving_throw: spell.saving_throw,
    concentration: spell.concentration,
    ritual: spell.ritual,
    resources: spell.resources,
    save_types: spell.save_types,
    damage: spell.damage,
    area: spell.area,
    is_healing: spell.is_healing,
    heal_dice: spell.heal_dice,
    save_outcome: spell.save_outcome,
    upcast_description: spell.upcast_description,
    type: spell.type,
    author: spell.author || 'Admin',
    source: spell.source,
    tags: spell.tags,
    is_extended: spell.is_extended,
    ...overrides,
  };
}

function backgroundUpdatePayload(bg, overrides = {}) {
  return {
    name: bg.name,
    description: bg.description || '',
    image_url: bg.image_url || '',
    skill_proficiencies: bg.skill_proficiencies,
    tool_proficiency: bg.tool_proficiency,
    origin_feat: bg.origin_feat,
    equipment_options: bg.equipment_options,
    ...overrides,
  };
}

function findSpellByNames(spells, names) {
  const targets = names.map(norm);
  return spells.find((s) => targets.includes(norm(s.name)));
}

async function main() {
  console.log(`API: ${API_URL}${DRY_RUN ? ' (DRY_RUN)' : ''}`);
  const token = await login();
  console.log('Авторизация OK');

  const [feats, backgrounds, spells] = await Promise.all([
    fetchAll('/api/feats', 'feats'),
    fetchAll('/api/backgrounds', 'backgrounds'),
    fetchAll('/api/spells', 'spells'),
  ]);

  const byCard = new Map(spells.map((s) => [s.card_number, s]));
  const actions = [];

  // ─── Дубли черт: оставить с картинкой / меньший FEAT-номер ───
  const featByName = new Map();
  for (const f of feats) {
    const key = norm(f.name);
    if (!featByName.has(key)) featByName.set(key, []);
    featByName.get(key).push(f);
  }
  for (const [name, group] of featByName) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => {
      const img = (Boolean(b.image_url) - Boolean(a.image_url));
      if (img !== 0) return img;
      return (a.card_number || '').localeCompare(b.card_number || '');
    });
    const keeper = sorted[0];
    for (const dup of sorted.slice(1)) {
      if (!keeper.image_url && dup.image_url) {
        actions.push(async () => {
          console.log(`Черта «${name}»: копируем image_url ${dup.card_number} → ${keeper.card_number}`);
          if (!DRY_RUN) {
            await api(token, 'PUT', `/api/feats/${keeper.id}`, {
              name: keeper.name,
              description: keeper.description,
              image_url: dup.image_url,
              rarity: keeper.rarity,
              category: keeper.category,
              author: keeper.author || 'Admin',
            });
          }
        });
      }
      actions.push(async () => {
        console.log(`Удаляем дубль черты «${name}»: ${dup.card_number}`);
        if (!DRY_RUN) await api(token, 'DELETE', `/api/feats/${dup.id}`);
      });
    }
  }

  // ─── Предыстории: origin_feat + skill ids ───
  for (const bg of backgrounds) {
    const patch = {};
    if (bg.origin_feat && /[а-яА-ЯёЁ]/.test(bg.origin_feat)) {
      const slug = ORIGIN_FEAT_BY_NAME[norm(bg.origin_feat)];
      if (slug) patch.origin_feat = slug;
      else console.warn(`⚠ Нет маппинга origin_feat для ${bg.card_number}: «${bg.origin_feat}»`);
    }
    const skills = (bg.skill_proficiencies || []).map((s) => {
      if (typeof s !== 'string') return s;
      if (!/[а-яА-ЯёЁ]/.test(s)) return s;
      return SKILL_RU_TO_ID[norm(s)] || s;
    });
    if (JSON.stringify(skills) !== JSON.stringify(bg.skill_proficiencies || [])) {
      patch.skill_proficiencies = skills;
    }
    if (Object.keys(patch).length) {
      actions.push(async () => {
        console.log(`Предыстория ${bg.card_number}:`, patch);
        if (!DRY_RUN) await api(token, 'PUT', `/api/backgrounds/${bg.id}`, backgroundUpdatePayload(bg, patch));
      });
    }
  }

  // ─── Заклинания: slug card_number с сохранением image_url ───
  for (const [slug, names] of Object.entries(SPELL_SLUG_NAMES)) {
    if (byCard.has(slug)) continue;
    let source = findSpellByNames(spells, names);
    if (!source) {
      console.warn(`⚠ Заклинание не найдено для slug «${slug}» (${names.join(' / ')}) — создаём заглушку без картинки`);
      actions.push(async () => {
        if (DRY_RUN) return;
        const created = await api(token, 'POST', '/api/spells', {
          name: names[0],
          description: `Заглушка для slug ${slug} (A5)`,
          image_url: '',
          rarity: 'common',
          card_number: slug,
          level: ['false_life', 'hold_person', 'ray_of_sickness', 'ray_of_enfeeblement', 'hellish_rebuke', 'misty_step', 'longstrider', 'pass_without_trace', 'darkness'].includes(slug) ? 1 : 0,
          author: 'Admin',
        });
        if (created?.card_number) byCard.set(slug, created);
      });
      continue;
    }
    if (source.card_number === slug) continue;

    const existingSlug = byCard.get(slug);
    if (existingSlug && existingSlug.id !== source.id) {
      const image = source.image_url || existingSlug.image_url;
      actions.push(async () => {
        console.log(`Slug ${slug}: merge ${source.card_number} → существующий ${existingSlug.card_number}, image=${Boolean(image)}`);
        if (!DRY_RUN) {
          if (image && !existingSlug.image_url) {
            await api(token, 'PUT', `/api/spells/${existingSlug.id}`, spellUpdatePayload(existingSlug, { image_url: image }));
          }
          await api(token, 'DELETE', `/api/spells/${source.id}`);
        }
      });
      continue;
    }

    actions.push(async () => {
      console.log(`Заклинание «${source.name}»: ${source.card_number} → ${slug} (image сохранён: ${Boolean(source.image_url)})`);
      if (!DRY_RUN) {
        await api(token, 'PUT', `/api/spells/${source.id}`, spellUpdatePayload(source, { card_number: slug }));
        byCard.set(slug, { ...source, card_number: slug });
      }
    });
  }

  for (const act of actions) {
    await act();
  }

  console.log(`\nВыполнено действий: ${actions.length}`);
  console.log('Повторный аудит: node scripts/audit-content.mjs && node scripts/audit-refs.mjs');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
