#!/usr/bin/env node
/**
 * Guarded materialization of the reviewed micro-MVP rules into content rows.
 *
 * Default/plan (read only):
 *   node scripts/content/migrate-micro-mvp-l1-mechanics.mjs \
 *     --bundle backups/micro-mvp-content-preimage.json
 *
 * Apply and rollback are deliberately impossible without a verified pg_dump
 * metadata file, an exact API acknowledgement, a reviewed plan bundle and an
 * API token. The bundle contains full API preimages for point rollback; it is
 * not a substitute for the independently restorable SQL dump.
 */
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { apiUrl, fetchAll, login } from './api.mjs';
import { canonicalJson, sha256Canonical } from './certification-hash.mjs';
import { microMvpCatalogFingerprint } from './micro-mvp-release-evidence.mjs';
import { assertPrivateRegularFile } from './private-artifact.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../..');
const PATCH_PATH = join(
  REPO_ROOT,
  'frontend/src/canon/data/micro-mvp-l1-content-patch.v1.json',
);
const SCHEMA_PATH = join(REPO_ROOT, 'frontend/src/schemas/mechanics.schema.json');
const PATCH_SCHEMA_PATH = join(
  REPO_ROOT,
  'frontend/src/canon/data/micro-mvp-l1-content-patch.schema.json',
);
const PRODUCTION_SOURCE_PATH = join(HERE, 'production-content-source.v1.json');
const require = createRequire(import.meta.url);
const Ajv = require(join(REPO_ROOT, 'frontend/node_modules/ajv/dist/ajv.js')).default;
const addFormats = require(join(REPO_ROOT, 'frontend/node_modules/ajv-formats/dist/index.js')).default;

const COLLECTION_ENDPOINTS = {
  cards: ['/api/cards', 'cards'],
  effects: ['/api/effects', 'effects'],
  actions: ['/api/actions', 'actions'],
  spells: ['/api/spells', 'spells'],
  races: ['/api/races', 'races'],
  classes: ['/api/classes', 'classes'],
};

const COLLECTION_ENTITY_TYPES = {
  cards: 'card',
  effects: 'effect',
  actions: 'action',
  spells: 'spell',
  races: 'race',
  classes: 'class',
};

const ROLLBACK_SERVER_MANAGED_FIELDS = new Set(['updated_at']);
const MIGRATION_BUNDLE_SCHEMA_VERSION = 4;
export const MIGRATION_WRITE_PROTOCOL = Object.freeze({
  exactUpdate: 'protected_exact_current_api_response_v1',
  atomicEffectCreate: 'server_issued_create_receipt_v1',
  exactSupportRestore: 'exact_current_api_response_v1',
  receiptHardDelete: 'server_issued_create_receipt_v1',
});
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const EFFECT_CREATE_FIELDS = [
  'name', 'name_en', 'description', 'detailed_description', 'image_url', 'rarity',
  'card_number', 'effect_type', 'condition_description', 'script', 'mechanics',
  'type', 'author', 'source', 'tags', 'price', 'weight', 'properties',
  'related_cards', 'related_actions', 'related_effects', 'repeatable', 'is_extended',
  'description_font_size', 'text_alignment', 'text_font_size',
  'show_detailed_description', 'detailed_description_alignment',
  'detailed_description_font_size',
];

const ALLOWED_PRIMITIVES = new Set([
  'temporary_hp_melee_retaliation',
  'burning_hands_objects',
  'dancing_lights_world',
  'detect_magic_world_sensing',
  'detect_poison_disease_world',
  'druidcraft_world',
  'find_familiar',
  'light_world_object',
  'magic_missile',
  'weapon_attack',
  'light_weapon_extra_attack',
  'mending_world',
  'minor_illusion_world_object',
  'pact_blade_bond',
  'pact_chain_familiar',
  'pact_tome_book',
  'prestidigitation_world',
  'purify_food_drink_world',
  'area_object_push',
]);
const ALLOWED_MASTERY_TYPES = new Set([
  'topple', 'sap', 'slow', 'nick', 'vex', 'push', 'cleave', 'graze',
]);

function parseArgs(argv) {
  const values = new Map();
  const flags = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) throw new Error(`Unknown positional argument: ${arg}`);
    if (['--apply', '--rollback', '--help'].includes(arg)) {
      flags.add(arg);
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
    values.set(arg, value);
    index += 1;
  }
  if (flags.has('--apply') && flags.has('--rollback')) {
    throw new Error('--apply and --rollback are mutually exclusive');
  }
  return {
    command: flags.has('--apply') ? 'apply' : flags.has('--rollback') ? 'rollback' : 'plan',
    bundlePath: values.get('--bundle'),
    backupMetadataPath: values.get('--backup-metadata'),
    confirmApi: values.get('--confirm-api'),
    help: flags.has('--help'),
  };
}

function cliHelp() {
  return `Guarded micro-MVP content migration

Plan (read-only):
  API_URL=https://... node scripts/content/migrate-micro-mvp-l1-mechanics.mjs \\
    --bundle backups/preimage.json

Apply (API_TOKEN or explicit content-admin credentials):
  API_URL=https://... API_TOKEN=... CONTENT_CERTIFICATION_KEY=... \\
  node scripts/content/migrate-micro-mvp-l1-mechanics.mjs --apply \\
    --bundle backups/preimage.json --backup-metadata backups/before.metadata.json \\
    --confirm-api https://...

Exact point rollback:
  API_URL=https://... API_TOKEN=... CONTENT_CERTIFICATION_KEY=... \\
  node scripts/content/migrate-micro-mvp-l1-mechanics.mjs --rollback \\
    --bundle backups/preimage.json --backup-metadata backups/before.metadata.json \\
    --confirm-api https://...

When API_TOKEN is absent, set CONTENT_ADMIN_USERNAME and CONTENT_ADMIN_PASSWORD;
login occurs only after bundle integrity and backup validation.
CONTENT_CERTIFICATION_KEY is required for every protected update/create/rollback.
Rollback restores every API field exactly except server-managed updated_at;
support is exact, and a null support preimage must remain null.

For a new apply, backup metadata must pin the exact Railway project/environment/
Postgres service/database from production-content-source.v1.json, prove a
custom-format archive restore, be no older than two hours, and predate the plan.
Resume/rollback retain the original SHA-pinned archive without the age limit.`;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function stableClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function same(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertSafeJsonValue(value, path, ancestors = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path}: number must be finite`);
    return;
  }
  if (typeof value !== 'object') {
    throw new Error(`${path}: value is not JSON-serializable`);
  }
  if (ancestors.has(value)) throw new Error(`${path}: cyclic value is not JSON-serializable`);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      value.forEach((item, index) => assertSafeJsonValue(item, `${path}[${index}]`, ancestors));
      return;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${path}: nested values must be plain JSON objects`);
    }
    if (Object.getOwnPropertySymbols(value).length) {
      throw new Error(`${path}: symbol keys are not JSON-serializable`);
    }
    for (const [key, nested] of Object.entries(value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) {
        throw new Error(`${path}.${key}: unsafe JSON object key`);
      }
      assertSafeJsonValue(nested, `${path}.${key}`, ancestors);
    }
  } finally {
    ancestors.delete(value);
  }
}

/**
 * Preserve the complete legacy JSON object. The protected endpoint writes a
 * raw JSONB object, so rollback must not reinterpret it through the current
 * certification schema or discard fields unknown to today's application.
 */
export function exactSupportRollbackRequest(support, label = 'support') {
  if (!support || typeof support !== 'object' || Array.isArray(support)) {
    throw new Error(`${label}: non-null support preimage must be an object`);
  }
  assertSafeJsonValue(support, label);
  return stableClone(support);
}

function rollbackComparable(entity) {
  return Object.fromEntries(Object.entries(entity).filter(
    ([key]) => !ROLLBACK_SERVER_MANAGED_FIELDS.has(key),
  ));
}

function rollbackContentBodyComparable(entity) {
  return Object.fromEntries(Object.entries(entity).filter(
    ([key]) => !ROLLBACK_SERVER_MANAGED_FIELDS.has(key) && key !== 'support',
  ));
}

function isRollbackContentBodyRestored(entity, operation) {
  return Boolean(entity) && same(
    rollbackContentBodyComparable(entity),
    rollbackContentBodyComparable(operation.before),
  );
}

function isRollbackFinalEquivalent(entity, operation) {
  return Boolean(entity)
    && Object.prototype.hasOwnProperty.call(entity, 'support')
    && same(rollbackComparable(entity), rollbackComparable(operation.before));
}

