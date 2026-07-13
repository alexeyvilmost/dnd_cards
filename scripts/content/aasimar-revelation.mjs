/**
 * Аасимар (PHB 2024): «Небесное откровение» — не подвиды, а ВЫБОР при каждом использовании.
 * Одно действие (бонусное, открывается на 3 уровне, 1 раз/долгий отдых): при использовании
 * всплывает выбор одного из трёх проявлений (in_play-choice), применяется выбранное на 1 минуту.
 * Механически: каркас (уровневый гейт + 1/долгий отдых + выбор-при-использовании); сами проявления
 * пока нарративны (полёт/аура излучения/аура испуга — площадные/потиковые эффекты, задел на движок).
 *
 * Запуск: node scripts/content/aasimar-revelation.mjs
 */
const BASE = process.env.API_URL || 'https://backend-production-41c3.up.railway.app';
const j = (r) => r.json();

const REVELATION_MECH = {
  activation: { mode: 'active', cost: [{ resource: 'bonus_action' }], requirements: [{ type: 'level', min_level: 3 }] },
  uses: { count: 1, per: 'long_rest' },
  effects: [{
    kind: 'choice', id: 'revelation', context: 'in_play', count: 1,
    prompt: 'Выберите проявление Небесного откровения (на 1 минуту)',
    options: {
      source: 'explicit',
      items: [
        { id: 'wings', name: 'Небесные крылья', grants: [
          { kind: 'narrative', description: 'Небесные крылья: у вас появляется скорость полёта, равная скорости ходьбы, на 1 минуту.' },
        ] },
        { id: 'radiance', name: 'Внутренний свет', grants: [
          { kind: 'narrative', description: 'Внутренний свет: вы излучаете яркий свет в радиусе 10 футов (и тусклый ещё на 10). В конце каждого вашего хода все существа в пределах 10 футов получают урон Излучением, равный вашему бонусу мастерства. 1 минута.' },
        ] },
        { id: 'shroud', name: 'Некротический покров', grants: [
          { kind: 'narrative', description: 'Некротический покров: существа в пределах 10 футов, видящие вас, должны преуспеть в спасброске или стать Испуганными до конца вашего следующего хода. Один раз в ход при попадании атакой добавьте урон Некротической энергией, равный вашему бонусу мастерства. 1 минута.' },
        ] },
      ],
    },
  }],
};

async function upsertRevelation() {
  const list = (await fetch(`${BASE}/api/actions?limit=1000`).then(j)).actions || [];
  const ex = list.find((a) => a.card_number === 'ACT-aasimar-revelation');
  const body = {
    name: 'Небесное откровение', card_number: 'ACT-aasimar-revelation', rarity: 'common', action_type: 'class_feature',
    description: 'С 3 уровня бонусным действием вы преображаетесь, выбирая одно из трёх проявлений (Небесные крылья, Внутренний свет, Некротический покров) на 1 минуту. Можно использовать один раз, восстанавливается после долгого отдыха.',
    resources: ['bonus_action'], image_url: ex?.image_url || '', mechanics: REVELATION_MECH,
  };
  const url = ex ? `${BASE}/api/actions/${ex.id}` : `${BASE}/api/actions`;
  const res = await fetch(url, { method: ex ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) { console.log(`FAIL revelation: ${res.status} ${await res.text()}`); return null; }
  const saved = await res.json();
  console.log(`${ex ? 'UPD' : 'NEW'} action ACT-aasimar-revelation → ${saved.id}`);
  return saved.id;
}

async function main() {
  const actId = await upsertRevelation();
  const races = (await fetch(`${BASE}/api/races?limit=300`).then(j)).races;
  const aasimar = races.find((r) => r.name === 'Аасимар' && !r.is_subrace);
  const acts = new Set([...(aasimar.related_actions || []), actId]);
  const body = { ...aasimar, related_actions: [...acts] };
  const res = await fetch(`${BASE}/api/races/${aasimar.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  console.log(res.ok ? `WIRE Аасимар.related_actions += Небесное откровение` : `FAIL wire: ${res.status} ${await res.text()}`);
  console.log('DONE. Примечание: 3 подвида Аасимара (Внутренний свет/Небесные крылья/Саван смерти) — легаси; по 2024 их следует убрать из пикера (проявление выбирается действием). Оставлены как есть.');
}
main().catch((e) => { console.error(e); process.exit(1); });
