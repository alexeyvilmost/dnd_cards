/**
 * Правки Каменного и Морозного великанов (по обратной связи):
 *  - МОРОЗНЫЙ (ACT-goliath-frost): добавляем ЭФФЕКТ снижения скорости цели на 10 футов до начала
 *    следующего хода — modifier applies_to speed, op add -10, duration until_start_of_next_turn,
 *    who:target (зеркало «Рывка», который повышает скорость до конца хода). Раньше был нарратив.
 *  - КАМЕННЫЙ: исцеление противоречит правилам (исцелялись на 15 при 1 уроне). Теперь это РЕАКЦИЯ
 *    на damage_taken с payload reduce_damage (1к12+ТЕЛ, но не больше нанесённого урона), стоимость —
 *    заряд Наследия великанов. Механику кладём на эффект подвида (86817ebd), действие ACT-goliath-stone
 *    удаляем, related_actions Каменного очищаем.
 *
 * Запуск: node scripts/content/fix-goliath-stone-frost.mjs
 */
const BASE = process.env.API_URL || 'https://backend-production-41c3.up.railway.app';
const STONE_SUBRACE = '7a28d849-a2ea-4bf9-9b34-3824bb50211b';
const STONE_EFFECT = '86817ebd-10e0-4f47-84e7-197cc973938d'; // related_effect Каменного подвида
const j = (r) => r.json();

// ── Морозный: действие + эффект замедления цели ──
const FROST_MECH = {
  activation: { mode: 'active', cost: [{ resource: 'giant_legacy' }] },
  effects: [{ resolution: 'auto', who: 'target', result: [
    { kind: 'damage', dice: '1d6', type: 'cold', ability: 'none' },
    { kind: 'modifier', applies_to: { roll: 'speed' }, op: 'add', value: '-10', duration: { type: 'until_start_of_next_turn' } },
    { kind: 'narrative', description: 'Скорость цели снижена на 10 футов до начала вашего следующего хода.' },
  ] }],
};

// ── Каменный: реакция на получение урона, снижение урона (не исцеление) ──
const STONE_MECH = {
  activation: { mode: 'reaction', trigger: { event: 'damage_taken' }, cost: [{ resource: 'giant_legacy' }] },
  effects: [{ resolution: 'auto', result: [
    { kind: 'reduce_damage', amount: '1d12+con' },
    { kind: 'narrative', description: 'Снижает полученный урон на 1к12 + модификатор Телосложения (но не больше нанесённого).' },
  ] }],
};

async function updateFrostAction() {
  const actions = (await fetch(`${BASE}/api/actions?limit=1000`).then(j)).actions || [];
  const a = actions.find((x) => x.card_number === 'ACT-goliath-frost');
  if (!a) { console.log('SKIP frost: не найдено'); return; }
  const body = {
    name: a.name,
    description: 'Наследие великанов (Ледяной). Когда вы попадаете по существу броском атаки, потратьте заряд Наследия великанов: цель получает дополнительно 1к6 урона холодом, а её скорость снижается на 10 футов до начала вашего следующего хода.',
    rarity: a.rarity || 'common', action_type: a.action_type || 'class_feature', card_number: a.card_number,
    distance: a.distance ?? null, image_url: a.image_url || '', resources: a.resources || ['giant_legacy'],
    mechanics: FROST_MECH,
  };
  const r = await fetch(`${BASE}/api/actions/${a.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  console.log(r.ok ? 'UPD frost → + modifier speed -10 (until_start_of_next_turn) на цель' : `FAIL frost: ${r.status} ${await r.text()}`);
}

async function makeStoneReaction() {
  const e = await fetch(`${BASE}/api/effects/${STONE_EFFECT}`).then(j);
  const body = {
    name: 'Каменная стойкость', effect_type: e.effect_type, rarity: e.rarity || 'common', image_url: e.image_url || '',
    description: 'Наследие великанов (Каменный). Реакцией, когда вы получаете урон, потратьте заряд Наследия великанов, чтобы снизить этот урон на 1к12 + модификатор Телосложения.',
    mechanics: STONE_MECH,
  };
  const r = await fetch(`${BASE}/api/effects/${STONE_EFFECT}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  console.log(r.ok ? 'UPD stone effect → reaction damage_taken + reduce_damage (1к12+ТЕЛ), cost giant_legacy' : `FAIL stone effect: ${r.status} ${await r.text()}`);
}

async function clearStoneSubraceAction() {
  const rc = await fetch(`${BASE}/api/races/${STONE_SUBRACE}`).then(j);
  const body = { ...rc, related_actions: [] };
  const r = await fetch(`${BASE}/api/races/${STONE_SUBRACE}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  console.log(r.ok ? 'UPD Каменный subrace → related_actions=[] (способность теперь реакция-эффект)' : `FAIL subrace: ${r.status} ${await r.text()}`);
}

async function deleteStoneAction() {
  const actions = (await fetch(`${BASE}/api/actions?limit=1000`).then(j)).actions || [];
  const a = actions.find((x) => x.card_number === 'ACT-goliath-stone');
  if (!a) { console.log('SKIP delete stone action: уже нет'); return; }
  const r = await fetch(`${BASE}/api/actions/${a.id}`, { method: 'DELETE' });
  console.log(r.ok ? `DEL action ACT-goliath-stone (${a.id})` : `FAIL delete: ${r.status} ${await r.text()}`);
}

async function main() {
  await updateFrostAction();
  await makeStoneReaction();
  await clearStoneSubraceAction();
  await deleteStoneAction();
  console.log('DONE');
}
main().catch((e) => { console.error(e); process.exit(1); });