function assertRollbackContentEquivalent(restored, operation) {
  if (!restored) throw new Error(`${operation.id}: row is missing after rollback`);
  if (!Object.prototype.hasOwnProperty.call(restored, 'support')) {
    throw new Error(`${operation.id}: rollback response omitted support`);
  }
  if (operation.before.support == null && restored.support !== null) {
    throw new Error(`${operation.id}: rollback must preserve exact null support`);
  }
  if (!isRollbackFinalEquivalent(restored, operation)) {
    const fields = [...new Set([
      ...Object.keys(restored),
      ...Object.keys(operation.before),
    ])].filter((key) => (
      !ROLLBACK_SERVER_MANAGED_FIELDS.has(key)
      && !same(restored[key], operation.before[key])
    ));
    throw new Error(
      `${operation.id}: rollback content-equivalence failed outside server-managed updated_at`
      + `${fields.length ? ` (${fields.join(', ')})` : ''}`,
    );
  }
}

function sha256File(path) {
  const hash = createHash('sha256');
  hash.update(readFileSync(path));
  return hash.digest('hex');
}

export function writeMigrationBundleAtomic(path, value) {
  assertPrivateRegularFile(path, 'migration bundle', { allowMissing: true });
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let descriptor = null;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    renameSync(temporary, path);
    if (process.platform !== 'win32') {
      const directoryDescriptor = openSync(directory, 'r');
      try {
        fsyncSync(directoryDescriptor);
      } finally {
        closeSync(directoryDescriptor);
      }
    }
  } finally {
    if (descriptor !== null) closeSync(descriptor);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
  assertPrivateRegularFile(path, 'migration bundle');
}

const writeJsonAtomic = writeMigrationBundleAtomic;

export function readMigrationBundle(path) {
  if (!nonEmptyString(path)) throw new Error('--bundle must point to an existing migration bundle');
  const { path: resolved } = assertPrivateRegularFile(path, 'migration bundle');
  try {
    return JSON.parse(readFileSync(resolved, 'utf8'));
  } catch (error) {
    throw new Error(`migration bundle is not valid JSON: ${error.message}`);
  }
}

function projection(entity, desired) {
  return Object.fromEntries(Object.keys(desired).map((key) => [
    key,
    Object.prototype.hasOwnProperty.call(entity, key) ? entity[key] : null,
  ]));
}

function exactEntity(items, { entityId, cardNumber }, collection) {
  const byId = items.filter((item) => item.id === entityId);
  const byCard = items.filter((item) => item.card_number === cardNumber);
  if (byId.length !== 1 || byCard.length !== 1 || byId[0] !== byCard[0]) {
    throw new Error(
      `${collection}:${cardNumber}/${entityId}: exact identity is missing, duplicated, or split`,
    );
  }
  return byId[0];
}

function normalizeMechanicId(id) {
  return String(id || '').trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '')
    .toLowerCase() || 'draft';
}

function mechanicsSchemaValidator() {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(readJson(SCHEMA_PATH));
}

