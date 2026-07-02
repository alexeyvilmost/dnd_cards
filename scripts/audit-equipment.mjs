#!/usr/bin/env node
/**
 * Фаза C7: аудит существующих карт снаряжения (без создания дубликатов).
 * Проверяет, что в библиотеке cards уже есть оружие/щиты/доспехи
 * с полями, нужными движку MVP (slot, weight, bonus_value, defense_type…).
 *
 * Запуск: node scripts/audit-equipment.mjs
 */
const API_URL = process.env.API_URL || 'https://backend-production-41c3.up.railway.app';

/** Ключевые предметы PHB по русскому названию — ищем в существующей библиотеке */
const KEY_ITEMS_BY_NAME = [
  'Кинжал', 'Длинный меч', 'Двуручный меч', 'Короткий меч',
  'Кожаный доспех', 'Кольчуга', 'Щит',
];

async function fetchAllCards() {
  const items = [];
  let page = 1;
  while (true) {
    const res = await fetch(`${API_URL}/api/cards?page=${page}&limit=200&exclude_template_only=true`);
    if (!res.ok) throw new Error(`cards HTTP ${res.status}`);
    const data = await res.json();
    const batch = data.cards || [];
    items.push(...batch);
    if (batch.length < 200) break;
    page++;
  }
  return items;
}

function normName(s) {
  return String(s || '').trim().toLowerCase().replace(/ё/g, 'е');
}

function checkCardFields(c) {
  const issues = [];
  if (c.type === 'weapon') {
    if (!c.bonus_value) issues.push('нет bonus_value (кость урона)');
    if (!c.slot) issues.push('нет slot');
    if (!c.damage_type) issues.push('нет damage_type');
  } else if (c.type === 'shield') {
    if (!c.bonus_value) issues.push('нет bonus_value (+КД)');
    if (!c.slot) issues.push('нет slot');
  } else if (c.type === 'chest' || (c.defense_type && c.bonus_type === 'defense')) {
    if (c.bonus_type !== 'defense') issues.push('bonus_type не defense');
    if (!c.bonus_value) issues.push('нет bonus_value (КЗ)');
    if (!c.defense_type) issues.push('нет defense_type');
    if (c.slot !== 'body') issues.push(`slot не body (сейчас: ${c.slot ?? '—'})`);
  }
  return issues;
}

async function main() {
  console.log(`API: ${API_URL}`);
  const cards = await fetchAllCards();

  const weapons = cards.filter((c) => c.type === 'weapon' && c.bonus_value && c.slot);
  const shields = cards.filter((c) => c.type === 'shield');
  const armor = cards.filter(
    (c) => (c.type === 'chest' || c.defense_type) && c.bonus_type === 'defense' && c.type !== 'shield',
  );

  console.log(`Карт (не only_template): ${cards.length}`);
  console.log(`Оружие (type=weapon, кость + слот): ${weapons.length}`);
  console.log(`Щиты: ${shields.length}`);
  console.log(`Доспехи: ${armor.length}`);

  const issues = [];
  if (weapons.length < 20) issues.push(`оружия с рабочими полями мало: ${weapons.length} < 20`);
  if (shields.length < 1) issues.push('нет щитов (type=shield)');
  if (armor.length < 8) issues.push(`доспехов мало: ${armor.length} < 8`);

  const byName = new Map(cards.map((c) => [normName(c.name), c]));
  for (const name of KEY_ITEMS_BY_NAME) {
    const c = byName.get(normName(name));
    if (!c) {
      issues.push(`не найден ключевой предмет по названию «${name}»`);
      continue;
    }
    const bad = checkCardFields(c);
    for (const b of bad) issues.push(`«${name}» (${c.card_number}): ${b}`);
  }

  const broken = weapons.concat(shields, armor).filter((c) => checkCardFields(c).length > 0);
  if (broken.length > 0 && broken.length <= 15) {
    for (const c of broken) {
      for (const b of checkCardFields(c)) {
        issues.push(`${c.card_number} «${c.name}»: ${b}`);
      }
    }
  } else if (broken.length > 15) {
    issues.push(`ещё ${broken.length} карт снаряжения с неполными полями (см. type/slot/bonus_value)`);
  }

  if (issues.length === 0) {
    console.log('✅ Аудит снаряжения: библиотека готова для MVP');
  } else {
    console.log(`❌ Замечаний: ${issues.length}`);
    for (const i of issues) console.log(`  - ${i}`);
    console.log('\nПодсказка: чините существующие карты (slot, bonus_value, defense_type),');
    console.log('а не создавайте дубликаты — см. scripts/update_weapon_templates.go');
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
