#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import { apiRequest, apiUrl, login } from './api.mjs';
import { sha256Canonical } from './certification-hash.mjs';
import { fetchMiniMvpCatalogs } from './mini-mvp-audit.mjs';
import { MINI_MVP_MANIFEST } from './mini-mvp-manifest.mjs';

const PHB_2024 = 'PHB 2024';

export const REQUIRED_BOOK_SPECS = Object.freeze([
  Object.freeze({
    key: 'spellbook',
    name: 'Книга заклинаний',
    payload: Object.freeze({
      name: 'Книга заклинаний',
      name_en: 'Spellbook',
      description: 'Книга волшебника на 100 страниц, в которой записаны известные ему заклинания 1+ уровня.',
      rarity: 'common',
      price: 50,
      price_currency: 'gold',
      weight: 3,
      source: PHB_2024,
      author: 'Admin',
      is_template: 'not_template',
    }),
  }),
  Object.freeze({
    key: 'occultBook',
    name: 'Книга (оккультные знания)',
    payload: Object.freeze({
      name: 'Книга (оккультные знания)',
      name_en: 'Book (occult lore)',
      description: 'Книга с записями о скрытых знаниях и тайнах мультивселенной.',
      rarity: 'common',
      price: 25,
      price_currency: 'gold',
      weight: 5,
      source: PHB_2024,
      author: 'Admin',
      is_template: 'not_template',
    }),
  }),
]);

const EQUIPMENT_PREIMAGE_HASHES = Object.freeze({
  'CLASS-wizard': 'sha256:360826c2a31a125d2b5ed428be7b145abfe557f1ccbc5e022acef7803f1a1cd3',
  'CLASS-warlock': 'sha256:9d5b2e105940849f333bcfaf7779d0b021ef5fd19b4bf60d3bb76a3fbaf0dc8d',
  'CLASS-paladin': 'sha256:bece4ef68d08db540726fa40d7eaed20f3bfe4e0bedd8be5d0fadae27357861c',
  'CLASS-ranger': 'sha256:dc5547235fe51d81adf3b516a50af30b06b67117911a715445ca408916d651f9',
});

export const EQUIPMENT_KITS = Object.freeze({
  'CLASS-wizard': Object.freeze({
    option_a: Object.freeze({
      items: Object.freeze([
        ['CARD-0297', 2], ['CARD-0826', 1], ['CARD-0710', 1],
        ['book:spellbook', 1], ['CARD-0807', 1],
      ]),
      gold: 5,
    }),
    option_b: Object.freeze({ items: Object.freeze([]), gold: 55 }),
  }),
  'CLASS-warlock': Object.freeze({
    option_a: Object.freeze({
      items: Object.freeze([
        ['CARD-0275', 1], ['CARD-0299', 1], ['CARD-0297', 2],
        ['CARD-0826', 1], ['book:occultBook', 1], ['CARD-0807', 1],
      ]),
      gold: 15,
    }),
    option_b: Object.freeze({ items: Object.freeze([]), gold: 100 }),
  }),
  'CLASS-paladin': Object.freeze({
    option_a: Object.freeze({
      items: Object.freeze([
        ['CARD-0283', 1], ['CARD-0200', 1], ['CARD-0319', 1],
        ['CARD-0301', 6], ['CARD-0816', 1], ['CARD-0409', 1],
      ]),
      gold: 9,
    }),
    option_b: Object.freeze({ items: Object.freeze([]), gold: 150 }),
  }),
  'CLASS-ranger': Object.freeze({
    option_a: Object.freeze({
      items: Object.freeze([
        ['CARD-0276', 1], ['CARD-0311', 1], ['CARD-0294', 1],
        ['CARD-0327', 1], ['CARD-0728', 20], ['CARD-0729', 1],
        ['CARD-0827', 1], ['CARD-0806', 1],
      ]),
      gold: 7,
    }),
    option_b: Object.freeze({ items: Object.freeze([]), gold: 150 }),
  }),
});