function walkRules(value, visitor, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkRules(item, visitor, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  visitor(value, path);
  for (const [key, nested] of Object.entries(value)) walkRules(nested, visitor, `${path}.${key}`);
}

export function validateMechanicsTargets(targets) {
  const validate = mechanicsSchemaValidator();
  const errors = [];
  for (const target of targets) {
    const mechanics = target.mechanics;
    if (!mechanics || typeof mechanics !== 'object' || Array.isArray(mechanics)) {
      errors.push(`${target.label}: mechanics must be an object`);
      continue;
    }
    const normalized = {
      schema_version: '1.0',
      id: normalizeMechanicId(target.cardNumber),
      name: target.name || target.cardNumber,
      kind: target.kind,
      activation: mechanics.activation || { mode: 'passive' },
      interactions: mechanics.effects || mechanics.interactions || [],
      ...(mechanics.uses ? { uses: mechanics.uses } : {}),
      ...(mechanics.targeting ? { targeting: mechanics.targeting } : {}),
      ...Object.fromEntries([
        'interaction', 'primitive', 'weapon_mastery', 'attack_replacement', 'rest_decision',
        'condition',
        'fighting_style',
        'capabilities', 'end_triggers',
        'includes', 'leaves', 'stacking', 'long_rest', 'thresholds', 'world_facts',
        'weapon_profile',
      ].flatMap((key) => (
        mechanics[key] === undefined ? [] : [[key, mechanics[key]]]
      ))),
    };
    if (!validate(normalized)) {
      errors.push(`${target.label}: ${JSON.stringify(validate.errors)}`);
    }
    walkRules(mechanics, (node, path) => {
      if (node.primitive && typeof node.primitive === 'object') {
        const type = node.primitive.type;
        if (!ALLOWED_PRIMITIVES.has(type)) {
          errors.push(`${target.label}:${path}.primitive: unsupported type ${String(type)}`);
        }
      }
      if (node.weapon_mastery && typeof node.weapon_mastery === 'object') {
        const type = node.weapon_mastery.type;
        if (!ALLOWED_MASTERY_TYPES.has(type)) {
          errors.push(`${target.label}:${path}.weapon_mastery: unsupported type ${String(type)}`);
        }
      }
    });
  }
  if (errors.length) throw new Error(`Mechanics validation failed:\n${errors.join('\n')}`);
}

export function validateContentPatchDeclaration(patch) {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(readJson(PATCH_SCHEMA_PATH));
  if (!validate(patch)) {
    throw new Error(`Content patch schema validation failed: ${JSON.stringify(validate.errors)}`);
  }
  const identities = [
    ...patch.mechanicsPatches.effects.map((item) => `effects:${item.cardNumber}`),
    ...(patch.mechanicsPatches.actions ?? []).map((item) => `actions:${item.cardNumber}`),
    ...patch.mechanicsPatches.spells.map((item) => `spells:${item.cardNumber}`),
    ...patch.fieldPatches.map((item) => `${item.collection}:${item.cardNumber}`),
    ...patch.createEntities.map((item) => `${item.collection}:${item.entity.card_number}`),
    ...patch.conditionPatches.map((item) => `effects:${item.cardNumber}`),
  ];
  const duplicated = [...new Set(identities.filter((identity, index) => (
    identities.indexOf(identity) !== index
  )))];
  if (duplicated.length) {
    throw new Error(`Content patch has duplicate entity declarations: ${duplicated.join(', ')}`);
  }
  for (const declaration of patch.fieldPatches) {
    const validateReferences = (fields, references, scope) => {
      const referenceIdentities = references.map((reference) => (
        `${reference.collection}:${reference.cardNumber}:${reference.entityId}`
      ));
      const duplicateReferences = [...new Set(referenceIdentities.filter((identity, index) => (
        referenceIdentities.indexOf(identity) !== index
      )))];
      if (duplicateReferences.length) {
        throw new Error(
          `${declaration.collection}:${declaration.cardNumber}: duplicate ${scope}entityReferences `
          + duplicateReferences.join(', '),
        );
      }

      const fieldStrings = [];
      const namedReferences = { card_id: [], mastery: [], mastery_effect_id: [] };
      const visit = (value, key = null) => {
        if (typeof value === 'string') {
          fieldStrings.push(value);
          if (key === 'card_id' || key === 'mastery' || key === 'mastery_effect_id') {
            namedReferences[key].push(value);
          }
          return;
        }
        if (Array.isArray(value)) {
          value.forEach((item) => visit(item, key));
          return;
        }
        if (!value || typeof value !== 'object') return;
        Object.entries(value).forEach(([nestedKey, nested]) => visit(nested, nestedKey));
      };
      visit(fields);

      for (const reference of references) {
        if (!fieldStrings.includes(reference.entityId)) {
          throw new Error(
            `${declaration.collection}:${declaration.cardNumber}: ${scope}entityReference `
            + `${reference.collection}:${reference.cardNumber}/${reference.entityId} is not used by ${scope}fields`,
          );
        }
      }
      for (const [field, collection] of [
        ['card_id', 'cards'],
        ['mastery', 'effects'],
        ['mastery_effect_id', 'effects'],
      ]) {
        const asserted = new Set(references
          .filter((reference) => reference.collection === collection)
          .map((reference) => reference.entityId));
        const missing = [...new Set(namedReferences[field])].filter((id) => !asserted.has(id));
        if (missing.length) {
          throw new Error(
            `${declaration.collection}:${declaration.cardNumber}: ${field} references lack stable `
            + `${collection} cardNumber/UUID assertions in ${scope}fields: ${missing.join(', ')}`,
          );
        }
      }
    };
    validateReferences(declaration.fields, declaration.entityReferences ?? [], '');
    if (declaration.productionFieldOverrides) {
      validateReferences(
        declaration.productionFieldOverrides,
        declaration.productionEntityReferences ?? [],
        'production ',
      );
    } else if ((declaration.productionEntityReferences ?? []).length > 0) {
      throw new Error(
        `${declaration.collection}:${declaration.cardNumber}: productionEntityReferences require productionFieldOverrides`,
      );
    }
  }
  for (const condition of patch.conditionPatches) {
    if (condition.createFields.card_number !== condition.cardNumber) {
      throw new Error(
        `Condition ${condition.cardNumber} createFields.card_number must match its identity`,
      );
    }
  }
}

export async function fetchMigrationCatalogs(options = {}) {
  const baseUrl = options.baseUrl || apiUrl();
  const entries = await Promise.all(Object.entries(COLLECTION_ENDPOINTS).map(
    async ([collection, [path, key]]) => [
      collection,
      await fetchAll(path, key, { baseUrl, limit: 100, fetchImpl: options.fetchImpl }),
    ],
  ));
  return Object.fromEntries(entries);
}

function operationBase(collection, entity, request, operation) {
  const desiredProjection = projection(request, request);
  return {
    id: `${collection}:${entity?.card_number ?? request.card_number}:${operation}`,
    collection,
    operation,
    entityId: entity?.id ?? null,
    cardNumber: entity?.card_number ?? request.card_number,
    before: entity ? stableClone(entity) : null,
    beforeHash: entity ? sha256Canonical(entity) : null,
    request: stableClone(request),
    desiredProjection,
    desiredProjectionHash: sha256Canonical(desiredProjection),
    state: 'planned',
  };
}

/**
 * Migration updates are sent only through the protected exact-current CAS
 * endpoint. Unlike the ordinary PUT-shaped CRUD endpoints, omitted fields are
 * never implicit commands, including name_en and nullable strings.
 */
function exactUpdateFields(declaredFields) {
  return stableClone(declaredFields);
}

function containsExactString(value, expected) {
  if (typeof value === 'string') return value === expected;
  if (Array.isArray(value)) return value.some((item) => containsExactString(item, expected));
  if (!value || typeof value !== 'object') return false;
  return Object.values(value).some((item) => containsExactString(item, expected));
}

export function assertDependencySafeInterruptionPrefixes(operations) {
  const indexByID = new Map(operations.map((operation, index) => [operation.id, index]));
  const providers = operations.filter((operation) => operation.operation === 'create');
  for (const operation of operations) {
    const computedDependencies = providers
      .filter((provider) => provider.id !== operation.id
        && containsExactString(operation.request, provider.cardNumber))
      .map((provider) => provider.id)
      .sort();
    const declaredDependencies = [...(operation.providerOperationIds ?? [])].sort();
    if (!same(computedDependencies, declaredDependencies)) {
      throw new Error(`${operation.id}: declared provider dependencies do not match its request`);
    }
    if (operation.operation === 'update') {
      const rollbackDangling = providers.find((provider) => (
        containsExactString(operation.before, provider.cardNumber)
      ));
      if (rollbackDangling) {
        throw new Error(
          `${operation.id}: rollback preimage already references created provider ${rollbackDangling.id}`,
        );
      }
    }
    for (const providerID of operation.providerOperationIds ?? []) {
      const providerIndex = indexByID.get(providerID);
      const consumerIndex = indexByID.get(operation.id);
      if (providerIndex === undefined || operations[providerIndex].operation !== 'create') {
        throw new Error(`${operation.id}: dependency ${providerID} is not a create/provider operation`);
      }
      if (providerIndex >= consumerIndex) {
        throw new Error(`${operation.id}: provider ${providerID} must precede its consumer`);
      }
    }
  }

  // Any process interruption after an apply prefix must leave every active
  // consumer with its provider already present.
  for (let prefix = 0; prefix <= operations.length; prefix += 1) {
    for (let consumerIndex = 0; consumerIndex < prefix; consumerIndex += 1) {
      for (const providerID of operations[consumerIndex].providerOperationIds ?? []) {
        if (indexByID.get(providerID) >= prefix) {
          throw new Error(`apply prefix ${prefix} leaves ${operations[consumerIndex].id} dangling`);
        }
      }
    }
  }

  // Rollback executes the exact reverse. A provider cannot be removed while a
  // consumer is still in its applied (provider-referencing) state.
  const rollbackOrder = [...operations].reverse();
  for (let prefix = 0; prefix <= rollbackOrder.length; prefix += 1) {
    const rolledBack = new Set(rollbackOrder.slice(0, prefix).map((operation) => operation.id));
    for (const consumer of operations) {
      if (rolledBack.has(consumer.id)) continue;
      for (const providerID of consumer.providerOperationIds ?? []) {
        if (rolledBack.has(providerID)) {
          throw new Error(`rollback prefix ${prefix} leaves ${consumer.id} dangling`);
        }
      }
    }
  }
}

export function dependencySafeOperationOrder(operations) {
  const providers = operations.filter((operation) => operation.operation === 'create');
  const annotated = operations.map((operation) => {
    const providerOperationIds = providers
      .filter((provider) => provider.id !== operation.id
        && containsExactString(operation.request, provider.cardNumber))
      .map((provider) => provider.id);
    if (operation.operation === 'update') {
      const rollbackDangling = providers.find((provider) => (
        containsExactString(operation.before, provider.cardNumber)
      ));
      if (rollbackDangling) {
        throw new Error(
          `${operation.id}: rollback preimage already references created provider ${rollbackDangling.id}`,
        );
      }
    }
    return { ...operation, providerOperationIds };
  });

  const pendingCreates = annotated.filter((operation) => operation.operation === 'create');
  const orderedCreates = [];
  const placed = new Set();
  while (pendingCreates.length) {
    const nextIndex = pendingCreates.findIndex((operation) => (
      operation.providerOperationIds.every((providerID) => placed.has(providerID))
    ));
    if (nextIndex < 0) throw new Error('Created content providers contain a dependency cycle');
    const [next] = pendingCreates.splice(nextIndex, 1);
    orderedCreates.push(next);
    placed.add(next.id);
  }
  const ordered = [
    ...orderedCreates,
    ...annotated.filter((operation) => operation.operation === 'update'),
  ];
  assertDependencySafeInterruptionPrefixes(ordered);
  return ordered;
}

function immutableOperationPlan(operation) {
  return {
    id: operation.id,
    collection: operation.collection,
    operation: operation.operation,
    entityId: operation.before?.id ?? null,
    cardNumber: operation.cardNumber,
    before: operation.before,
    beforeHash: operation.beforeHash,
    request: operation.request,
    desiredProjection: operation.desiredProjection,
    desiredProjectionHash: operation.desiredProjectionHash,
    providerOperationIds: operation.providerOperationIds ?? [],
  };
}

function immutableBundlePlan(bundle) {
  return {
    schemaVersion: bundle.schemaVersion,
    kind: bundle.kind,
    bundleId: bundle.bundleId,
    createdAt: bundle.createdAt,
    apiBase: bundle.apiBase,
    patch: bundle.patch,
    writeProtocol: bundle.writeProtocol,
    catalogFingerprint: bundle.catalogFingerprint,
    operations: bundle.operations.map(immutableOperationPlan),
  };
}

export function migrationPlanHash(bundle) {
  return sha256Canonical(immutableBundlePlan(bundle));
}

function assertMigrationPlanIntegrity(bundle) {
  if (bundle.schemaVersion !== MIGRATION_BUNDLE_SCHEMA_VERSION
    || bundle.kind !== 'micro-mvp-production-content-preimage'
    || !UUID_PATTERN.test(bundle.bundleId ?? '')) {
    throw new Error(
      `Migration bundle must use schemaVersion ${MIGRATION_BUNDLE_SCHEMA_VERSION} with a server-ledger UUID`,
    );
  }
  if (!same(bundle.writeProtocol, MIGRATION_WRITE_PROTOCOL)) {
    throw new Error('Migration bundle write protocol is missing or unsupported');
  }
  parsedUtc(bundle.createdAt, 'migration bundle createdAt');
  const fingerprintCollections = Object.keys(bundle.catalogFingerprint?.counts ?? {}).sort();
  const expectedCollections = Object.keys(COLLECTION_ENDPOINTS).sort();
  if (!/^sha256:[0-9a-f]{64}$/.test(bundle.catalogFingerprint?.hash ?? '')) {
    throw new Error('Migration bundle is missing the full catalog fingerprint');
  }
  if (!same(fingerprintCollections, expectedCollections)
    || Object.values(bundle.catalogFingerprint.counts).some((count) => (
      !Number.isSafeInteger(count) || count < 0
    ))) {
    throw new Error('Migration bundle catalog fingerprint counts are invalid');
  }
  if (!bundle.planHash || bundle.planHash !== migrationPlanHash(bundle)) {
    throw new Error('Migration bundle plan integrity hash is missing or invalid');
  }
  assertDependencySafeInterruptionPrefixes(bundle.operations);
}

export function buildMigrationOperations(catalogs, patch) {
  validateContentPatchDeclaration(patch);
  const operations = [];
  const mechanicsTargets = [];
  for (const collection of ['effects', 'actions', 'spells']) {
    const kind = collection === 'effects'
      ? 'passive_effect'
      : collection === 'actions' ? 'action' : 'spell';
    for (const declaration of patch.mechanicsPatches[collection] ?? []) {
      const entity = exactEntity(catalogs[collection], declaration, collection);
      mechanicsTargets.push({
        label: `${collection}:${declaration.cardNumber}`,
        cardNumber: declaration.cardNumber,
        name: entity.name,
        kind,
        mechanics: declaration.mechanics,
      });
      if (same(entity.mechanics ?? null, declaration.mechanics)) continue;
      const beforeHash = sha256Canonical(entity.mechanics ?? null);
      const expectedBeforeHash = declaration.productionExpectedBeforeMechanicsHash
        ?? declaration.expectedBeforeMechanicsHash;
      if (beforeHash !== expectedBeforeHash) {
        throw new Error(
          `${collection}:${declaration.cardNumber}: reviewed production before mechanics hash `
          + `${expectedBeforeHash}, live ${beforeHash}`,
        );
      }
      const request = exactUpdateFields({ mechanics: declaration.mechanics });
      operations.push(operationBase(collection, entity, request, 'update'));
    }
  }

  for (const declaration of patch.fieldPatches) {
    const entity = exactEntity(catalogs[declaration.collection], declaration, declaration.collection);
    const targetFields = declaration.productionFieldOverrides
      ? { ...declaration.fields, ...declaration.productionFieldOverrides }
      : declaration.fields;
    for (const reference of [
      ...(declaration.entityReferences ?? []),
      ...(declaration.productionEntityReferences ?? []),
    ]) {
      if (!Array.isArray(catalogs[reference.collection])) {
        throw new Error(
          `${declaration.collection}:${declaration.cardNumber}: missing `
          + `${reference.collection} catalog for entityReference validation`,
        );
      }
      exactEntity(catalogs[reference.collection], reference, reference.collection);
    }
    const current = projection(entity, targetFields);
    if (declaration.collection === 'cards' && targetFields.mechanics !== undefined) {
      mechanicsTargets.push({
        label: `${declaration.collection}:${declaration.cardNumber}`,
        cardNumber: declaration.cardNumber,
        name: entity.name,
        kind: 'passive_effect',
        mechanics: targetFields.mechanics,
      });
    }
    if (same(current, targetFields)) continue;
    const beforeHash = sha256Canonical(current);
    const expectedBeforeHash = declaration.productionExpectedBeforeFieldsHash
      ?? declaration.expectedBeforeFieldsHash;
    if (beforeHash !== expectedBeforeHash) {
      throw new Error(
        `${declaration.collection}:${declaration.cardNumber}: reviewed production before fields hash `
        + `${expectedBeforeHash}, live ${beforeHash}`,
      );
    }
    operations.push(operationBase(
      declaration.collection,
      entity,
      exactUpdateFields(targetFields),
      'update',
    ));
  }

  for (const declaration of patch.createEntities) {
    const matches = catalogs.effects.filter((entity) => (
      entity.card_number === declaration.entity.card_number
    ));
    if (matches.length > 1) throw new Error(`effects:${declaration.entity.card_number}: duplicate rows`);
    const request = Object.fromEntries(EFFECT_CREATE_FIELDS.flatMap((key) => (
      Object.prototype.hasOwnProperty.call(declaration.entity, key)
        ? [[key, declaration.entity[key]]]
        : []
    )));
    mechanicsTargets.push({
      label: `effects:${declaration.entity.card_number}`,
      cardNumber: declaration.entity.card_number,
      name: declaration.entity.name,
      kind: 'passive_effect',
      mechanics: declaration.entity.mechanics,
    });
    if (matches.length === 1) {
      const current = projection(matches[0], request);
      if (!same(current, request)) {
        throw new Error(
          `effects:${declaration.entity.card_number}: create identity exists with unreviewed fields`,
        );
      }
      continue;
    }
    operations.push(operationBase('effects', null, request, 'create'));
  }

  for (const declaration of patch.conditionPatches) {
    const matches = catalogs.effects.filter((entity) => (
      entity.card_number === declaration.cardNumber
    ));
    if (matches.length > 1) throw new Error(`effects:${declaration.cardNumber}: duplicate rows`);
    const current = matches[0] ?? null;
    mechanicsTargets.push({
      label: `effects:${declaration.cardNumber}`,
      cardNumber: declaration.cardNumber,
      name: declaration.fields.name,
      kind: 'passive_effect',
      mechanics: declaration.fields.mechanics,
    });
    if (current) {
      if (declaration.entityId && current.id !== declaration.entityId) {
        throw new Error(
          `effects:${declaration.cardNumber}: expected id ${declaration.entityId}, got ${current.id}`,
        );
      }
      const currentFields = projection(current, declaration.fields);
      if (same(currentFields, declaration.fields)) continue;
      const beforeHash = sha256Canonical(currentFields);
      const expectedBeforeHash = declaration.productionExpectedBeforeFieldsHash
        ?? declaration.expectedBeforeFieldsHash;
      if (beforeHash !== expectedBeforeHash) {
        throw new Error(
          `effects:${declaration.cardNumber}: reviewed production before condition fields hash `
          + `${expectedBeforeHash}, live ${beforeHash}`,
        );
      }
      operations.push(operationBase(
        'effects',
        current,
        exactUpdateFields(declaration.fields),
        'update',
      ));
    } else {
      if (declaration.entityId) {
        throw new Error(`effects:${declaration.cardNumber}: reviewed condition row is absent`);
      }
      operations.push(operationBase('effects', null, declaration.createFields, 'create'));
    }
  }

  validateMechanicsTargets(mechanicsTargets);
  return dependencySafeOperationOrder(operations);
}

function currentPatch() {
  const patch = readJson(PATCH_PATH);
  return { patch, patchHash: sha256Canonical(patch) };
}

function selectedPatch(patchDeclaration) {
  if (!patchDeclaration) return currentPatch();
  validateContentPatchDeclaration(patchDeclaration);
  return { patch: patchDeclaration, patchHash: sha256Canonical(patchDeclaration) };
}

export async function createMigrationBundle(options = {}) {
  const baseUrl = options.baseUrl || apiUrl();
  const { patch, patchHash } = selectedPatch(options.patchDeclaration);
  const catalogs = options.catalogs || await fetchMigrationCatalogs({
    baseUrl,
    fetchImpl: options.fetchImpl,
  });
  const operations = buildMigrationOperations(catalogs, patch);
  const bundle = {
    schemaVersion: MIGRATION_BUNDLE_SCHEMA_VERSION,
    kind: 'micro-mvp-production-content-preimage',
    bundleId: randomUUID(),
    status: 'planned',
    createdAt: options.createdAt ?? new Date().toISOString(),
    apiBase: baseUrl,
    patch: {
      id: patch.patchId,
      version: patch.patchVersion,
      hash: patchHash,
      path: 'frontend/src/canon/data/micro-mvp-l1-content-patch.v1.json',
    },
    writeProtocol: stableClone(MIGRATION_WRITE_PROTOCOL),
    catalogFingerprint: microMvpCatalogFingerprint(catalogs),
    backup: null,
    operations,
  };
  bundle.planHash = migrationPlanHash(bundle);
  return bundle;
}

function parsedUtc(value, label) {
  if (typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)) {
    throw new Error(`${label} must be an explicit UTC RFC3339 timestamp`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} is invalid`);
  return parsed;
}

export function verifyBackupMetadata(path, { requireRecent = true, now = new Date() } = {}) {
  if (!path) throw new Error('--backup-metadata must point to an existing file');
  const metadataFile = assertPrivateRegularFile(path, '--backup-metadata');
  const metadata = readJson(metadataFile.path);
  const expectedSource = readJson(PRODUCTION_SOURCE_PATH);
  if (expectedSource?.schemaVersion !== 1
    || expectedSource.provider !== 'Railway'
    || !UUID_PATTERN.test(expectedSource.projectId ?? '')
    || !UUID_PATTERN.test(expectedSource.environmentId ?? '')
    || !UUID_PATTERN.test(expectedSource.serviceId ?? '')
    || expectedSource.database !== 'railway'
    || expectedSource.requiredRestorePostgresMajor !== 17
    || expectedSource.maximumBackupAgeSeconds !== 7_200
    || expectedSource.maximumRestoreLagSeconds !== 1_800
    || expectedSource.maximumFutureClockSkewSeconds !== 300) {
    throw new Error('Versioned Railway production backup policy is invalid or unexpectedly relaxed');
  }
  const actualSource = metadata?.source;
  for (const [field, expected] of Object.entries({
    provider: expectedSource.provider,
    project_id: expectedSource.projectId,
    environment_id: expectedSource.environmentId,
    service_id: expectedSource.serviceId,
    database: expectedSource.database,
  })) {
    if (actualSource?.[field] !== expected) {
      throw new Error(`Backup Railway source identity mismatch for ${field}`);
    }
  }
  const archive = metadata?.archive;
  if (archive?.format !== 'custom') throw new Error('Backup must be a custom-format pg_dump');
  if (!nonEmptyString(archive.file)
    || !Number.isSafeInteger(archive.size_bytes) || archive.size_bytes <= 5
    || !/^[0-9a-f]{64}$/.test(archive.sha256 ?? '')) {
    throw new Error('Backup archive metadata is incomplete or invalid');
  }
  if (!Number.isSafeInteger(archive.toc_entries) || archive.toc_entries <= 0) {
    throw new Error('Backup metadata must record a positive pg_restore TOC entry count');
  }
  const restore = metadata?.restore_verification;
  if (restore?.pg_restore_exit_on_error !== true || !restore?.verified_at_utc) {
    throw new Error('Backup metadata does not prove a successful --exit-on-error restore');
  }
  const restoredPostgres = restore.postgres;
  if (!Number.isSafeInteger(restoredPostgres?.major)
    || restoredPostgres.major !== expectedSource.requiredRestorePostgresMajor
    || !nonEmptyString(restoredPostgres?.version)
    || !new RegExp(`^${restoredPostgres.major}\\.[0-9]+(?:\\.[0-9]+)?(?:\\s|$)`)
      .test(restoredPostgres.version.trim())) {
    throw new Error(
      `Backup restore must record PostgreSQL major ${expectedSource.requiredRestorePostgresMajor} `
      + 'and an explicit matching version',
    );
  }
  const rowCounts = restore.row_counts;
  if (!rowCounts || typeof rowCounts !== 'object' || Array.isArray(rowCounts)
    || Object.keys(rowCounts).length === 0
    || Object.entries(rowCounts).some(([table, count]) => (
      !/^[a-z_][a-z0-9_]*$/.test(table)
      || !Number.isSafeInteger(count)
      || count < 0
    ))
    || !Object.values(rowCounts).some((count) => count > 0)
    || !nonEmptyString(restore.row_counts_captured_at_utc)) {
    throw new Error('Backup restore must record non-empty control row counts and capture time');
  }
  const archivePath = isAbsolute(archive.file)
    ? archive.file
    : join(dirname(metadataFile.path), archive.file);
  const archiveFile = assertPrivateRegularFile(archivePath, 'backup archive');
  if (archiveFile.stat.size !== archive.size_bytes) {
    throw new Error('Backup archive size differs from metadata');
  }
  if (readFileSync(archivePath).subarray(0, 5).toString('ascii') !== 'PGDMP') {
    throw new Error('Backup archive does not have the PostgreSQL custom-format signature');
  }
  const hash = sha256File(archivePath);
  if (hash !== archive.sha256) throw new Error('Backup archive SHA-256 differs from metadata');
  const createdAtMs = parsedUtc(metadata.created_at_utc, 'backup created_at_utc');
  const restoreVerifiedAtMs = parsedUtc(
    restore.verified_at_utc,
    'backup restore verified_at_utc',
  );
  const rowCountsCapturedAtMs = parsedUtc(
    restore.row_counts_captured_at_utc,
    'backup restore row_counts_captured_at_utc',
  );
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(nowMs)) throw new Error('Backup verification clock is invalid');
  const futureSkewMs = expectedSource.maximumFutureClockSkewSeconds * 1000;
  if (createdAtMs > nowMs + futureSkewMs
    || restoreVerifiedAtMs > nowMs + futureSkewMs
    || rowCountsCapturedAtMs > nowMs + futureSkewMs) {
    throw new Error('Backup or restore proof timestamp is in the future');
  }
  if (restoreVerifiedAtMs < createdAtMs
    || rowCountsCapturedAtMs < restoreVerifiedAtMs
    || rowCountsCapturedAtMs - createdAtMs > expectedSource.maximumRestoreLagSeconds * 1000) {
    throw new Error('Backup restore proof is temporally inconsistent with the archive');
  }
  if (requireRecent && nowMs - createdAtMs > expectedSource.maximumBackupAgeSeconds * 1000) {
    throw new Error('Backup is stale for a new apply; take and restore-check a fresh Railway dump');
  }
  return {
    metadataPath: metadataFile.path,
    archivePath: archiveFile.path,
    sha256: hash,
    createdAt: metadata.created_at_utc,
    restoreVerifiedAt: restore.row_counts_captured_at_utc,
    pgRestoreCompletedAt: restore.verified_at_utc,
    tocEntries: archive.toc_entries,
    restoredPostgres: stableClone(restoredPostgres),
    rowCounts: stableClone(rowCounts),
    source: {
      provider: actualSource.provider,
      projectId: actualSource.project_id,
      environmentId: actualSource.environment_id,
      serviceId: actualSource.service_id,
      database: actualSource.database,
    },
  };
}

function assertBackupPredatesPlan(backup, bundle) {
  const restoreVerifiedAt = parsedUtc(backup.restoreVerifiedAt, 'backup restoreVerifiedAt');
  const planCreatedAt = parsedUtc(bundle.createdAt, 'migration bundle createdAt');
  if (restoreVerifiedAt > planCreatedAt) {
    throw new Error('Backup restore proof must predate the reviewed migration plan');
  }
}

function headers(token) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

function protectedHeaders(token, certificationKey) {
  return {
    ...headers(token),
    'X-Content-Certification-Key': certificationKey,
  };
}

async function protectedRequest(
  baseUrl,
  token,
  certificationKey,
  method,
  path,
  body,
  fetchImpl = globalThis.fetch,
) {
  const response = await fetchImpl(`${baseUrl}${path}`, {
    method,
    headers: protectedHeaders(token, certificationKey),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${path}: ${response.status} ${responseText.slice(0, 500)}`);
  }
  return responseText ? JSON.parse(responseText) : null;
}

