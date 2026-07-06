#!/usr/bin/env node
/**
 * Переводит «Дар договора» и «Мистические воззвания» на схему типов эффектов:
 * инлайн-варианты choice(source:explicit) → отдельные эффекты с полем type,
 * а родительский выбор → choice(source:effect_type, type:<...>).
 * Идемпотентно (по card_number). Транслитерация id вариантов сохраняется.
 *
 * Запуск: node scripts/content/convert-effect-types.mjs [--apply]
 */
import { apiRequest, fetchAll, login } from './api.mjs';

const APPLY = process.argv.includes('--apply');

const GROUPS = [
  { parentCard: 'EFF-pact-boon', type: 'Дар договора', prefix: 'EFF-pact', count: 1 },
  { parentName: 'Мистические воззвания', type: 'Мистическое воззвание', prefix: 'EFF-invoc', count: null }, // count из исходного choice
];

/** Первый choice(source:explicit) в механике. */
function findExplicitChoice(mech) {
  for (const it of mech?.effects || []) {
    if (it?.kind === 'choice' && it.options?.source === 'explicit') return it;
    if (it?.resolution === 'auto' && Array.isArray(it.result)) {
      for (const p of it.result) if (p?.kind === 'choice' && p.options?.source === 'explicit') return p;
    }
  }
  return null;
}

async function main() {
  const token = APPLY ? await login() : null;
  const effects = await fetchAll('/api/effects', 'effects');
  const byCard = new Map(effects.map((e) => [e.card_number, e]));
  const byName = new Map(effects.map((e) => [e.name, e]));

  for (const g of GROUPS) {
    const parent = g.parentCard ? byCard.get(g.parentCard) : byName.get(g.parentName);
    if (!parent) { console.log('НЕ НАЙДЕН родитель', g.parentCard || g.parentName); continue; }
    const mech = JSON.parse(JSON.stringify(parent.mechanics || {}));
    const choice = findExplicitChoice(mech);
    if (!choice) { console.log(`${parent.name}: choice(explicit) не найден (уже сконвертирован?)`); continue; }

    const NAME_FIX = { 'Тome': 'Гримуар', 'Тoме': 'Гримуар' };
    const items = (choice.options.items || []).map((it) => ({ ...it, name: NAME_FIX[it.name] || it.name }));
    console.log(`\n=== ${parent.name} → тип «${g.type}», вариантов: ${items.length} ===`);
    let created = 0;
    for (const item of items) {
      const card = `${g.prefix}-${item.id}`;
      if (byCard.has(card)) { console.log('  уже есть:', card); continue; }
      // Механика варианта = его grants как passive auto-result.
      const grants = Array.isArray(item.grants) ? item.grants : [];
      const subMech = { activation: { mode: 'passive' }, effects: grants.length ? [{ resolution: 'auto', result: grants }] : [] };
      const desc = grants.map((gg) => gg.description).filter(Boolean).join(' ') || item.name;
      const payload = {
        name: item.name,
        description: desc,
        rarity: 'common',
        effect_type: 'class_ability',
        type: g.type,
        card_number: card,
        mechanics: subMech,
        source: parent.source || 'PHB 2024',
      };
      console.log('  + эффект:', item.name, `(${card})`);
      created++;
      if (APPLY) await apiRequest(token, 'POST', '/api/effects', payload);
    }

    // Родитель: choice(explicit) → choice(effect_type)
    const newCount = g.count ?? choice.count ?? 1;
    choice.count = newCount;
    choice.options = { source: 'effect_type', type: g.type };
    console.log(`  родитель: choice → source:effect_type, type:«${g.type}», count:${newCount}`);
    if (APPLY) await apiRequest(token, 'PUT', `/api/effects/${parent.id}`, { mechanics: mech });
    console.log(`  создано вариантов: ${created}`);
  }
  console.log('\nГотово.');
}

main().catch((e) => { console.error(e); process.exit(1); });
