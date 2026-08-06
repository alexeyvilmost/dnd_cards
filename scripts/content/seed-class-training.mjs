#!/usr/bin/env node
/**
 * Class training plus reviewed micro-MVP PHB 2024 starting equipment.
 *
 * Equipment is selected only by the stable card_number + UUID assertions in
 * micro-mvp-l1-content-patch.v1.json. Runtime name matching is deliberately
 * forbidden: duplicate translated names are not content identity.
 *
 * Wizard and Warlock currently lack exact item cards required for a complete
 * PHB option A. The reviewed patch therefore exposes only their gold option.
 * `--apply` refuses that known degradation unless it is explicitly accepted
 * with `--allow-gold-only`.
 *
 * Usage:
 *   node scripts/content/seed-class-training.mjs
 *   node scripts/content/seed-class-training.mjs --apply --allow-gold-only
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiRequest, fetchAll, login } from './api.mjs';

const APPLY = process.argv.includes('--apply');
const ALLOW_GOLD_ONLY = process.argv.includes('--allow-gold-only');
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PATCH = JSON.parse(readFileSync(resolve(
  REPO_ROOT,
  'frontend/src/canon/data/micro-mvp-l1-content-patch.v1.json',
), 'utf8'));

// [armor_training[], weapon_proficiencies[]] by stable class card_number.
const TRAINING = {
  'CLASS-bard':      [['light'], ['simple']],
  'CLASS-barbarian': [['light', 'medium', 'shields'], ['simple', 'martial']],
  'CLASS-warrior':   [['light', 'medium', 'heavy', 'shields'], ['simple', 'martial']],
  'CLASS-wizard':    [[], ['simple']],
  'CLASS-druid':     [['light', 'medium', 'shields'], ['simple']],
  'CLASS-cleric':    [['light', 'medium', 'shields'], ['simple']],
  'CLASS-warlock':   [['light'], ['simple']],
  'CLASS-monk':      [[], ['simple', 'martial']],
  'CLASS-paladin':   [['light', 'medium', 'heavy', 'shields'], ['simple', 'martial']],
  'CLASS-rogue':     [['light'], ['simple', 'martial']],
  'CLASS-ranger':    [['light', 'medium', 'shields'], ['simple', 'martial']],
  'CLASS-sorcerer':  [[], ['simple']],
};

const MICRO_MVP_CLASSES = new Set([
  'CLASS-warrior',
  'CLASS-wizard',
  'CLASS-rogue',
  'CLASS-cleric',
  'CLASS-sorcerer',
  'CLASS-warlock',
  'CLASS-druid',
]);

export const INCOMPLETE_PHB_ITEM_KITS = Object.freeze({
  'CLASS-wizard': Object.freeze([
    'Robe: exact mundane item card is absent',
    'Spellbook: exact mundane item card is absent',
  ]),
  'CLASS-warlock': Object.freeze([
    'Book (occult lore): exact mundane item card is absent',
  ]),
});

export function reviewedMicroMvpEquipmentPlans(patch = PATCH) {
  return new Map(patch.fieldPatches
    .filter((entry) => (
      entry.collection === 'classes'
      && MICRO_MVP_CLASSES.has(entry.cardNumber)
      && entry.fields?.equipment_options
    ))
    .map((entry) => [entry.cardNumber, entry]));
}

function exactEntity(rows, identity, label) {
  const byId = rows.filter((row) => row.id === identity.entityId);
  const byCard = rows.filter((row) => row.card_number === identity.cardNumber);
  if (byId.length !== 1 || byCard.length !== 1 || byId[0] !== byCard[0]) {
    throw new Error(
      `${label} ${identity.cardNumber}/${identity.entityId} is missing, duplicated, or split`,
    );
  }
  return byId[0];
}

export function validateReviewedEquipmentPlans(plans, classes, cards) {
  const issues = [];
  for (const classCardNumber of MICRO_MVP_CLASSES) {
    const plan = plans.get(classCardNumber);
    if (!plan) {
      issues.push(`${classCardNumber}: no reviewed equipment field patch`);
      continue;
    }
    try {
      exactEntity(classes, {
        entityId: plan.entityId,
        cardNumber: plan.cardNumber,
      }, 'class');
      for (const reference of plan.entityReferences ?? []) {
        if (reference.collection !== 'cards') continue;
        exactEntity(cards, reference, 'equipment card');
      }
      const assertedCardIds = new Set((plan.entityReferences ?? [])
        .filter((reference) => reference.collection === 'cards')
        .map((reference) => reference.entityId));
      const itemCardIds = new Set(Object.values(plan.fields.equipment_options)
        .flatMap((option) => option?.items ?? [])
        .map((item) => item.card_id));
      const uncovered = [...itemCardIds].filter((id) => !assertedCardIds.has(id));
      const unused = [...assertedCardIds].filter((id) => !itemCardIds.has(id));
      if (uncovered.length || unused.length) {
        issues.push(
          `${classCardNumber}: equipment references differ from declared stable identities`
          + `${uncovered.length ? `; uncovered ${uncovered.join(', ')}` : ''}`
          + `${unused.length ? `; unused ${unused.join(', ')}` : ''}`,
        );
      }
    } catch (error) {
      issues.push(error instanceof Error ? error.message : String(error));
    }
  }
  return issues;
}

async function main() {
  const [classes, cards] = await Promise.all([
    fetchAll('/api/classes', 'classes'),
    fetchAll('/api/cards', 'cards'),
  ]);
  const plans = reviewedMicroMvpEquipmentPlans();
  const issues = validateReviewedEquipmentPlans(plans, classes, cards);
  if (issues.length) {
    throw new Error(`Starting-equipment preflight failed:\n${issues.join('\n')}`);
  }

  const incomplete = Object.entries(INCOMPLETE_PHB_ITEM_KITS);
  for (const [classCardNumber, blockers] of incomplete) {
    console.warn(
      `НЕПОЛНЫЙ PHB option A ${classCardNumber}; доступен только проверенный gold-only branch: `
      + blockers.join('; '),
    );
  }
  if (APPLY && incomplete.length && !ALLOW_GOLD_ONLY) {
    throw new Error(
      'Refusing apply with incomplete PHB item kits. Review the warnings and pass '
      + '--allow-gold-only to explicitly keep Wizard/Warlock gold-only.',
    );
  }

  const probe = classes[0];
  const equipmentReady = probe
    && Object.prototype.hasOwnProperty.call(probe, 'equipment_options');
  console.log(
    `Режим: ${APPLY ? 'APPLY' : 'dry-run'}; equipment_options `
    + `${equipmentReady ? 'ГОТОВО' : 'ждёт деплоя (пропуск)'}`,
  );
  const token = APPLY ? await login() : null;

  for (const [classCardNumber, [armor, weapon]] of Object.entries(TRAINING)) {
    const matches = classes.filter((entity) => (
      entity.card_number === classCardNumber && !entity.is_subclass
    ));
    if (matches.length !== 1) {
      console.warn(`НЕ НАЙДЕН/ДУБЛИРОВАН базовый класс ${classCardNumber}`);
      continue;
    }
    const characterClass = matches[0];
    const body = { armor_training: armor, weapon_proficiencies: weapon };
    const equipment = plans.get(classCardNumber)?.fields.equipment_options;
    if (equipmentReady && equipment) body.equipment_options = equipment;

    console.log(
      `${classCardNumber}: armor=${JSON.stringify(armor)} weapon=${JSON.stringify(weapon)}`
      + (equipment ? ` equipment=${JSON.stringify(equipment)}` : ''),
    );
    if (APPLY) await apiRequest(token, 'PUT', `/api/classes/${characterClass.id}`, body);
  }
  console.log('Готово.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