async function resolveMigrationToken(options, phase) {
  if (nonEmptyString(options.token)) return options.token.trim();
  if (typeof options.loginProvider === 'function') {
    const token = await options.loginProvider();
    if (nonEmptyString(token)) return token.trim();
  }
  throw new Error(`API_TOKEN or explicit content-admin credentials are required for ${phase}`);
}

function entityMap(catalogs, collection) {
  return new Map(catalogs[collection].map((entity) => [entity.card_number, entity]));
}

export function assertMigrationApiContract(catalogs) {
  for (const [collection, rows] of Object.entries(catalogs)) {
    const missingSupport = rows.find((row) => !Object.prototype.hasOwnProperty.call(row, 'support'));
    if (missingSupport) {
      throw new Error(
        `${collection[0].toUpperCase()}${collection.slice(1)} API response is not rollback-complete `
        + `(missing support on ${missingSupport.card_number ?? missingSupport.id})`,
      );
    }
  }
  const sample = catalogs.effects?.[0];
  if (!sample) throw new Error('Effects API returned no rows for migration contract check');
  const requiredEffectResponseFields = [
    'author', 'source', 'related_cards', 'related_actions', 'related_effects',
  ];
  const missing = requiredEffectResponseFields.filter((key) => (
    !Object.prototype.hasOwnProperty.call(sample, key)
  ));
  if (missing.length) {
    throw new Error(
      `Effects API response is not rollback-complete (missing ${missing.join(', ')}); `
      + 'deploy the full EffectResponse contract and create a fresh plan bundle',
    );
  }
  const actionSample = catalogs.actions?.[0];
  if (!actionSample) throw new Error('Actions API returned no rows for migration contract check');
  const requiredActionResponseFields = [
    'author', 'source', 'related_cards', 'related_actions',
  ];
  const missingActionFields = requiredActionResponseFields.filter((key) => (
    !Object.prototype.hasOwnProperty.call(actionSample, key)
  ));
  if (missingActionFields.length) {
    throw new Error(
      `Actions API response is not rollback-complete (missing ${missingActionFields.join(', ')}); `
      + 'deploy the full ActionResponse contract and create a fresh plan bundle',
    );
  }
}

