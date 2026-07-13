/**
 * Состояния PHB 2024 — доработки движка A/B/C/D/F в данных прод-эффектов.
 * Ставит ПОЛНУЮ механику 5 изменившихся состояний (идемпотентно, перезапись):
 *   incapacitated — запрет действий/бонусных/реакций/концентрации (D) + помеха инициативы;
 *   paralyzed/unconscious — автопровал СИЛ/ЛВК (A), автокрит рукопашной (B), Скорость 0, вкл. Недееспособен (F);
 *   stunned — автопровал СИЛ/ЛВК (A), вкл. Недееспособен (F);
 *   prone — проекция по дальности (C): рукопашные преим., дальнобойные помеха.
 * Прочие состояния (grappled/restrained/invisible/…) уже актуальны (см. update-conditions-2024.mjs).
 *
 * Запуск: node scripts/content/update-conditions-2024-part2.mjs
 */
const BASE = process.env.API_URL || 'https://backend-production-41c3.up.railway.app';

const M = (applies_to, op, extra = {}) => ({ kind: 'modifier', applies_to, op, ...extra });
const ATTACK_DIS = M({ roll: 'attack' }, 'disadvantage');
const ADV_AGAINST = M({ roll: 'attack' }, 'advantage', { scope: 'target' });
const SPEED0 = M({ roll: 'speed' }, 'set', { value: '0' });
const INIT_DIS = M({ roll: 'initiative' }, 'disadvantage');
const AUTOFAIL = (ability) => M({ roll: 'saving_throw', filter: { ability } }, 'auto_fail');
const AUTOCRIT_MELEE = M({ roll: 'attack' }, 'auto_crit', { scope: 'target', range: 'melee' });
const DENY = (cap) => M({ roll: cap }, 'deny');
const ADV_AGAINST_MELEE = M({ roll: 'attack' }, 'advantage', { scope: 'target', range: 'melee' });
const DIS_AGAINST_RANGED = M({ roll: 'attack' }, 'disadvantage', { scope: 'target', range: 'ranged' });

const mech = (result, includes, leaves) => ({
  effects: [{ resolution: 'auto', result }],
  ...(includes ? { includes } : {}),
  ...(leaves ? { leaves } : {}),
});

/** Полная целевая механика по card_number. */
const TARGET = {
  'COND-incapacitated': mech([INIT_DIS, DENY('action'), DENY('bonus_action'), DENY('reaction'), DENY('concentration')]),
  'COND-paralyzed': mech([ADV_AGAINST, SPEED0, AUTOFAIL('str'), AUTOFAIL('dex'), AUTOCRIT_MELEE], ['incapacitated']),
  'COND-stunned': mech([ADV_AGAINST, AUTOFAIL('str'), AUTOFAIL('dex')], ['incapacitated']),
  // Без сознания = Опрокинут + Парализован (→ Недееспособен); при снятии остаётся Опрокинутым.
  'COND-unconscious': mech([], ['prone', 'paralyzed'], ['prone']),
  'COND-prone': mech([ATTACK_DIS, ADV_AGAINST_MELEE, DIS_AGAINST_RANGED]),
};

async function main() {
  const res = await fetch(`${BASE}/api/effects?effect_type=condition&limit=200`);
  if (!res.ok) throw new Error(`GET effects: ${res.status}`);
  const { effects } = await res.json();
  const byNum = new Map(effects.map((e) => [e.card_number, e]));

  for (const [cardNumber, mechanics] of Object.entries(TARGET)) {
    const e = byNum.get(cardNumber);
    if (!e) { console.log(`SKIP ${cardNumber}: не найдено`); continue; }
    if (JSON.stringify(e.mechanics) === JSON.stringify(mechanics)) { console.log(`OK   ${cardNumber} (${e.name}): уже актуально`); continue; }
    const body = {
      name: e.name, description: e.description ?? '', effect_type: e.effect_type,
      rarity: e.rarity || 'common', image_url: e.image_url || '', mechanics,
    };
    const put = await fetch(`${BASE}/api/effects/${e.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!put.ok) { console.log(`FAIL ${cardNumber}: PUT ${put.status} ${await put.text()}`); continue; }
    console.log(`UPD  ${cardNumber} (${e.name})`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
