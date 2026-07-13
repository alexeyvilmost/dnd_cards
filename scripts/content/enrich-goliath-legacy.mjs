/**
 * Наследие великанов (Голиаф) — прозрачная модель «ресурс + действия по подвидам».
 *
 * 1) Ресурс `giant_legacy` («Наследие великанов»): грант в РОДИТЕЛЬСКОМ эффекте RE-goliath-1
 *    (эффект вида, есть у всех Голиафов): amount='prof_bonus'. Восстанавливается длинным
 *    отдыхом (longRest сбрасывает всё), НЕ коротким (нет в recharge-карте short_rest).
 * 2) Шесть ДЕЙСТВИЙ (по подвиду-наследию), каждое тратит 1 заряд giant_legacy. Прозрачно
 *    для игрока: видит пул «Наследие великанов N/N» и тратит его действием.
 * 3) Каждый подвид-субрас (Огненный/Облачный/Ледяной/Холмовой/Каменный/Штормовой) получает
 *    СВОЁ действие через related_actions — выбор подвида даёт ровно одну способность (RAW:
 *    один тип наследия, prof_bonus раз/долгий отдых).
 *
 * Запуск: node scripts/content/enrich-goliath-legacy.mjs
 */
const BASE = process.env.API_URL || 'https://backend-production-41c3.up.railway.app';

const PARENT_EFFECT = 'RE-goliath-1'; // родительский эффект вида «Наследие великанов»
// подвид-субрас → card_number действия
const SUBRACES = {
  '06dece5f-241f-4469-b578-9cafb3336ad6': 'ACT-goliath-fire',   // Огненный
  'c7d9a195-c230-462a-aed0-9b7c5bf5fd49': 'ACT-goliath-cloud',  // Облачный
  '203cf3d8-f93b-403b-b6e6-bebe3ee55c68': 'ACT-goliath-frost',  // Ледяной
  'f36bbb07-411c-4444-91d4-98986a421165': 'ACT-goliath-hill',   // Холмовой
  '7a28d849-a2ea-4bf9-9b34-3824bb50211b': 'ACT-goliath-stone',  // Каменный
  '15669e23-0649-4dde-8c86-643150bc3b61': 'ACT-goliath-storm',  // Штормовой
};

const legacyCost = (extra = []) => ({ cost: [...extra, { resource: 'giant_legacy' }] });

const ACTIONS = [
  {
    card_number: 'ACT-goliath-fire', name: 'Огненный ожог',
    description: 'Наследие великанов (Огненный). Когда вы попадаете по существу броском атаки, потратьте заряд Наследия великанов, чтобы нанести цели дополнительно 1к10 урона огнём.',
    mechanics: {
      activation: { mode: 'active', ...legacyCost() },
      effects: [{ resolution: 'auto', who: 'target', result: [{ kind: 'damage', dice: '1d10', type: 'fire', ability: 'none' }] }],
    },
  },
  {
    card_number: 'ACT-goliath-cloud', name: 'Облачная телепортация', distance: '30 футов',
    description: 'Наследие великанов (Облачный). Бонусным действием потратьте заряд Наследия великанов, чтобы телепортироваться на 30 футов в свободное пространство, которое видите.',
    mechanics: {
      activation: { mode: 'active', ...legacyCost([{ resource: 'bonus_action' }]) },
      effects: [{ resolution: 'auto', result: [{ kind: 'narrative', description: 'Телепортируйтесь на 30 футов в свободное пространство, которое видите.' }] }],
    },
  },
  {
    card_number: 'ACT-goliath-frost', name: 'Морозная поступь',
    description: 'Наследие великанов (Ледяной). Когда вы попадаете по существу броском атаки, потратьте заряд Наследия великанов: цель получает дополнительно 1к6 урона холодом, а её скорость снижается на 10 футов до начала вашего следующего хода.',
    mechanics: {
      activation: { mode: 'active', ...legacyCost() },
      effects: [{ resolution: 'auto', who: 'target', result: [
        { kind: 'damage', dice: '1d6', type: 'cold', ability: 'none' },
        { kind: 'narrative', description: 'Скорость цели снижается на 10 футов до начала вашего следующего хода.' },
      ] }],
    },
  },
  {
    card_number: 'ACT-goliath-hill', name: 'Толчок холмов',
    description: 'Наследие великанов (Холмовой). Когда вы попадаете по существу Большого размера или меньше броском атаки, потратьте заряд Наследия великанов, чтобы сбить его с ног (состояние Опрокинут).',
    mechanics: {
      activation: { mode: 'active', ...legacyCost() },
      effects: [{ resolution: 'auto', who: 'target', result: [
        { kind: 'condition', value: 'prone' },
        { kind: 'narrative', description: 'Действует, если цель Большого размера или меньше.' },
      ] }],
    },
  },
  {
    card_number: 'ACT-goliath-stone', name: 'Каменная стойкость',
    description: 'Наследие великанов (Каменный). Получив урон, потратьте заряд Наследия великанов: бросьте 1к12 и прибавьте модификатор Телосложения — уменьшите полученный урон на эту величину (моделируется восстановлением стольких же хитов).',
    mechanics: {
      activation: { mode: 'active', ...legacyCost() },
      effects: [{ resolution: 'auto', result: [
        { kind: 'healing', amount: '1d12+con' },
        { kind: 'narrative', description: 'Представляет снижение полученного урона на 1к12 + модификатор Телосложения.' },
      ] }],
    },
  },
  {
    card_number: 'ACT-goliath-storm', name: 'Громовой удар', distance: '60 футов',
    description: 'Наследие великанов (Штормовой). Получив урон от существа в пределах 60 футов, потратьте заряд Наследия великанов, чтобы нанести этому существу 1к8 урона звуком.',
    mechanics: {
      activation: { mode: 'active', ...legacyCost() },
      effects: [{ resolution: 'auto', who: 'target', result: [{ kind: 'damage', dice: '1d8', type: 'thunder', ability: 'none' }] }],
    },
  },
];