async function assertPlanPreimages(bundle, catalogs) {
  for (const operation of bundle.operations) {
    const current = entityMap(catalogs, operation.collection).get(operation.cardNumber) ?? null;
    if (operation.operation === 'create') {
      if (current) throw new Error(`${operation.id}: row appeared after plan; refusing create`);
      continue;
    }
    if (!current || current.id !== operation.entityId) {
      throw new Error(`${operation.id}: identity changed after plan`);
    }
    const hash = sha256Canonical(current);
    if (hash !== operation.beforeHash) {
      throw new Error(`${operation.id}: full preimage drift ${operation.beforeHash} -> ${hash}`);
    }
  }
}

async function refetchEntity(baseUrl, collection, cardNumber, fetchImpl = globalThis.fetch) {
  const [path, key] = COLLECTION_ENDPOINTS[collection];
  const rows = await fetchAll(path, key, { baseUrl, limit: 100, fetchImpl });
  const matches = rows.filter((entity) => entity.card_number === cardNumber);
  if (matches.length > 1) throw new Error(`${collection}:${cardNumber}: duplicate post-write rows`);
  return matches[0] ?? null;
}

async function createEffectWithServerReceipt(bundle, operation, options) {
  const result = await protectedRequest(
    options.baseUrl,
    options.token,
    options.certificationKey,
    'POST',
    `/api/content-migrations/${encodeURIComponent(bundle.bundleId)}/effects`,
    {
      schema_version: 1,
      plan_hash: bundle.planHash,
      operation_id: operation.id,
      entity: operation.request,
    },
    options.fetchImpl,
  );
  const entity = result?.entity;
  const receipt = result?.rollback;
  if (!entity || entity.card_number !== operation.cardNumber || !UUID_PATTERN.test(entity.id ?? '')) {
    throw new Error(`${operation.id}: atomic create returned an invalid entity identity`);
  }
  if (!receipt
    || receipt.bundle_id !== bundle.bundleId
    || receipt.plan_hash !== bundle.planHash
    || receipt.operation_id !== operation.id
    || receipt.entity_id !== entity.id
    || receipt.card_number !== operation.cardNumber
    || !UUID_PATTERN.test(receipt.receipt_id ?? '')
    || !/^sha256:[0-9a-f]{64}$/.test(receipt.postimage_hash ?? '')) {
    throw new Error(`${operation.id}: server-issued rollback receipt is missing or invalid`);
  }
  return { entity, receipt };
}

