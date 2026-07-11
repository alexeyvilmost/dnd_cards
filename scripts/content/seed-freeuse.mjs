#!/usr/bin/env node
/**
 * Сид фичи freeuse (бесплатные использования заклинаний) в 3 тестовые сущности прод-БД:
 *  - Высший эльф (эффект RE-sub-high_elf): Обнаружение магии + Туманный шаг — 1×/долгий отдых;
 *  - Посвящённый в магию: Волшебник (эффект): выбранное заклинание 1 круга — 1×/долгий отдых (через choice.grant);
 *  - Кольцо странника (предмет): Туманный шаг — 2×/долгий отдых (passive grant_spell + гейт настройки).
 *
 * Идемпотентно (freeuse дописывается, если его нет). Auth в проекте отключён (middleware no-op),
 * PUT работает без токена. Запуск: node scripts/content/seed-freeuse.mjs   (--dry — только показать).
 */
const API = process.env.API_URL || 'https://backend-production-41c3.up.railway.app';
const DRY = process.argv.includes('--dry');

const EFFECT_HIGH_ELF = '8e2b5ef6-e3da-49d0-af6f-1cdd457db671';       // RE-sub-high_elf
const EFFECT_MAGIC_INITIATE = '2023be11-201d-4f3a-b9c3-a8019b972b80'; // magic_initiate_wizard
const CARD_RING = 'e8ca9687-9285-497e-b5ea-548207687998';            // CARD-0543 Кольцо странника

async function getJson(path) {
  const r = await fetch(`${API}${path}`);
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
  return r.json();
}
async function put(path, body) {
  if (DRY) { console.log(`  [dry] PUT ${path}`); return; }
  const r = await fetch(`${API}${path}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`PUT ${path} → ${r.status} ${await r.text()}`);
}

/** Рекурсивно навесить freeuse на grant_spell-узлы, где predicate(node)===true. */
function addFreeuse(node, predicate, freeuse) {
  let changed = false;
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (n.kind === 'grant_spell' && predicate(n)) {
      if (JSON.stringify(n.freeuse) !== JSON.stringify(freeuse)) { n.freeuse = freeuse; changed = true; }
    }
    for (const v of Object.values(n)) {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') walk(v);
    }
  };
  walk(node);
  return changed;
}

async function seedHighElf() {
  const eff = await getJson(`/api/effects/${EFFECT_HIGH_ELF}`);
  const m = eff.mechanics;
  const fu = { count: 1, recharge: 'long_rest' };
  // detect_magic (1 круг) и misty_step (2 круг) — бесплатно; prestidigitation (заговор) — нет.
  const changed = addFreeuse(m, (n) => ['detect_magic', 'misty_step'].includes(String(n.value)), fu);
  console.log(`Высший эльф: ${changed ? 'обновляю freeuse' : 'уже настроено'}`);
  if (changed) await put(`/api/effects/${EFFECT_HIGH_ELF}`, { mechanics: m });
}

async function seedMagicInitiate() {
  const eff = await getJson(`/api/effects/${EFFECT_MAGIC_INITIATE}`);
  const m = eff.mechanics;
  const fu = { count: 1, recharge: 'long_rest' };
  // freeuse на grant внутри choice заклинания 1 круга (label:'spellbook'); заговоры (cantrip) — нет.
  let changed = false;
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (n.kind === 'choice' && n.grant && n.grant.kind === 'grant_spell' && n.grant.label !== 'cantrip') {
      if (JSON.stringify(n.grant.freeuse) !== JSON.stringify(fu)) { n.grant.freeuse = fu; changed = true; }
    }
    for (const v of Object.values(n)) {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') walk(v);
    }
  };
  walk(m);
  console.log(`Посвящённый в магию: ${changed ? 'обновляю freeuse (choice 1 круга)' : 'уже настроено'}`);
  if (changed) await put(`/api/effects/${EFFECT_MAGIC_INITIATE}`, { mechanics: m });
}

async function seedRing() {
  // Пассивный грант «Туманный шаг» с freeuse 2×/долгий отдых, действует пока предмет настроен.
  // Каст тратит собственную стоимость misty_step (бонусное действие). Заменяет прежний narrative.
  const mechanics = {
    activation: { mode: 'passive', while: 'attuned' },
    effects: [{
      resolution: 'auto',
      result: [{ kind: 'grant_spell', value: 'misty_step', ability: 'cha', freeuse: { count: 2, recharge: 'long_rest' } }],
    }],
  };
  console.log('Кольцо странника: ставлю passive grant_spell misty_step (freeuse 2/долгий отдых)');
  await put(`/api/cards/${CARD_RING}`, { mechanics });
}

async function main() {
  console.log(`API: ${API}${DRY ? '  (DRY RUN)' : ''}`);
  await seedHighElf();
  await seedMagicInitiate();
  await seedRing();
  console.log('Готово.');
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
