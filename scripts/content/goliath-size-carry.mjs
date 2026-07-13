/**
 * Голиаф: Большая форма (изменение размера на время) + Мощное телосложение (грузоподъёмность +1 размер).
 *  - Мощное телосложение (эффект): modifier applies_to roll:'carry' +1 → грузоподъёмность считается на
 *    категорию больше (Средний→Большой = ×2). Парадигма №3 (формула груза с размером+1).
 *  - Большая форма (ДЕЙСТВИЕ, бонусное, с 5 уровня, 1 раз/короткий отдых): modifier applies_to roll:'size'
 *    +1 и speed +10 на 10 раундов (1 минута). Истекает по ходам; короткий отдых = 600 раундов тоже снимает.
 *
 * Запуск: node scripts/content/goliath-size-carry.mjs
 */
const BASE = process.env.API_URL || 'https://backend-production-41c3.up.railway.app';
const GOLIATH = '832cebd9-121a-4457-b9fd-92adaee40720';
const j = (r) => r.json();

async function updatePowerfulBuild() {
  const es = (await fetch(`${BASE}/api/effects?limit=1000`).then(j)).effects;
  const e = es.find((x) => x.name === 'Мощное телосложение');
  if (!e) { console.log('SKIP Мощное телосложение: не найдено'); return; }
  const mech = {
    activation: { mode: 'passive' },
    effects: [{ resolution: 'auto', result: [
      { kind: 'modifier', applies_to: { roll: 'carry' }, op: 'add', value: 1 },
      { kind: 'narrative', description: 'Мощное телосложение: считается, что ваш размер на одну категорию больше для переноски, толкания и грузоподъёмности; преимущество на спасброски против Схвата.' },
    ] }],
  };
  const body = { name: e.name, effect_type: e.effect_type, rarity: e.rarity || 'common', image_url: e.image_url || '', description: e.description, mechanics: mech };
  const res = await fetch(`${BASE}/api/effects/${e.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  console.log(res.ok ? 'UPD Мощное телосложение → carry +1 размер' : `FAIL: ${res.status} ${await res.text()}`);
}

async function upsertLargeForm() {
  const list = (await fetch(`${BASE}/api/actions?limit=1000`).then(j)).actions || [];
  const ex = list.find((a) => a.card_number === 'ACT-goliath-large-form');
  const mech = {
    activation: { mode: 'active', cost: [{ resource: 'bonus_action' }], requirements: [{ type: 'level', min_level: 5 }] },
    uses: { count: 1, per: 'short_rest' },
    effects: [{ resolution: 'auto', result: [
      { kind: 'modifier', applies_to: { roll: 'size' }, op: 'add', value: 1, duration: { type: 'rounds', amount: 10 } },
      { kind: 'modifier', applies_to: { roll: 'speed' }, op: 'add', value: 10, duration: { type: 'rounds', amount: 10 } },
      { kind: 'narrative', description: 'Большая форма: вы становитесь на одну категорию больше (Большой) на 1 минуту (10 раундов), если есть место. Преимущество на проверки Силы; скорость +10 футов.' },
    ] }],
  };
  const body = {
    name: 'Большая форма', card_number: 'ACT-goliath-large-form', rarity: 'common', action_type: 'class_feature',
    description: 'С 5 уровня бонусным действием вы магически становитесь Большим на 1 минуту (если есть место): преимущество на проверки Силы, скорость +10 футов. Один раз, восстанавливается после короткого или долгого отдыха.',
    resources: ['bonus_action'], image_url: ex?.image_url || '', mechanics: mech,
  };
  const url = ex ? `${BASE}/api/actions/${ex.id}` : `${BASE}/api/actions`;
  const res = await fetch(url, { method: ex ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) { console.log(`FAIL Large Form action: ${res.status} ${await res.text()}`); return null; }
  const saved = await res.json();
  console.log(`${ex ? 'UPD' : 'NEW'} action ACT-goliath-large-form → ${saved.id}`);
  return saved.id;
}

async function main() {
  await updatePowerfulBuild();
  const actId = await upsertLargeForm();
  if (actId) {
    const race = await (await fetch(`${BASE}/api/races/${GOLIATH}`)).json();
    const lp = { ...(race.level_progression || {}) };
    lp['5'] = { ...(lp['5'] || {}), actions: [...new Set([...((lp['5'] || {}).actions || []), actId])] };
    const body = { ...race, level_progression: lp };
    const res = await fetch(`${BASE}/api/races/${GOLIATH}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    console.log(res.ok ? 'WIRE Большая форма → Голиаф level_progression[5]' : `FAIL wire: ${res.status} ${await res.text()}`);
  }
  console.log('DONE');
}
main().catch((e) => { console.error(e); process.exit(1); });