async function exactUpdateWithCAS(bundle, operation, expectedCurrent, fields, options) {
  const entityType = COLLECTION_ENTITY_TYPES[operation.collection];
  const result = await protectedRequest(
    options.baseUrl,
    options.token,
    options.certificationKey,
    'POST',
    `/api/content-migrations/${encodeURIComponent(bundle.bundleId)}`
      + `/${entityType}/${encodeURIComponent(operation.entityId)}/exact-update`,
    {
      schema_version: 1,
      plan_hash: bundle.planHash,
      operation_id: operation.id,
      card_number: operation.cardNumber,
      expected_current: expectedCurrent,
      fields,
    },
    options.fetchImpl,
  );
  const entity = result?.entity;
  if (result?.schema_version !== 1
    || result?.cas !== MIGRATION_WRITE_PROTOCOL.exactUpdate
    || result?.entity_type !== entityType
    || result?.entity_id !== operation.entityId
    || result?.card_number !== operation.cardNumber
    || typeof result?.already_applied !== 'boolean'
    || !entity
    || entity.id !== operation.entityId
    || entity.card_number !== operation.cardNumber) {
    throw new Error(`${operation.id}: protected exact update returned an invalid response`);
  }
  return { entity, alreadyApplied: result.already_applied };
}

async function restoreSupportWithCAS(operation, current, support, options) {
  const entityType = COLLECTION_ENTITY_TYPES[operation.collection];
  await protectedRequest(
    options.baseUrl,
    options.token,
    options.certificationKey,
    'POST',
    `/api/content-rollback/${entityType}/${encodeURIComponent(operation.entityId)}/support`,
    {
      schema_version: 1,
      expected_current: current,
      support,
    },
    options.fetchImpl,
  );
}

async function hardDeleteCreatedEffect(bundle, operation, options) {
  const receipt = operation.createReceipt;
  if (!receipt) throw new Error(`${operation.id}: server-issued create receipt is missing`);
  await protectedRequest(
    options.baseUrl,
    options.token,
    options.certificationKey,
    'POST',
    `/api/content-rollback/effect/${encodeURIComponent(operation.entityId)}/hard-delete-created`,
    {
      schema_version: 1,
      bundle_id: bundle.bundleId,
      plan_hash: bundle.planHash,
      operation_id: operation.id,
      card_number: operation.cardNumber,
      expected_current_hash: receipt.postimage_hash,
    },
    options.fetchImpl,
  );
}

function assertCreateReceipt(bundle, operation) {
  const receipt = operation.createReceipt;
  if (!receipt
    || receipt.bundle_id !== bundle.bundleId
    || receipt.plan_hash !== bundle.planHash
    || receipt.operation_id !== operation.id
    || receipt.entity_id !== operation.entityId
    || receipt.card_number !== operation.cardNumber
    || !UUID_PATTERN.test(receipt.receipt_id ?? '')
    || !/^sha256:[0-9a-f]{64}$/.test(receipt.postimage_hash ?? '')) {
    throw new Error(`${operation.id}: exact rollback requires its server-issued create receipt`);
  }
  return receipt;
}

const APPLY_RESUMABLE_BUNDLE_STATUSES = new Set(['planned', 'applying', 'partial']);
const APPLY_PERSISTED_OPERATION_STATES = new Set([
  'planned',
  'writing',
  'not-applied',
  'write-outcome-unknown',
  'applied-unverified',
  'applied',
]);

function currentCatalogEntity(catalogs, operation) {
  return entityMap(catalogs, operation.collection).get(operation.cardNumber) ?? null;
}

function updateApplyComparable(entity, operation) {
  const changed = new Set([...Object.keys(operation.request), 'support', 'updated_at']);
  return Object.fromEntries(Object.entries(entity).filter(([key]) => !changed.has(key)));
}

function isRecognizedUpdatePostimage(current, operation) {
  return Boolean(current)
    && current.id === operation.entityId
    && Object.prototype.hasOwnProperty.call(current, 'support')
    && current.support === null
    && same(projection(current, operation.desiredProjection), operation.desiredProjection)
    && same(updateApplyComparable(current, operation), updateApplyComparable(operation.before, operation));
}

function assertCapturedApplyPostimage(bundle, operation, current) {
  if (!current || !operation.afterHash || sha256Canonical(current) !== operation.afterHash) {
    throw new Error(`${operation.id}: persisted apply postimage drift`);
  }
  if (operation.entityId !== current.id) {
    throw new Error(`${operation.id}: persisted apply identity drift`);
  }
  if (!same(projection(current, operation.desiredProjection), operation.desiredProjection)) {
    throw new Error(`${operation.id}: exact post-apply projection verification failed`);
  }
  if (operation.operation === 'create') assertCreateReceipt(bundle, operation);
}

function persistUnverifiedApplyPostimage(bundle, operation, current, bundlePath) {
  operation.entityId = current.id;
  operation.after = stableClone(current);
  operation.afterHash = sha256Canonical(current);
  operation.state = 'applied-unverified';
  delete operation.probeFailure;
  writeJsonAtomic(bundlePath, bundle);
}

function captureAppliedPostimage(bundle, operation, current, bundlePath) {
  persistUnverifiedApplyPostimage(bundle, operation, current, bundlePath);
  assertCapturedApplyPostimage(bundle, operation, current);
  operation.state = 'applied';
  writeJsonAtomic(bundlePath, bundle);
}

async function reconcilePersistedApply(bundle, catalogs, options) {
  const createRecoveries = [];
  for (const operation of bundle.operations) {
    if (!APPLY_PERSISTED_OPERATION_STATES.has(operation.state)) {
      throw new Error(`${operation.id}: unsupported persisted apply state ${String(operation.state)}`);
    }
    const current = currentCatalogEntity(catalogs, operation);
    switch (operation.state) {
      case 'planned':
      case 'not-applied': {
        if (operation.operation === 'create') {
          if (current) throw new Error(`${operation.id}: row exists before its persisted create phase`);
        } else if (!current || sha256Canonical(current) !== operation.beforeHash) {
          throw new Error(`${operation.id}: preimage drift before resumed write`);
        }
        if (operation.state === 'not-applied') {
          operation.state = 'planned';
          delete operation.probeFailure;
          writeJsonAtomic(options.bundlePath, bundle);
        }
        break;
      }
      case 'writing':
      case 'write-outcome-unknown': {
        if (operation.operation === 'create') {
          if (current && operation.entityId && current.id !== operation.entityId) {
            throw new Error(`${operation.id}: persisted create identity drift`);
          }
          // A present row or a persisted receipt must be reconciled through
          // the server ledger before any new content mutation. An absent row
          // without a receipt is safe to retry atomically in the main loop.
          if (current || operation.createReceipt) createRecoveries.push({ operation, current });
        } else if (current && sha256Canonical(current) === operation.beforeHash) {
          operation.state = 'planned';
          delete operation.probeFailure;
          writeJsonAtomic(options.bundlePath, bundle);
        } else if (isRecognizedUpdatePostimage(current, operation)) {
          captureAppliedPostimage(bundle, operation, current, options.bundlePath);
        } else {
          throw new Error(`${operation.id}: unknown persisted update outcome has unreviewed drift`);
        }
        break;
      }
      case 'applied-unverified':
        assertCapturedApplyPostimage(bundle, operation, current);
        operation.state = 'applied';
        delete operation.probeFailure;
        writeJsonAtomic(options.bundlePath, bundle);
        break;
      case 'applied':
        assertCapturedApplyPostimage(bundle, operation, current);
        break;
      default:
        throw new Error(`${operation.id}: unsupported persisted apply state ${String(operation.state)}`);
    }
  }

  for (const { operation, current } of createRecoveries) {
    const recovered = await createEffectWithServerReceipt(bundle, operation, options);
    if (current && recovered.entity.id !== current.id) {
      throw new Error(`${operation.id}: receipt recovery identity drift`);
    }
    operation.entityId = recovered.entity.id;
    operation.createReceipt = stableClone(recovered.receipt);
    writeJsonAtomic(options.bundlePath, bundle);
    const observed = await refetchEntity(
      options.baseUrl,
      operation.collection,
      operation.cardNumber,
      options.fetchImpl,
    );
    if (!observed || observed.id !== recovered.entity.id) {
      throw new Error(`${operation.id}: recovered create postimage is missing`);
    }
    captureAppliedPostimage(bundle, operation, observed, options.bundlePath);
  }
}

