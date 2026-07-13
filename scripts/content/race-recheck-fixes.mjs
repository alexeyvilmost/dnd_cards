/**
 * Правки по итогам переперепроверки покрытия видов механикой (2026-07-14).
 *
 *  1. Орк «Адреналиновый рывок» (RE-orc-2): grant_action ссылался на несуществующий слаг 'dash'
 *     (через options, а не value) → грант не работал. Делаем Рывок НЕ нарративным — тем же примитивом,
 *     что базовый «Рывок»/«Проворный рывок»: modifier speed +character_speed до начала следующего хода
 *     (удвоение перемещения). Плюс temp_hp = БМ. Бонусное действие, БМ использований, перезарядка и
 *     коротким, и долгим отдыхом (per:'short_rest' → короткий восстанавливает пул, долгий — все ресурсы).
 *  2. Табакси «Кошачьи когти» (tabaxi_unarmed_strike): 1d4 рубящий, БЕЗ лимита использований
 *     (когти всегда доступны). Тип рубящий (когти), кость 1d4.
 *
 * Запуск: node scripts/content/race-recheck-fixes.mjs
 */
const BASE = process.env.API_URL || 'https://backend-production-41c3.up.railway.app';
const j = (r) => r.json();

async function fixOrcAdrenaline() {
  const es = (await fetch(`${BASE}/api/effects?limit=2000`).then(j)).effects;
  const e = es.find((x) => x.card_number === 'RE-orc-2' || x.name === 'Адреналиновый рывок');
  if (!e) { console.log('SKIP Адреналиновый рывок: не найден'); return; }
  const mech = {
    activation: { mode: 'active', cost: [{ resource: 'bonus_action' }] },
    uses: { count: 'prof_bonus', per: 'short_rest' },
    effects: [{ resolution: 'auto', result: [
      { kind: 'temp_hp', amount: 'prof_bonus' },
      { kind: 'modifier', applies_to: { roll: 'speed' }, op: 'add', value: 'character_speed', duration: { type: 'until_start_of_next_turn' } },
      { kind: 'narrative', description: 'Бонусным действием вы совершаете Рывок (скорость увеличена на её текущее значение до начала вашего следующего хода) и получаете временные хиты, равные бонусу мастерства.' },
    ] }],
  };
  const body = { name: e.name, effect_type: e.effect_type, rarity: e.rarity || 'common', image_url: e.image_url || '', description: e.description, mechanics: mech };
  const res = await fetch(`${BASE}/api/effects/${e.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  console.log(res.ok ? 'UPD Адреналиновый рывок → speed +character_speed (Рывок) + temp_hp=БМ, БМ/короткий+долгий' : `FAIL: ${res.status} ${await res.text()}`);
}

async function fixTabaxiClaws() {
  const acts = (await fetch(`${BASE}/api/actions?limit=2000`).then(j)).actions;
  const a = acts.find((x) => x.card_number === 'tabaxi_unarmed_strike' || x.name === 'Кошачьи когти');
  if (!a) { console.log('SKIP Кошачьи когти: не найдено'); return; }
  const mech = {
    activation: { mode: 'active', cost: [{ resource: 'action' }] },
    targeting: { filter: 'enemy', range: '5 feet', shape: 'single' },
    effects: [{
      resolution: 'attack_roll', vs: 'ac', ability: 'str', attack_kind: 'unarmed',
      on_hit: [{ kind: 'damage', amount: '1d4 + str', type: 'slashing' }],
    }],
  };
  const body = {
    name: a.name, card_number: a.card_number, rarity: a.rarity || 'common',
    action_type: a.action_type || 'racial', description: a.description || '',
    resources: ['action'], image_url: a.image_url || '', mechanics: mech,
  };
  const res = await fetch(`${BASE}/api/actions/${a.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  console.log(res.ok ? 'UPD Кошачьи когти → 1d4 рубящий, без лимита использований' : `FAIL: ${res.status} ${await res.text()}`);
}

async function main() {
  await fixOrcAdrenaline();
  await fixTabaxiClaws();
  console.log('DONE');
}
main().catch((e) => { console.error(e); process.exit(1); });
