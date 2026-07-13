/**
 * Перевод способностей на модель interrupt-триггеров (фаза A / реакции):
 *  - Божественная кара (spell): triggered при попадании (event:'hit'), бонусное действие + ячейка,
 *    урон 2к8 излучением по ЦЕЛИ (who:'target') с апкастом (+1к8/круг).
 *  - Щит (spell): reaction при попадании по вам (event:'hit_by_attack'), +5 КЗ до начала след. хода.
 *  - Наследие великанов (RE-goliath-1): triggered+optional+free при попадании — +1к10 огнём по цели,
 *    раз в ход (демо особенности Голиафа «свободное действие при попадании»).
 *
 * Запуск: node scripts/content/convert-interrupt-triggers.mjs
 */
const BASE = process.env.API_URL || 'https://backend-production-41c3.up.railway.app';

const SMITE = {
  activation: { mode: 'triggered', trigger: { event: 'hit' }, cost: [{ resource: 'bonus_action' }, { amount: 1, level: 1, resource: 'spell_slot' }] },
  effects: [{ resolution: 'auto', who: 'target', result: [
    { dice: '2d8', kind: 'damage', scaling: { dice: '1d8', per: 'spell_slot_above' }, type: 'radiant' },
    { kind: 'narrative', description: 'Если цель — Исчадие или Нежить, урон увеличивается на 1к8 (добавьте вручную).' },
  ] }],
};
const SHIELD = {
  activation: { mode: 'reaction', trigger: { event: 'hit_by_attack' }, cost: [{ resource: 'reaction' }, { amount: 1, level: 1, resource: 'spell_slot' }] },
  effects: [{ resolution: 'auto', result: [
    { applies_to: { roll: 'ac' }, duration: { type: 'until_start_of_next_turn' }, kind: 'modifier', op: 'add', value: '+5' },
    { kind: 'narrative', description: 'Действует до начала вашего следующего хода, в т.ч. против вызвавшей атаки; иммунитет к Волшебной стреле.' },
  ] }],
};
const GIANT = {
  activation: { mode: 'triggered', optional: true, trigger: { event: 'hit' } },
  uses: { per: 'turn' },
  effects: [{ resolution: 'auto', who: 'target', result: [
    { kind: 'damage', dice: '1d10', type: 'fire' },
  ] }],
};

async function putSpell(name, mechanics) {
  const { spells } = await fetch(`${BASE}/api/spells?limit=1000`).then((r) => r.json());
  const s = spells.find((x) => x.name === name);
  if (!s) { console.log(`SKIP spell ${name}: не найдено`); return; }
  const body = { ...s, mechanics };
  const put = await fetch(`${BASE}/api/spells/${s.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  console.log(put.ok ? `UPD spell ${name} → ${mechanics.activation.mode}/${mechanics.activation.trigger.event}` : `FAIL ${name}: ${put.status} ${await put.text()}`);
}

async function putEffect(cardNumber, patch) {
  const { effects } = await fetch(`${BASE}/api/effects?limit=1000`).then((r) => r.json());
  const e = effects.find((x) => x.card_number === cardNumber);
  if (!e) { console.log(`SKIP effect ${cardNumber}: не найдено`); return; }
  const body = { name: e.name, description: patch.description ?? e.description, effect_type: e.effect_type, rarity: e.rarity || 'common', image_url: e.image_url || '', mechanics: patch.mechanics };
  const put = await fetch(`${BASE}/api/effects/${e.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  console.log(put.ok ? `UPD effect ${cardNumber} (${e.name}) → triggered+optional при попадании` : `FAIL ${cardNumber}: ${put.status} ${await put.text()}`);
}

async function main() {
  await putSpell('Божественная кара', SMITE);
  await putSpell('Щит', SHIELD);
  await putEffect('RE-goliath-1', {
    mechanics: GIANT,
    description: 'Пламя великана: когда вы попадаете по существу атакой, можете нанести ему дополнительно 1к10 урона огнём (раз в ход).',
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