export async function applyMigrationBundle(bundle, options) {
  if (!APPLY_RESUMABLE_BUNDLE_STATUSES.has(bundle.status)) {
    throw new Error(`Bundle status must be planned, applying or partial, got ${bundle.status}`);
  }
  const startingStatus = bundle.status;
  if (startingStatus === 'planned'
    && bundle.operations.some((operation) => operation.state !== 'planned')) {
    throw new Error('A planned bundle cannot contain persisted apply progress');
  }
  assertMigrationPlanIntegrity(bundle);
  const { patch, patchHash } = selectedPatch(options.patchDeclaration);
  if (patchHash !== bundle.patch.hash) throw new Error('Declarative patch changed after plan');
  if (bundle.operations.length && !nonEmptyString(options.certificationKey)) {
    throw new Error(
      'CONTENT_CERTIFICATION_KEY is required before apply for every protected exact update, '
      + 'receipt create/hard-delete and support rollback',
    );
  }
  const protectedRollbackOperations = bundle.operations.filter((operation) => (
    operation.operation === 'create' || operation.before?.support != null
  ));
  // Rollbackability is an apply invariant: validate every protected preimage
  // before backup/network checks and, critically, before the first API write.
  for (const operation of protectedRollbackOperations) {
    if (operation.operation === 'update') {
      exactSupportRollbackRequest(operation.before.support, operation.id);
    }
  }
  if (options.confirmApi !== bundle.apiBase || options.confirmApi !== options.baseUrl) {
    throw new Error('--confirm-api must exactly equal the planned API base');
  }
  const backup = verifyBackupMetadata(options.backupMetadataPath, {
    requireRecent: startingStatus === 'planned',
    now: options.now ?? new Date(),
  });
  assertBackupPredatesPlan(backup, bundle);
  if (startingStatus !== 'planned') {
    if (!bundle.backup?.sha256 || bundle.backup.sha256 !== backup.sha256) {
      throw new Error('Resumed apply backup differs from the originally verified backup');
    }
  }
  options = { ...options, token: await resolveMigrationToken(options, 'apply') };
  const catalogs = await fetchMigrationCatalogs({
    baseUrl: options.baseUrl,
    fetchImpl: options.fetchImpl,
  });
  assertMigrationApiContract(catalogs);
  if (startingStatus === 'planned') {
    if (!same(microMvpCatalogFingerprint(catalogs), bundle.catalogFingerprint)) {
      throw new Error('Full catalog fingerprint changed after the reviewed migration plan');
    }
    await assertPlanPreimages(bundle, catalogs);
    const reviewedOperations = buildMigrationOperations(catalogs, patch);
    if (!same(
      reviewedOperations.map(immutableOperationPlan),
      bundle.operations.map(immutableOperationPlan),
    )) {
      throw new Error('Migration bundle no longer matches the reviewed declarative patch plan');
    }
  } else {
    await reconcilePersistedApply(bundle, catalogs, options);
  }
  validateMechanicsTargets(bundle.operations.flatMap((operation) => (
    operation.request.mechanics ? [{
      label: operation.id,
      cardNumber: operation.cardNumber,
      name: operation.before?.name || operation.request.name || operation.cardNumber,
      kind: operation.collection === 'spells'
        ? 'spell'
        : operation.collection === 'actions' ? 'action' : 'passive_effect',
      mechanics: operation.request.mechanics,
    }] : []
  )));

  bundle.status = 'applying';
  bundle.backup ??= backup;
  bundle.applyStartedAt ??= new Date().toISOString();
  if (startingStatus !== 'planned') {
    bundle.applyResumeCount = (bundle.applyResumeCount ?? 0) + 1;
    bundle.applyResumedAt = new Date().toISOString();
  }
  delete bundle.failure;
  writeJsonAtomic(options.bundlePath, bundle);
  let activeOperation = null;
  try {
    for (const operation of bundle.operations) {
      if (operation.state === 'applied') continue;
      activeOperation = operation;
      if (operation.state !== 'writing') {
        operation.state = 'writing';
        delete operation.probeFailure;
        writeJsonAtomic(options.bundlePath, bundle);
      }
      if (operation.operation === 'create') {
        const created = await createEffectWithServerReceipt(bundle, operation, options);
        operation.entityId = created.entity.id;
        operation.createReceipt = stableClone(created.receipt);
        writeJsonAtomic(options.bundlePath, bundle);
      } else {
        await exactUpdateWithCAS(
          bundle, operation, operation.before, operation.request, options,
        );
      }
      const after = await refetchEntity(
        options.baseUrl,
        operation.collection,
        operation.cardNumber,
        options.fetchImpl,
      );
      if (!after) throw new Error(`${operation.id}: row is missing after write`);
      persistUnverifiedApplyPostimage(bundle, operation, after, options.bundlePath);
      if (operation.operation === 'update' && !isRecognizedUpdatePostimage(after, operation)) {
        if (!same(projection(after, operation.desiredProjection), operation.desiredProjection)) {
          throw new Error(`${operation.id}: exact post-apply projection verification failed`);
        }
        throw new Error(`${operation.id}: post-apply response changed fields outside the reviewed write`);
      }
      assertCapturedApplyPostimage(bundle, operation, after);
      operation.state = 'applied';
      writeJsonAtomic(options.bundlePath, bundle);
      activeOperation = null;
    }
    bundle.status = 'applied';
    bundle.appliedAt = new Date().toISOString();
    writeJsonAtomic(options.bundlePath, bundle);
    return bundle;
  } catch (error) {
    if (activeOperation?.state === 'writing') {
      try {
        const observed = await refetchEntity(
          options.baseUrl,
          activeOperation.collection,
          activeOperation.cardNumber,
          options.fetchImpl,
        );
        const unchanged = activeOperation.operation === 'update'
          && observed
          && sha256Canonical(observed) === activeOperation.beforeHash;
        if (unchanged) {
          activeOperation.state = 'not-applied';
        } else if (activeOperation.operation === 'create' && observed) {
          // A lost HTTP response is reconciled by the idempotent atomic
          // create endpoint. It returns only the server-issued receipt for
          // this bundle/plan/operation tuple; a merely matching card is not
          // sufficient to authorize future hard-delete.
          const recovered = await createEffectWithServerReceipt(bundle, activeOperation, options);
          if (recovered.entity.id !== observed.id) {
            throw new Error(`${activeOperation.id}: receipt recovery identity drift`);
          }
          activeOperation.entityId = recovered.entity.id;
          activeOperation.createReceipt = stableClone(recovered.receipt);
          activeOperation.after = stableClone(observed);
          activeOperation.afterHash = sha256Canonical(observed);
          activeOperation.state = 'applied-unverified';
        } else if (isRecognizedUpdatePostimage(observed, activeOperation)) {
          activeOperation.entityId = observed.id;
          activeOperation.after = stableClone(observed);
          activeOperation.afterHash = sha256Canonical(observed);
          activeOperation.state = 'applied-unverified';
        } else {
          activeOperation.state = 'write-outcome-unknown';
        }
      } catch (probeError) {
        activeOperation.state = 'write-outcome-unknown';
        activeOperation.probeFailure = probeError instanceof Error
          ? probeError.message
          : String(probeError);
      }
    }
    bundle.status = 'partial';
    bundle.failure = error instanceof Error ? error.message : String(error);
    writeJsonAtomic(options.bundlePath, bundle);
    throw error;
  }
}

function rollbackRequest(operation) {
  return projection(operation.before, operation.request);
}

