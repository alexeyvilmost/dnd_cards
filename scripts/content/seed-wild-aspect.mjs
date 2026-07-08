#!/usr/bin/env node
/**
 * Унификация выборов, слайс 5 (демо in-play): «Аспект дикой природы» (Варвар, Путь дикого
 * сердца, 6 ур.). Было narrative («получаете одну особенность по выбору») — теперь настоящий
 * choice с context:'in_play': выбор разрешается НА ЛИСТЕ (панель «Выборы способностей»),
 * меняется в любой момент (RAW — после Долгого отдыха). Гранты — grant_sense/grant_speed (D3),
 * видны в блоках «Чувства»/скорости листа.
 *
 * Запуск: node scripts/content/seed-wild-aspect.mjs          (dry-run)
 *         node scripts/content/seed-wild-aspect.mjs --apply   (запись в прод)
 */
import { apiRequest, fetchAll, login } from './api.mjs';

const APPLY = process.argv.includes('--apply');
const dryRun = !APPLY;
const EFFECT_ID = '68649196-2012-4409-8044-87958284d804'; // «Аспект дикой природы»

const MECH = {
  activation: { mode: 'passive' },
  effects: [
    {
      kind: 'choice',
      id: 'wild_aspect',
      context: 'in_play',
      count: 1,
      prompt: 'Аспект дикой природы',
      options: {
        source: 'explicit',
        items: [
          { id: 'owl', name: 'Сова — тёмное зрение 60 фт', grants: [{ kind: 'grant_sense', sense: 'darkvision', range: 60 }] },
          { id: 'panther', name: 'Пантера — скорость лазания 30', grants: [{ kind: 'grant_speed', mode: 'climb', value: 30 }] },
          { id: 'salmon', name: 'Лосось — скорость плавания 30', grants: [{ kind: 'grant_speed', mode: 'swim', value: 30 }] },
        ],
      },
    },
  ],
};

async function main() {
  const token = APPLY ? await login() : null;
  const effects = await fetchAll('/api/effects', 'effects');
  const eff = effects.find((e) => e.id === EFFECT_ID);
  console.log(`\n=== Слайс 5 демо: «Аспект дикой природы» in-play (${APPLY ? 'APPLY' : 'dry-run'}) ===\n`);
  if (!eff) { console.log('⚠ НЕ найден эффект'); return; }
  console.log(`Эффект: «${eff.name}»`);
  console.log('Было:', JSON.stringify(eff.mechanics).slice(0, 140));
  console.log('Станет:', JSON.stringify(MECH));
  await apiRequest(token, 'PUT', `/api/effects/${eff.id}`, { mechanics: MECH }, { dryRun });
  console.log(APPLY ? '\n✓ Обновлено' : '\n(dry-run — добавь --apply)');
}

main().catch((e) => { console.error(e); process.exit(1); });
