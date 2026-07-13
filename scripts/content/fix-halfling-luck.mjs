/**
 * Везение полурослика (Halfling Luck, PHB 2024) — теперь реальная механика через движок правил
 * бросков: пассивное правило reroll на любой d20-тест (атака/проверка/спасбросок/инициатива),
 * перебрасывающее натуральную 1 (берётся новый результат). Раньше механика была инертной
 * (триггер на неэмитируемое событие + нарративный reroll-payload).
 *
 * Запуск: node scripts/content/fix-halfling-luck.mjs
 */
const BASE = process.env.API_URL || 'https://backend-production-41c3.up.railway.app';

const MECHANICS = {
  activation: { mode: 'passive' },
  effects: [{
    resolution: 'auto',
    result: [{ kind: 'modifier', applies_to: { roll: 'd20' }, op: 'reroll', natural: { max: 1 } }],
  }],
};

async function main() {
  const res = await fetch(`${BASE}/api/effects?effect_type=trait&limit=500`)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  // Ищем по card_number среди всех эффектов (без фильтра типа — на случай иной категории).
  const all = await fetch(`${BASE}/api/effects?limit=1000`).then((r) => r.json());
  const list = all.effects ?? all.data ?? all;
  const eff = (Array.isArray(list) ? list : []).find((e) => e.card_number === 'RE-halfling-3'
    || /везени/i.test(e.name || ''));
  void res;
  if (!eff) { console.log('НЕ найдено RE-halfling-3 (Везение)'); return; }

  const body = {
    name: eff.name,
    description: 'Когда на к20 для броска атаки, проверки характеристики или спасброска выпадает 1, вы перебрасываете кубик и обязаны использовать новый результат.',
    effect_type: eff.effect_type,
    rarity: eff.rarity || 'common',
    image_url: eff.image_url || '',
    mechanics: MECHANICS,
  };
  const put = await fetch(`${BASE}/api/effects/${eff.id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  console.log(put.ok ? `UPD Везение (${eff.card_number}) → пассивный reroll натуральной 1 на d20` : `FAIL ${put.status} ${await put.text()}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