function exactEntity(items, cardNumber) {
  const matches = items.filter((entity) => entity.card_number === cardNumber);
  if (matches.length !== 1) throw new Error(`${cardNumber}: expected one entity, got ${matches.length}`);
  return matches[0];
}

function sameStrings(left, right) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function lineageNames(entity) {
  return (Array.isArray(entity.lineages) ? entity.lineages : [])
    .map((lineage) => lineage?.name)
    .filter((name) => typeof name === 'string' && name);
}

export function planRequiredBooks(cards) {
  const create = [];
  const resolved = new Map();
  for (const spec of REQUIRED_BOOK_SPECS) {
    const matches = cards.filter((card) => card.name === spec.name && card.source === PHB_2024);
    if (matches.length > 1) throw new Error(`${spec.key}: duplicate PHB 2024 cards`);
    if (matches.length === 0) create.push(spec);
    else resolved.set(spec.key, matches[0]);
  }
  return { create, resolved };
}

function resolveEquipmentRef(reference, cards, books) {
  if (reference.startsWith('book:')) {
    const key = reference.slice('book:'.length);
    const card = books.get(key);
    if (!card) return null;
    return card;
  }
  return exactEntity(cards, reference);
}

function materializeKit(spec, cards, books) {
  const materializeOption = (option) => {
    const items = [];
    for (const [reference, quantity] of option.items) {
      const card = resolveEquipmentRef(reference, cards, books);
      if (!card) return null;
      items.push({ card_id: card.id, quantity });
    }
    return { items, gold: option.gold };
  };
  const optionA = materializeOption(spec.option_a);
  const optionB = materializeOption(spec.option_b);
  return optionA && optionB ? { option_a: optionA, option_b: optionB } : null;
}

function addMutation(mutations, entityType, entity, path, patch, reason) {
  const key = `${entityType}:${entity.id}`;
  const previous = mutations.get(key);
  if (previous) {
    previous.patch = { ...previous.patch, ...patch };
    previous.reasons.push(reason);
    return;
  }
  mutations.set(key, {
    entityType,
    entity,
    cardNumber: entity.card_number,
    path,
    patch: { ...patch },
    reasons: [reason],
  });
}