// Родительский эффект: пассивно даёт пул giant_legacy = prof_bonus (общий на все подвиды).
const GIANT_LEGACY_RESOURCE = {
  activation: { mode: 'passive' },
  effects: [{ resolution: 'auto', result: [
    { kind: 'resource', op: 'grant', id: 'giant_legacy', amount: 'prof_bonus' },
    { kind: 'narrative', description: 'Наследие великанов: пул зарядов = бонусу мастерства, восстанавливается после длинного отдыха. Тратится способностью выбранного подвида-наследия.' },
  ] }],
};

const j = (r) => r.json();

async function upsertAction(def) {
  const list = (await fetch(`${BASE}/api/actions?limit=1000`).then(j)).actions || [];
  const existing = list.find((a) => a.card_number === def.card_number);
  const costRes = (def.mechanics.activation.cost || []).map((c) => c.resource).filter(Boolean);
  const body = {
    name: def.name,
    description: def.description,
    rarity: 'common',
    action_type: 'class_feature',
    card_number: def.card_number,
    distance: def.distance ?? null,
    image_url: existing?.image_url || '',
    resources: costRes.length ? costRes : ['action'], // обязательное поле (легаси-отображение стоимости)
    mechanics: def.mechanics,
  };
  const url = existing ? `${BASE}/api/actions/${existing.id}` : `${BASE}/api/actions`;
  const method = existing ? 'PUT' : 'POST';
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) { console.log(`FAIL action ${def.card_number}: ${res.status} ${await res.text()}`); return null; }
  const saved = await res.json();
  console.log(`${existing ? 'UPD' : 'NEW'} action ${def.card_number} (${def.name}) → ${saved.id}`);
  return saved.id;
}

async function updateParentEffect() {
  const effects = (await fetch(`${BASE}/api/effects?limit=1000`).then(j)).effects || [];
  const e = effects.find((x) => x.card_number === PARENT_EFFECT);
  if (!e) { console.log(`SKIP ${PARENT_EFFECT}: не найдено`); return; }
  const body = {
    name: e.name, effect_type: e.effect_type, rarity: e.rarity || 'common', image_url: e.image_url || '',
    description: 'Наследие великанов: вы носите сверхъестественный дар предков-великанов. Пул зарядов = вашему бонусу мастерства (восстанавливается после длинного отдыха). Выбранный подвид даёт способность, тратящую заряд.',
    mechanics: GIANT_LEGACY_RESOURCE,
  };
  const res = await fetch(`${BASE}/api/effects/${e.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  console.log(res.ok ? `UPD effect ${PARENT_EFFECT} → грант ресурса giant_legacy=prof_bonus` : `FAIL effect: ${res.status} ${await res.text()}`);
}

async function wireSubrace(raceId, actionId) {
  const r = await fetch(`${BASE}/api/races/${raceId}`).then(j);
  const body = { ...r, related_actions: [actionId] };
  const res = await fetch(`${BASE}/api/races/${raceId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  console.log(res.ok ? `WIRE subrace ${r.name} → related_actions=[${actionId}]` : `FAIL subrace ${r.name}: ${res.status} ${await res.text()}`);
}

async function main() {
  await updateParentEffect();
  const idByCard = {};
  for (const def of ACTIONS) idByCard[def.card_number] = await upsertAction(def);
  for (const [raceId, card] of Object.entries(SUBRACES)) {
    const aid = idByCard[card];
    if (aid) await wireSubrace(raceId, aid);
  }
  console.log('DONE');
}

main().catch((e) => { console.error(e); process.exit(1); });
