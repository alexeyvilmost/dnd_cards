/**
 * «Искусное владение оружием» (Weapon Mastery, PHB 2024) — классовая особенность 5 классов.
 * Раньше её не было НИ У ОДНОГО класса, поэтому искусность оружия не работала ни у кого.
 *
 * Канон (PHB 2024 RU): особенность 1-го уровня у Варвара, Воина, Паладина, Плута, Следопыта.
 * Число видов оружия растёт по таблице класса:
 *   Воин   — 3 (L1), 4 (L4), 5 (L10), 6 (L16)
 *   Прочие — 2 (L1), 3 (L4)
 * «Каждый раз, когда вы заканчиваете Долгий отдых, вы можете изменить выбранные виды оружия» —
 * поэтому выбор объявлен context:'in_play': он решается НА ЛИСТЕ (SheetChoicesPanel) и
 * перевыбирается игроком (RAW — после долгого отдыха).
 *
 * count у choice — целое (не формула), поэтому рост уровня моделируем ОТДЕЛЬНЫМИ эффектами
 * в level_progression (по +1 виду), как это уже делает прогрессия классов в проекте.
 *
 * Запуск: node scripts/content/weapon-mastery-classes.mjs
 */
const BASE = process.env.API_URL || 'https://backend-production-41c3.up.railway.app';

const RULE = 'Благодаря тренировкам вы можете пользоваться свойствами искусности выбранных вами видов оружия. Каждый раз, когда вы заканчиваете Долгий отдых, вы можете изменить выбор — на листе персонажа в блоке выборов.';

const mech = (count, prompt) => ({
  activation: { mode: 'passive' },
  effects: [{ resolution: 'auto', result: [{
    kind: 'choice',
    id: 'weapon-mastery',
    context: 'in_play', // решается и ПЕРЕВЫБИРАЕТСЯ на листе (после долгого отдыха)
    prompt,
    count,
    options: { source: 'weapon' },
    grant: { kind: 'weapon_mastery' }, // выбранный вид → {kind:'weapon_mastery', value:'<weapon_type>'}
  }] }],
});

const EFFECTS = [
  { cn: 'EFF-weapon-mastery-3', name: 'Искусное владение оружием', count: 3,
    desc: `Вы можете пользоваться свойствами искусности **трёх** видов Простого или Воинского оружия по вашему выбору. ${RULE}` },
  { cn: 'EFF-weapon-mastery-2', name: 'Искусное владение оружием', count: 2,
    desc: `Вы можете пользоваться свойствами искусности **двух** видов оружия, которым вы владеете, по вашему выбору. ${RULE}` },
  { cn: 'EFF-weapon-mastery-plus-4', name: 'Искусное владение оружием: ещё один вид', count: 1,
    desc: 'Вы можете пользоваться свойством искусности ещё одного вида оружия (рост по таблице класса на 4-м уровне).' },
  { cn: 'EFF-weapon-mastery-plus-10', name: 'Искусное владение оружием: ещё один вид', count: 1,
    desc: 'Вы можете пользоваться свойством искусности ещё одного вида оружия (рост по таблице Воина на 10-м уровне).' },
  { cn: 'EFF-weapon-mastery-plus-16', name: 'Искусное владение оружием: ещё один вид', count: 1,
    desc: 'Вы можете пользоваться свойством искусности ещё одного вида оружия (рост по таблице Воина на 16-м уровне).' },
];

/** class card_number → { уровень: [card_number эффекта] } */
const WIRING = {
  'CLASS-warrior':   { 1: ['EFF-weapon-mastery-3'], 4: ['EFF-weapon-mastery-plus-4'], 10: ['EFF-weapon-mastery-plus-10'], 16: ['EFF-weapon-mastery-plus-16'] },
  'CLASS-barbarian': { 1: ['EFF-weapon-mastery-2'], 4: ['EFF-weapon-mastery-plus-4'] },
  'CLASS-paladin':   { 1: ['EFF-weapon-mastery-2'], 4: ['EFF-weapon-mastery-plus-4'] },
  'CLASS-rogue':     { 1: ['EFF-weapon-mastery-2'], 4: ['EFF-weapon-mastery-plus-4'] },
  'CLASS-ranger':    { 1: ['EFF-weapon-mastery-2'], 4: ['EFF-weapon-mastery-plus-4'] },
};

async function upsertEffects() {
  const list = (await (await fetch(`${BASE}/api/effects?limit=2000`)).json()).effects || [];
  const ids = {};
  for (const e of EFFECTS) {
    const ex = list.find((x) => x.card_number === e.cn);
    const body = {
      name: e.name, card_number: e.cn, effect_type: 'class_ability', rarity: 'common',
      image_url: ex?.image_url || '', description: e.desc,
      mechanics: mech(e.count, `Искусность: выберите ${e.count === 1 ? 'ещё один вид оружия' : `${e.count} вида оружия`}`),
    };
    const res = await fetch(ex ? `${BASE}/api/effects/${ex.id}` : `${BASE}/api/effects`, {
      method: ex ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok) { console.log(`FAIL ${e.cn}: ${res.status} ${await res.text()}`); continue; }
    const saved = await res.json();
    ids[e.cn] = saved.id || ex.id;
    console.log(`${ex ? 'UPD' : 'NEW'} ${e.cn} «${e.name}» count=${e.count} -> ${ids[e.cn]}`);
  }
  return ids;
}

async function wireClasses(ids) {
  const classes = (await (await fetch(`${BASE}/api/classes?limit=100`)).json()).classes || [];
  for (const [cn, byLevel] of Object.entries(WIRING)) {
    const cls = classes.find((c) => c.card_number === cn);
    if (!cls) { console.log(`SKIP класс ${cn}: не найден`); continue; }
    const lp = { ...(cls.level_progression || {}) };
    const added = [];
    for (const [lvl, effCns] of Object.entries(byLevel)) {
      const cur = lp[lvl] || { actions: [], effects: [] };
      const effIds = effCns.map((c) => ids[c]).filter(Boolean);
      const next = [...new Set([...(cur.effects || []), ...effIds])];
      lp[lvl] = { ...cur, actions: cur.actions || [], effects: next };
      added.push(`L${lvl}`);
    }
    const res = await fetch(`${BASE}/api/classes/${cls.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...cls, level_progression: lp }),
    });
    console.log(res.ok ? `WIRE ${cls.name}: ${added.join(', ')}` : `FAIL wire ${cls.name}: ${res.status} ${(await res.text()).slice(0, 150)}`);
  }
}

async function main() {
  const ids = await upsertEffects();
  await wireClasses(ids);
  console.log('DONE');
}
main().catch((e) => { console.error(e); process.exit(1); });