export function planStructuralDataRepair(catalogs) {
  const mutations = new Map();
  const books = planRequiredBooks(catalogs.card ?? []);

  for (const entry of MINI_MVP_MANIFEST.collections.classes) {
    const entity = exactEntity(catalogs.class ?? [], entry.selector.cardNumber);
    if (entity.name !== entry.label) {
      throw new Error(`${entry.selector.cardNumber}: expected «${entry.label}», got «${entity.name}»`);
    }
    if (entity.source !== PHB_2024) {
      if (entity.source !== null && entity.source !== undefined && entity.source !== '') {
        throw new Error(`${entity.card_number}: refusing unexpected source «${entity.source}»`);
      }
      addMutation(mutations, 'class', entity, `/api/classes/${entity.id}`, { source: PHB_2024 }, 'источник PHB 2024');
    }
  }

  for (const [cardNumber, spec] of Object.entries(EQUIPMENT_KITS)) {
    const entity = exactEntity(catalogs.class ?? [], cardNumber);
    const desired = materializeKit(spec, catalogs.card ?? [], books.resolved);
    if (!desired) continue;
    const currentHash = sha256Canonical(entity.equipment_options);
    const desiredHash = sha256Canonical(desired);
    if (currentHash === desiredHash) continue;
    if (currentHash !== EQUIPMENT_PREIMAGE_HASHES[cardNumber]) {
      throw new Error(`${cardNumber}: refusing equipment preimage ${currentHash}`);
    }
    addMutation(
      mutations,
      'class',
      entity,
      `/api/classes/${entity.id}`,
      { equipment_options: desired },
      'стартовый набор PHB 2024',
    );
  }

  const dwarf = exactEntity(catalogs.race ?? [], 'RACE-0003');
  if (dwarf.name === 'Дворф') {
    addMutation(mutations, 'race', dwarf, `/api/races/${dwarf.id}`, { name: 'Дварф' }, 'каноничное русское имя');
  } else if (dwarf.name !== 'Дварф') {
    throw new Error(`RACE-0003: refusing unexpected name «${dwarf.name}»`);
  }
  const dwarfLineages = lineageNames(dwarf);
  if (dwarfLineages.length > 0) {
    if (!sameStrings(dwarfLineages, ['Горный дворф', 'Холмовой дворф'])) {
      throw new Error(`RACE-0003: refusing unexpected lineages [${dwarfLineages.join(', ')}]`);
    }
    addMutation(mutations, 'race', dwarf, `/api/races/${dwarf.id}`, { lineages: [] }, 'убрать legacy-подвиды 2014 года');
  }

  const human = exactEntity(catalogs.race ?? [], 'RACE-0002');
  const humanLineages = lineageNames(human);
  if (humanLineages.length > 0) {
    if (!sameStrings(humanLineages, ['Человек'])) {
      throw new Error(`RACE-0002: refusing unexpected lineages [${humanLineages.join(', ')}]`);
    }
    addMutation(mutations, 'race', human, `/api/races/${human.id}`, { lineages: [] }, 'убрать legacy-псевдоподвид');
  }

  const magicInitiate = exactEntity(catalogs.feat ?? [], 'FEAT-0009');
  if (magicInitiate.name === 'Посвящённый в магию: Волшебник') {
    addMutation(mutations, 'feat', magicInitiate, `/api/feats/${magicInitiate.id}`, { name: 'Посвящённый в магию' }, 'имя общей черты');
  } else if (magicInitiate.name !== 'Посвящённый в магию') {
    throw new Error(`FEAT-0009: refusing unexpected name «${magicInitiate.name}»`);
  }

  const speakWithAnimals = exactEntity(catalogs.spell ?? [], 'SPELL-0277');
  if (speakWithAnimals.name === 'Разговор с Животными') {
    addMutation(mutations, 'spell', speakWithAnimals, `/api/spells/${speakWithAnimals.id}`, { name: 'Разговор с животными' }, 'каноничный регистр имени');
  } else if (speakWithAnimals.name !== 'Разговор с животными') {
    throw new Error(`SPELL-0277: refusing unexpected name «${speakWithAnimals.name}»`);
  }

  return { creates: books.create, mutations: [...mutations.values()] };
}

function printPlan(plan, apply) {
  console.log(`${apply ? 'APPLY' : 'DRY-RUN'} ${apiUrl()}: ${plan.creates.length} creates, ${plan.mutations.length} mutations`);
  for (const spec of plan.creates) console.log(`  ${apply ? '+' : '✓'} card: ${spec.name}`);
  for (const item of plan.mutations) console.log(`  ${apply ? '↻' : '✓'} ${item.cardNumber}: ${item.reasons.join('; ')}`);
}

export async function runStructuralDataRepair({ apply = process.argv.includes('--apply') } = {}) {
  let catalogs = await fetchMiniMvpCatalogs();
  let plan = planStructuralDataRepair(catalogs);
  printPlan(plan, apply);
  if (!apply) return plan;
  const token = await login();
  for (const spec of plan.creates) await apiRequest(token, 'POST', '/api/cards', spec.payload);

  if (plan.creates.length > 0) {
    catalogs = await fetchMiniMvpCatalogs();
    plan = planStructuralDataRepair(catalogs);
    if (plan.creates.length > 0) throw new Error('Required cards were not observable after creation');
  }
  for (const item of plan.mutations) await apiRequest(token, 'PUT', item.path, item.patch);
  return plan;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runStructuralDataRepair().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
