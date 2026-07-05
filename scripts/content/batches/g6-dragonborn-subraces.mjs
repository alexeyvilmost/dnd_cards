#!/usr/bin/env node
/**
 * G6: 10 подвидов драконорождённого (PHB 2024) — зеркало миграции 055.
 * Запуск: node scripts/content/batches/g6-dragonborn-subraces.mjs
 */
import { createSeeder } from '../seed-framework.mjs';
import { apiRequest } from '../api.mjs';

const ANCESTRIES = [
  { slug: 'black', name: 'Чёрный', description: 'Ваши предки — чёрные драконы, чья магия связана с кислотой и разложением.', damageType: 'acid', resistRu: 'кислоте', breathRu: 'Кислотное' },
  { slug: 'brass', name: 'Латунный', description: 'Ваши предки — латунные драконы пустынь, повелители огня и жары.', damageType: 'fire', resistRu: 'огню', breathRu: 'Огненное' },
  { slug: 'bronze', name: 'Бронзовый', description: 'Ваши предки — бронзовые драконы морей, чья стихия — молния и шторм.', damageType: 'lightning', resistRu: 'молнии', breathRu: 'Электрическое' },
  { slug: 'copper', name: 'Медный', description: 'Ваши предки — медные драконы холмов, хранители кислотных источников.', damageType: 'acid', resistRu: 'кислоте', breathRu: 'Кислотное' },
  { slug: 'gold', name: 'Золотой', description: 'Ваши предки — золотые драконы, символы мудрости и пламени.', damageType: 'fire', resistRu: 'огню', breathRu: 'Огненное' },
  { slug: 'green', name: 'Зелёный', description: 'Ваши предки — зелёные драконы лесов, чья магия отравлена и коварна.', damageType: 'poison', resistRu: 'яду', breathRu: 'Ядовитое' },
  { slug: 'red', name: 'Красный', description: 'Ваши предки — красные драконы, повелители огня и сокровищ.', damageType: 'fire', resistRu: 'огню', breathRu: 'Огненное' },
  { slug: 'silver', name: 'Серебряный', description: 'Ваши предки — серебряные драконы, стражи холодных вершин.', damageType: 'cold', resistRu: 'холоду', breathRu: 'Холодное' },
  { slug: 'white', name: 'Белый', description: 'Ваши предки — белые драконы ледяных пустошей.', damageType: 'cold', resistRu: 'холоду', breathRu: 'Холодное' },
  { slug: 'blue', name: 'Синий', description: 'Ваши предки — синие драконы пустынь, чья магия — молния и гром.', damageType: 'lightning', resistRu: 'молнии', breathRu: 'Электрическое' },
];

function resistanceMech(damageType) {
  return {
    activation: { mode: 'passive' },
    effects: [{
      resolution: 'auto',
      result: [{ kind: 'resistance', damage_type: damageType, value: 'resistance' }],
    }],
  };
}

function traitsFor(a) {
  return [
    {
      name: 'Оружие дыхания',
      description: `${a.breathRu} дыхание. Вы получаете способность __Оружие дыхания__ (число использований = бонус мастерства за Долгий отдых).`,
    },
    {
      name: 'Сопротивление урону',
      description: `Вы обладаете сопротивлением урону ${a.resistRu}.`,
    },
  ];
}

async function upsertSubrace(seeder, parent, ancestry, breathActionId, resistanceEffectId) {
  const cardNumber = `sub-${ancestry.slug}`;
  const existing = seeder.find(cardNumber);
  const payload = {
    name: ancestry.name,
    description: ancestry.description,
    card_number: cardNumber,
    rarity: 'common',
    is_subrace: true,
    parent_race_id: parent.id,
    subrace_level: 1,
    related_effects: [resistanceEffectId],
    related_actions: [breathActionId],
    traits: traitsFor(ancestry),
    author: 'Admin',
  };
  if (existing) {
    return apiRequest(seeder.token, 'PUT', `/api/races/${existing.id}`, {
      ...payload,
      image_url: existing.image_url || '',
    }, { dryRun: seeder.dryRun });
  }
  return apiRequest(seeder.token, 'POST', '/api/races', payload, { dryRun: seeder.dryRun });
}

async function main() {
  const seeder = await createSeeder();
  console.log(`G6 dragonborn subraces (dryRun=${seeder.dryRun})`);

  const parent = seeder.find('RACE-0008');
  if (!parent) throw new Error('RACE-0008 not found');

  const breath = seeder.find('ACT-breath-weapon');
  if (!breath?.id) throw new Error('ACT-breath-weapon not found');

  for (const a of ANCESTRIES) {
    const eff = await seeder.upsertEffect({
      cardNumber: `RE-sub-${a.slug}`,
      name: `Сопротивление: ${a.name}`,
      description: `Сопротивление урону ${a.resistRu}.`,
      effectType: 'species_ability',
      mechanics: resistanceMech(a.damageType),
    });
    await upsertSubrace(seeder, parent, a, breath.id, eff.id);
    console.log(`  sub-${a.slug}: ${a.name}`);
  }

  // У родителя убираем перенесённые на подвиды ссылки
  const excludeEffectCards = ['RE-dragonborn-2', 'RE-dragonborn-3'];
  const excludeIds = new Set([breath.id]);
  for (const cn of excludeEffectCards) {
    const e = seeder.find(cn);
    if (e?.id) excludeIds.add(e.id);
  }
  const parentEffects = (parent.related_effects || []).filter((id) => !excludeIds.has(id));
  const parentActions = (parent.related_actions || []).filter((id) => !excludeIds.has(id));

  await seeder.patchRace('RACE-0008', {
    subrace_level: 1,
    lineages: [],
    related_effects: parentEffects,
    related_actions: parentActions,
  });

  console.log('Готово:', seeder.stats);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
