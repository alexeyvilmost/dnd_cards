#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiRequest, apiUrl, fetchAll, login } from './api.mjs';
import { buildCertificationIndex, certificationHashes } from './certification-hash.mjs';
import { ENTITY_ENDPOINTS } from './micro-micro-gate.mjs';
import { CANTRIP_UPGRADES, EXPECTED_CANTRIP_NAMES } from './cantrips-2024.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const requireFromFrontend = createRequire(join(__dirname, '../../frontend/package.json'));
const Ajv = requireFromFrontend('ajv');
const APPLY = process.argv.includes('--apply');
const CERTIFICATION_VERSION = 'cantrips-2024-v1';
const NOTE = 'Проверено по полному каталогу заговоров D&D 2024 и контракту текущего движка.';

const schema = JSON.parse(readFileSync(
  join(__dirname, '../../frontend/src/schemas/mechanics.schema.json'),
  'utf8',
));
const ajv = new Ajv({ allErrors: true, strict: false });
const validateMechanics = ajv.compile(schema);

function normalized(value) {
  return String(value ?? '').trim().toLocaleLowerCase('ru').replaceAll('ё', 'е');
}

function spellUpdatePayload(spell, mechanics) {
  const writableFields = [
    'name',
    'description',
    'detailed_description',
    'image_url',
    'rarity',
    'card_number',
    'level',
    'school',
    'casting_time',
    'range',
    'component_verbal',
    'component_somatic',
    'component_material',
    'material_text',
    'duration',
    'classes',
    'subclasses',
    'attack_roll',
    'saving_throw',
    'concentration',
    'ritual',
    'resources',
    'save_types',
    'damage',
    'area',
    'is_healing',
    'heal_dice',
    'save_outcome',
    'upcast_description',
    'type',
    'author',
    'source',
    'tags',
    'is_extended',
  ];
  return {
    ...Object.fromEntries(
      writableFields
        .filter((field) => spell[field] !== undefined)
        .map((field) => [field, spell[field]]),
    ),
    mechanics,
  };
}

function assertCompleteCatalog(spells) {
  const cantrips = spells.filter((spell) => Number(spell.level) === 0);
  const expected = new Set(EXPECTED_CANTRIP_NAMES.map(normalized));
  const actual = new Map(cantrips.map((spell) => [normalized(spell.name), spell]));
  const missing = [...expected].filter((name) => !actual.has(name));
  const unexpected = [...actual.keys()].filter((name) => !expected.has(name));
  if (missing.length || unexpected.length || cantrips.length !== EXPECTED_CANTRIP_NAMES.length) {
    throw new Error([
      `Каталог заговоров изменился: ожидалось ${EXPECTED_CANTRIP_NAMES.length}, получено ${cantrips.length}.`,
      missing.length ? `Нет в API: ${missing.join(', ')}` : '',
      unexpected.length ? `Нет в манифесте: ${unexpected.join(', ')}` : '',
    ].filter(Boolean).join('\n'));
  }
  return cantrips;
}

function validateUpgrade(name, upgrade) {
  const card = {
    schema_version: '1.0',
    id: 'cantrip-validation',
    name,
    kind: 'spell',
    activation: upgrade.mechanics.activation,
    interactions: upgrade.mechanics.effects,
    targeting: upgrade.mechanics.targeting,
  };
  if (!validateMechanics(card)) {
    throw new Error(
      `${name}: mechanics не прошла schema validation:\n${JSON.stringify(validateMechanics.errors, null, 2)}`,
    );
  }
  if (
    upgrade.support.status === 'verified_partial'
    && !upgrade.support.limitations.some((item) => String(item).trim())
  ) {
    throw new Error(`${name}: verified_partial требует limitations`);
  }
}

async function fetchEntityGroups() {
  return Object.fromEntries(await Promise.all(
    Object.entries(ENTITY_ENDPOINTS).map(async ([entityType, [path, key]]) => [
      entityType,
      await fetchAll(path, key, { limit: 1000 }),
    ]),
  ));
}

async function certifyCantrips(token, cantrips, groups) {
  const key = process.env.CONTENT_CERTIFICATION_KEY?.trim();
  if (!key) throw new Error('Для --apply нужен CONTENT_CERTIFICATION_KEY');
  const index = buildCertificationIndex(groups);
  for (const spell of cantrips) {
    const upgrade = CANTRIP_UPGRADES[spell.name];
    const hashes = certificationHashes(spell, 'spell', index);
    const payload = {
      status: upgrade.support.status,
      content_hash: hashes.contentHash,
      dependency_hash: hashes.dependencyHash,
      certification_version: CERTIFICATION_VERSION,
      ...(upgrade.support.limitations.length
        ? { limitations: upgrade.support.limitations }
        : {}),
      note: NOTE,
    };
    const response = await fetch(`${apiUrl()}/api/content-support/spell/${spell.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Content-Certification-Key': key,
      },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Сертификация ${spell.name} → ${response.status}: ${text.slice(0, 500)}`);
    }
    console.log(`  ✓ ${spell.name}: ${payload.status}`);
  }
}

export async function runCantripUpgrade({ apply = APPLY } = {}) {
  for (const [name, upgrade] of Object.entries(CANTRIP_UPGRADES)) {
    validateUpgrade(name, upgrade);
  }

  const spells = await fetchAll('/api/spells', 'spells', { limit: 1000 });
  const cantrips = assertCompleteCatalog(spells);
  const byName = new Map(cantrips.map((spell) => [spell.name, spell]));
  console.log(`${apply ? 'APPLY' : 'DRY-RUN'} ${apiUrl()}: ${cantrips.length} заговоров`);

  if (!apply) {
    for (const name of EXPECTED_CANTRIP_NAMES) {
      const upgrade = CANTRIP_UPGRADES[name];
      console.log(`  ${name}: ${upgrade.support.status}`);
    }
    return { applied: false, count: cantrips.length };
  }

  if (!process.env.CONTENT_CERTIFICATION_KEY?.trim()) {
    throw new Error('Для атомарного обновления и сертификации нужен CONTENT_CERTIFICATION_KEY');
  }
  const token = await login();
  for (const name of EXPECTED_CANTRIP_NAMES) {
    const spell = byName.get(name);
    const upgrade = CANTRIP_UPGRADES[name];
    await apiRequest(
      token,
      'PUT',
      `/api/spells/${spell.id}`,
      spellUpdatePayload(spell, upgrade.mechanics),
    );
    console.log(`  ↻ ${name}`);
  }

  // Обновление mechanics инвалидирует старые хэши. Перечитываем весь каталог
  // после записи и только затем сертифицируем фактически сохранённые сущности.
  const groups = await fetchEntityGroups();
  const updatedCantrips = assertCompleteCatalog(groups.spell);
  await certifyCantrips(token, updatedCantrips, groups);
  return { applied: true, count: updatedCantrips.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runCantripUpgrade().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
