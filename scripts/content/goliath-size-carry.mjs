/**
 * Голиаф: Большая форма (изменение размера на время) + Мощное телосложение (грузоподъёмность +1 размер).
 *  - Мощное телосложение (эффект): modifier applies_to roll:'carry' +1 → грузоподъёмность считается на
 *    категорию больше (Средний→Большой = ×2). Парадигма №3 (формула груза с размером+1).
 *  - Большая форма (существующий АКТИВНЫЙ эффект вида RE-goliath-2, бонусное действие, 1 раз/короткий
 *    отдых): дополняем механику — modifier applies_to roll:'size' +1 и speed +10 на 10 раундов (1 минута).
 *    Истекает по ходам; короткий отдых = 600 раундов тоже снимает. НЕ создаём отдельное действие —
 *    иначе на листе задвоилась бы «Большая форма» (эффект-вид + действие). Механика живёт в самом
 *    эффекте вида; лист показывает активируемый эффект как действие (SheetActionsPanel).
 *
 * Запуск: node scripts/content/goliath-size-carry.mjs
 */
const BASE = process.env.API_URL || 'https://backend-production-41c3.up.railway.app';
const LARGE_FORM_EFFECT = '88fdd229-09ae-4391-be3b-c40ee3a07fec'; // RE-goliath-2 «Большая форма»
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

async function updateLargeForm() {
  const es = (await fetch(`${BASE}/api/effects?limit=1000`).then(j)).effects;
  const e = es.find((x) => x.id === LARGE_FORM_EFFECT);
  if (!e) { console.log('SKIP Большая форма: RE-goliath-2 не найден'); return; }
  const mech = {
    activation: { mode: 'active', cost: [{ resource: 'bonus_action' }], requirements: [{ type: 'level', min_level: 5 }] },
    uses: { count: 1, per: 'short_rest' },
    effects: [{ resolution: 'auto', result: [
      { kind: 'modifier', applies_to: { roll: 'size' }, op: 'add', value: 1, duration: { type: 'rounds', amount: 10 } },
      { kind: 'modifier', applies_to: { roll: 'speed' }, op: 'add', value: 10, duration: { type: 'rounds', amount: 10 } },
      { kind: 'narrative', description: 'Большая форма: вы становитесь Большим на 1 минуту (10 раундов), если есть место. Преимущество на проверки Силы; скорость +10 футов.' },
    ] }],
  };
  const body = { name: e.name, effect_type: e.effect_type, rarity: e.rarity || 'common', image_url: e.image_url || '', description: e.description, mechanics: mech };
  const res = await fetch(`${BASE}/api/effects/${e.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  console.log(res.ok ? 'UPD Большая форма (RE-goliath-2) → size +1 / speed +10, 10 раундов, 1/короткий отдых' : `FAIL: ${res.status} ${await res.text()}`);
}

async function main() {
  await updatePowerfulBuild();
  await updateLargeForm();
  console.log('DONE');
}
main().catch((e) => { console.error(e); process.exit(1); });