export async function rollbackMigrationBundle(bundle, options) {
  if (!['applied', 'partial', 'rolling-back', 'rollback-partial'].includes(bundle.status)) {
    throw new Error(`Bundle status must be applied or partial, got ${bundle.status}`);
  }
  assertMigrationPlanIntegrity(bundle);
  if (options.confirmApi !== bundle.apiBase || options.confirmApi !== options.baseUrl) {
    throw new Error('--confirm-api must exactly equal the planned API base');
  }
  const backup = verifyBackupMetadata(options.backupMetadataPath, {
    requireRecent: false,
    now: options.now ?? new Date(),
  });
  assertBackupPredatesPlan(backup, bundle);
  if (!bundle.backup?.sha256) {
    throw new Error('Rollback bundle is missing the original apply backup binding');
  }
  if (bundle.backup.sha256 !== backup.sha256) {
    throw new Error('Rollback backup differs from the apply backup');
  }

  const unknownWrites = bundle.operations.filter((operation) => (
    ['writing', 'write-outcome-unknown'].includes(operation.state)
  ));
  if (unknownWrites.length) {
    throw new Error(
      `Point rollback is unsafe: ${unknownWrites.map((operation) => operation.id).join(', ')} `
      + 'has an unknown write outcome; use the verified SQL dump or reconcile manually',
    );
  }
  const potentiallyApplied = bundle.operations.filter((operation) => (
    ['applied', 'applied-unverified', 'rollback-content-writing',
      'rollback-content-restored', 'rollback-support-writing',
      'rollback-hard-delete-writing'].includes(operation.state)
  ));
  if (potentiallyApplied.length && !nonEmptyString(options.certificationKey)) {
    throw new Error('CONTENT_CERTIFICATION_KEY is required for protected exact rollback');
  }
  options = { ...options, token: await resolveMigrationToken(options, 'rollback') };

  const initialStates = new Set(['applied', 'applied-unverified']);
  const progressStates = new Set([
    'rollback-content-writing',
    'rollback-content-restored',
    'rollback-support-writing',
    'rollback-hard-delete-writing',
  ]);

  // Reconcile crash-persisted phases before issuing another mutation. A
  // progressed row is accepted only as the original postimage, the exact
  // restored content with invalidated support, or the final preimage.
  for (const operation of bundle.operations.filter((item) => progressStates.has(item.state))) {
    const current = await refetchEntity(
      options.baseUrl,
      operation.collection,
      operation.cardNumber,
      options.fetchImpl,
    );
    if (operation.operation === 'create') {
      if (current && sha256Canonical(current) !== operation.afterHash) {
        throw new Error(`${operation.id}: create rollback phase has unreviewed drift`);
      }
    } else if (current && sha256Canonical(current) === operation.afterHash) {
      if (operation.state !== 'rollback-content-writing') {
        throw new Error(`${operation.id}: rollback phase regressed to the applied postimage`);
      }
      operation.state = 'applied';
    } else if (isRollbackFinalEquivalent(current, operation)) {
      operation.rollbackAfter = stableClone(current);
      operation.rollbackAfterHash = sha256Canonical(current);
      operation.state = 'rolled-back';
    } else if (isRollbackContentBodyRestored(current, operation) && current.support === null) {
      operation.rollbackContentPostimage = stableClone(current);
      operation.rollbackContentPostimageHash = sha256Canonical(current);
      operation.state = 'rollback-content-restored';
    } else {
      throw new Error(`${operation.id}: restored content/support phase has unreviewed drift`);
    }
    writeJsonAtomic(options.bundlePath, bundle);
  }

  const applied = bundle.operations.filter((operation) => (
    initialStates.has(operation.state) || progressStates.has(operation.state)
  )).reverse();

  // Every untouched applied postimage must still be byte-for-byte the one
  // captured after apply. This preflight completes before the first rollback
  // mutation.
  for (const operation of applied.filter((item) => initialStates.has(item.state))) {
    const current = await refetchEntity(
      options.baseUrl,
      operation.collection,
      operation.cardNumber,
      options.fetchImpl,
    );
    if (!current || sha256Canonical(current) !== operation.afterHash) {
      throw new Error(`${operation.id}: postimage drift; refusing rollback overwrite`);
    }
  }

  const protectedRollbackArtifacts = applied.filter((operation) => (
    operation.operation === 'create' || operation.before?.support != null
  ));
  for (const operation of protectedRollbackArtifacts) {
    if (operation.operation === 'create') {
      assertCreateReceipt(bundle, operation);
    } else {
      exactSupportRollbackRequest(operation.before.support, operation.id);
    }
  }

  bundle.status = 'rolling-back';
  bundle.rollbackStartedAt ??= new Date().toISOString();
  writeJsonAtomic(options.bundlePath, bundle);
  try {
    for (const operation of applied) {
      if (operation.state === 'rolled-back') continue;
      if (operation.operation === 'create') {
        operation.state = 'rollback-hard-delete-writing';
        writeJsonAtomic(options.bundlePath, bundle);
        await hardDeleteCreatedEffect(bundle, operation, options);
        const afterDelete = await refetchEntity(
          options.baseUrl,
          operation.collection,
          operation.cardNumber,
          options.fetchImpl,
        );
        if (afterDelete) throw new Error(`${operation.id}: hard-deleted row became visible`);
        operation.rollbackAfter = null;
        operation.rollbackAfterHash = sha256Canonical(null);
      } else {
        let contentRestored;
        if (initialStates.has(operation.state)) {
          operation.state = 'rollback-content-writing';
          writeJsonAtomic(options.bundlePath, bundle);
          const exactRollback = await exactUpdateWithCAS(
            bundle,
            operation,
            operation.after,
            rollbackRequest(operation),
            options,
          );
          contentRestored = exactRollback.entity;
          const observedRestored = await refetchEntity(
            options.baseUrl,
            operation.collection,
            operation.cardNumber,
            options.fetchImpl,
          );
          if (!observedRestored || sha256Canonical(observedRestored) !== sha256Canonical(contentRestored)) {
            throw new Error(`${operation.id}: exact rollback response/refetch TOCTOU drift`);
          }
          contentRestored = observedRestored;
          if (!isRollbackContentBodyRestored(contentRestored, operation)) {
            throw new Error(`${operation.id}: full content preimage was not restored`);
          }
          if (contentRestored.support !== null) {
            throw new Error(`${operation.id}: content trigger did not invalidate support to exact null`);
          }
          operation.rollbackContentPostimage = stableClone(contentRestored);
          operation.rollbackContentPostimageHash = sha256Canonical(contentRestored);
          operation.state = 'rollback-content-restored';
          writeJsonAtomic(options.bundlePath, bundle);
        } else {
          contentRestored = await refetchEntity(
            options.baseUrl,
            operation.collection,
            operation.cardNumber,
            options.fetchImpl,
          );
        }

        if (operation.before.support != null) {
          const support = exactSupportRollbackRequest(operation.before.support, operation.id);
          operation.state = 'rollback-support-writing';
          writeJsonAtomic(options.bundlePath, bundle);
          await restoreSupportWithCAS(operation, contentRestored, support, options);
        }
        const restored = await refetchEntity(
          options.baseUrl,
          operation.collection,
          operation.cardNumber,
          options.fetchImpl,
        );
        assertRollbackContentEquivalent(restored, operation);
        operation.rollbackAfter = stableClone(restored);
        operation.rollbackAfterHash = sha256Canonical(restored);
        operation.rollbackServerManagedFields = [...ROLLBACK_SERVER_MANAGED_FIELDS];
      }
      operation.state = 'rolled-back';
      writeJsonAtomic(options.bundlePath, bundle);
    }
  } catch (error) {
    bundle.status = 'rollback-partial';
    bundle.rollbackFailure = error instanceof Error ? error.message : String(error);
    writeJsonAtomic(options.bundlePath, bundle);
    throw error;
  }
  bundle.status = 'rolled-back';
  bundle.rolledBackAt = new Date().toISOString();
  delete bundle.rollbackFailure;
  writeJsonAtomic(options.bundlePath, bundle);
  return bundle;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(cliHelp());
    return;
  }
  if (!args.bundlePath) throw new Error('--bundle is required');
  const bundlePath = resolve(args.bundlePath);
  const baseUrl = apiUrl();
  if (args.command === 'plan') {
    if (existsSync(bundlePath)) throw new Error(`Refusing to overwrite existing bundle: ${bundlePath}`);
    const bundle = await createMigrationBundle({ baseUrl });
    writeJsonAtomic(bundlePath, bundle);
    console.log(`PLAN ${bundle.operations.length} operation(s) -> ${bundlePath}`);
    return;
  }
  const bundle = readMigrationBundle(bundlePath);
  const options = {
    baseUrl,
    bundlePath,
    backupMetadataPath: args.backupMetadataPath,
    confirmApi: args.confirmApi,
    token: process.env.API_TOKEN || '',
    certificationKey: process.env.CONTENT_CERTIFICATION_KEY || '',
    loginProvider: () => login({ baseUrl }),
  };
  if (args.command === 'apply') {
    await applyMigrationBundle(bundle, options);
    console.log(`APPLIED ${bundle.operations.length} operation(s); postimages saved in ${bundlePath}`);
  } else {
    await rollbackMigrationBundle(bundle, options);
    console.log(`ROLLED BACK ${bundle.operations.length} operation(s); bundle ${bundlePath}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
