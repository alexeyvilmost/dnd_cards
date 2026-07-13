/**
 * Обновление механик состояний под PHB 2024 (представимая движком часть).
 * Добавляет к существующим condition-эффектам:
 *   - Скорость 0 (op:'set') — Схвачен / Опутан / Парализован / Без сознания;
 *   - помеха на Инициативу — Недееспособный;
 *   - преимущество на Инициативу — Невидимый.
 * Идемпотентно: пропускает payload, если он уже есть. Существующие payload-ы не трогает.
 *
 * Запуск: node scripts/content/update-conditions-2024.mjs
 */
const BASE = process.env.API_URL || 'https://backend-production-41c3.up.railway.app';

const SPEED0 = { kind: 'modifier', applies_to: { roll: 'speed' }, op: 'set', value: '0' };
const INIT = (op) => ({ kind: 'modifier', applies_to: { roll: 'initiative' }, op });

/** Какие payload-ы добавить к какому состоянию (card_number → список). */
const ADD = {
  'COND-grappled': [SPEED0],
  'COND-restrained': [SPEED0],
  'COND-paralyzed': [SPEED0],
  'COND-unconscious': [SPEED0],
  'COND-incapacitated': [INIT('disadvantage')],
  'COND-invisible': [INIT('advantage')],
};

/** Есть ли уже такой модификатор (по roll+op+scope) в списке. */
const hasMod = (list, p) => list.some((x) =>
  x?.kind === 'modifier' &&
  x?.applies_to?.roll === p.applies_to.roll &&
  x?.op === p.op &&
  String(x?.scope ?? 'self') === String(p.scope ?? 'self'));

async function main() {
  const res = await fetch(`${BASE}/api/effects?effect_type=condition&limit=200`);
  if (!res.ok) throw new Error(`GET effects: ${res.status}`);
  const { effects } = await res.json();
  const byNum = new Map(effects.map((e) => [e.card_number, e]));

  for (const [cardNumber, additions] of Object.entries(ADD)) {
    const e = byNum.get(cardNumber);
    if (!e) { console.log(`SKIP ${cardNumber}: не найдено`); continue; }

    const mech = e.mechanics && typeof e.mechanics === 'object'
      ? JSON.parse(JSON.stringify(e.mechanics))
      : { effects: [{ resolution: 'auto', result: [] }] };
    if (!Array.isArray(mech.effects) || mech.effects.length === 0) {
      mech.effects = [{ resolution: 'auto', result: [] }];
    }
    const eff0 = mech.effects[0];
    if (!Array.isArray(eff0.result)) eff0.result = [];

    let added = 0;
    for (const p of additions) {
      if (!hasMod(eff0.result, p)) { eff0.result.push(p); added += 1; }
    }
    if (added === 0) { console.log(`OK   ${cardNumber} (${e.name}): уже актуально`); continue; }

    const body = {
      name: e.name,
      description: e.description ?? '',
      effect_type: e.effect_type,
      rarity: e.rarity || 'common',
      image_url: e.image_url || '',
      mechanics: mech,
    };
    const put = await fetch(`${BASE}/api/effects/${e.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!put.ok) { console.log(`FAIL ${cardNumber}: PUT ${put.status} ${await put.text()}`); continue; }
    console.log(`UPD  ${cardNumber} (${e.name}): +${added} payload → ${JSON.stringify(eff0.result)}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
