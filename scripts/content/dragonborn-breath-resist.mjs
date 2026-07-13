/**
 * Драконорождённый: 5 действий дыхания + 5 эффектов сопротивления по ТИПУ урона (подвиды
 * различаются только типом). Каждый подвид (10 шт) получает через встроенный механизм:
 *   related_effects = [сопротивление своего типа], related_actions = [дыхание своего типа].
 * Раньше все 10 указывали на ОДНО огненное дыхание (баг: холодные/кислотные дышали огнём).
 *
 * Запуск: node scripts/content/dragonborn-breath-resist.mjs
 */
const BASE = process.env.API_URL || 'https://backend-production-41c3.up.railway.app';
const j = (r) => r.json();

const TYPE_RU = { acid: 'кислота', cold: 'холод', fire: 'огонь', lightning: 'молния', poison: 'яд' };
// подвид → тип урона (PHB 2024)
const SUBRACE_TYPE = {
  'Чёрный': 'acid', 'Медный': 'acid',
  'Серебряный': 'cold', 'Белый': 'cold',
  'Латунный': 'fire', 'Золотой': 'fire', 'Красный': 'fire',
  'Синий': 'lightning', 'Бронзовый': 'lightning',
  'Зелёный': 'poison',
};

const breathMech = (type) => ({
  activation: { mode: 'active', cost: [{ resource: 'action' }] },
  effects: [{
    resolution: 'save', ability: 'dex', dc: '8+prof+con', who: 'target',
    on_fail: [{ kind: 'damage', dice: '1d10', type, scaling: { dice: '1d10', per: 'self_level_tier' } }],
    on_success: [{ kind: 'damage', dice: '1d10', type, scaling: { dice: '1d10', per: 'self_level_tier' }, on_success: 'half' }],
  }],
  targeting: { shape: 'area', area: { kind: 'cone', size: 15 }, filter: 'any' },
  uses: { count: 'prof_bonus', per: 'long_rest' },
});
const resistMech = (type) => ({
  activation: { mode: 'passive' },
  effects: [{ resolution: 'auto', result: [{ kind: 'resistance', damage_type: type, value: 'resistance' }] }],
});

async function upsertAction(type) {
  const card = `ACT-breath-${type}`;
  const list = (await fetch(`${BASE}/api/actions?limit=1000`).then(j)).actions || [];
  const ex = list.find((a) => a.card_number === card);
  const body = {
    name: `Оружие дыхания (${TYPE_RU[type]})`, card_number: card, rarity: 'common', action_type: 'class_feature',
    description: `Действием выдохните разрушительную энергию в конусе 15 футов. Все в области делают спасбросок Ловкости (СЛ 8 + мастерство + Телосложение), получая ${'{кости}'} урона типа «${TYPE_RU[type]}» при провале и половину при успехе. Профбонус раз/долгий отдых.`,
    resources: ['action'], distance: 'конус 15 фт', image_url: ex?.image_url || '', mechanics: breathMech(type),
  };
  const url = ex ? `${BASE}/api/actions/${ex.id}` : `${BASE}/api/actions`;
  const res = await fetch(url, { method: ex ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) { console.log(`FAIL action ${card}: ${res.status} ${await res.text()}`); return null; }
  const saved = await res.json();
  console.log(`${ex ? 'UPD' : 'NEW'} action ${card} → ${saved.id}`);
  return saved.id;
}

async function upsertEffect(type) {
  const card = `RE-dragon-resist-${type}`;
  const list = (await fetch(`${BASE}/api/effects?limit=1000`).then(j)).effects || [];
  const ex = list.find((e) => e.card_number === card);
  const body = {
    name: `Драконье сопротивление (${TYPE_RU[type]})`, card_number: card, effect_type: 'positive_effect', rarity: 'common',
    image_url: ex?.image_url || '', description: `Драконье наследие: сопротивление урону типа «${TYPE_RU[type]}».`,
    mechanics: resistMech(type),
  };
  const url = ex ? `${BASE}/api/effects/${ex.id}` : `${BASE}/api/effects`;
  const res = await fetch(url, { method: ex ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) { console.log(`FAIL effect ${card}: ${res.status} ${await res.text()}`); return null; }
  const saved = await res.json();
  console.log(`${ex ? 'UPD' : 'NEW'} effect ${card} → ${saved.id}`);
  return saved.id;
}

async function main() {
  const actionId = {}, effectId = {};
  for (const type of Object.keys(TYPE_RU)) {
    actionId[type] = await upsertAction(type);
    effectId[type] = await upsertEffect(type);
  }
  // Найти подвиды Драконорождённого и перепривязать
  const races = (await fetch(`${BASE}/api/races?limit=300`).then(j)).races;
  const parent = races.find((r) => r.name === 'Драконорождённый' && !r.is_subrace);
  const subs = races.filter((r) => r.parent_race_id === parent.id);
  for (const s of subs) {
    const type = SUBRACE_TYPE[s.name];
    if (!type) { console.log(`SKIP subrace ${s.name}: нет типа`); continue; }
    const body = { ...s, related_effects: [effectId[type]], related_actions: [actionId[type]] };
    const res = await fetch(`${BASE}/api/races/${s.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    console.log(res.ok ? `WIRE ${s.name} → ${type}` : `FAIL wire ${s.name}: ${res.status} ${await res.text()}`);
  }
  console.log('DONE');
}
main().catch((e) => { console.error(e); process.exit(1); });
