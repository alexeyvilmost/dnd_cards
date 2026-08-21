import { createHash } from 'node:crypto';
import contentPatchJson from './data/micro-mvp-l1-content-patch.v1.json';
import { canonicalStringify } from '../rules-core/determinism';
import type { SnapshotCatalogs } from './prodSnapshotL1Fixtures';

type JsonObject = Record<string, unknown>;
type PatchCollection = 'effects' | 'actions' | 'spells';
type CreateCollection = 'effects' | 'actions';
type FieldPatchCollection = 'cards' | 'classes' | 'races';
type EntityReferenceCollection = 'cards' | 'effects';

export interface DeclarativeEntityReference {
  collection: EntityReferenceCollection;
  entityId: string;
  cardNumber: string;
}

export interface DeclarativeMechanicsPatch {
  entityId: string;
  cardNumber: string;
  expectedBeforeMechanicsHash: string;
  /** Production API CAS; source-snapshot CAS above remains immutable. */
  productionExpectedBeforeMechanicsHash?: string;
  mechanics: JsonObject;
}

export interface DeclarativeFieldPatch {
  collection: FieldPatchCollection;
  entityId: string;
  cardNumber: string;
  expectedBeforeFieldsHash: string;
  /** Production API CAS; source-snapshot CAS above remains immutable. */
  productionExpectedBeforeFieldsHash?: string;
  /**
   * Reviewed production-only top-level replacements. They let the immutable
   * source snapshot retain its own deterministic materialization while live
   * data can carry a newer, explicitly declared structural representation.
   */
  productionFieldOverrides?: JsonObject;
  /** Stable semantic identities for UUIDs embedded in the declared fields. */
  entityReferences?: DeclarativeEntityReference[];
  /** Stable identities used only by productionFieldOverrides. */
  productionEntityReferences?: DeclarativeEntityReference[];
  fields: JsonObject;
}

export type DeclarativeCreateEntity = {
  [Collection in CreateCollection]: {
    collection: Collection;
    entity: SnapshotCatalogs[Collection][number];
  }
}[CreateCollection];

export interface DeclarativeConditionPatch {
  cardNumber: string;
  entityId: string | null;
  fixtureEntityId: string;
  expectedBeforeFieldsHash: string | null;
  /** Production API CAS for an existing row; absent for production creates. */
  productionExpectedBeforeFieldsHash?: string | null;
  fields: JsonObject;
  createFields: JsonObject;
}

export interface MicroMvpL1ContentPatch {
  schemaVersion: 1;
  patchId: string;
  patchVersion: string;
  sourceReleaseId: string;
  authorityTarget: 'database-entity-mechanics';
  mechanicsPatches: Record<PatchCollection, DeclarativeMechanicsPatch[]>;
  fieldPatches: DeclarativeFieldPatch[];
  createEntities: DeclarativeCreateEntity[];
  conditionPatches: DeclarativeConditionPatch[];
}

export const MICRO_MVP_L1_CONTENT_PATCH = contentPatchJson as MicroMvpL1ContentPatch;

export type ContentPatchMode = 'apply' | 'verify-only';

export interface ContentPatchChange {
  collection: PatchCollection | FieldPatchCollection;
  entityId: string;
  cardNumber: string;
  operation: 'replace-mechanics' | 'replace-fields' | 'create';
}

export interface ContentPatchResult {
  catalogs: SnapshotCatalogs;
  changes: ContentPatchChange[];
  alreadyMaterialized: ContentPatchChange[];
}

export class DeclarativeContentPatchError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Declarative content patch failed:\n${problems.join('\n')}`);
    this.name = 'DeclarativeContentPatchError';
  }
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function hashCanonical(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalStringify(value)).digest('hex')}`;
}

function same(left: unknown, right: unknown): boolean {
  return canonicalStringify(left) === canonicalStringify(right);
}

function exactEntity<T extends { id: string; card_number: string }>(
  items: readonly T[],
  identity: { entityId: string; cardNumber: string },
  collection: string,
): T | null {
  const byId = items.filter((item) => item.id === identity.entityId);
  const byCard = items.filter((item) => item.card_number === identity.cardNumber);
  if (byId.length === 0 && byCard.length === 0) return null;
  if (byId.length !== 1 || byCard.length !== 1 || byId[0] !== byCard[0]) {
    throw new DeclarativeContentPatchError([
      `${collection}:${identity.cardNumber}/${identity.entityId}: identity is missing, duplicated, or split`,
    ]);
  }
  return byId[0];
}

function selectedFields(entity: JsonObject, fields: JsonObject): JsonObject {
  return Object.fromEntries(Object.keys(fields).map((key) => [key, entity[key] ?? null]));
}

function productionFields(patch: DeclarativeFieldPatch): JsonObject | null {
  return patch.productionFieldOverrides
    ? { ...patch.fields, ...patch.productionFieldOverrides }
    : null;
}

const SERVER_MANAGED_ENTITY_FIELDS = new Set(['id', 'created_at', 'updated_at', 'deleted_at']);

function declaredMutableFields(entity: JsonObject): JsonObject {
  return Object.fromEntries(Object.entries(entity).filter(([key]) => (
    !SERVER_MANAGED_ENTITY_FIELDS.has(key)
  )));
}

function replaceStringAliases(value: unknown, aliases: ReadonlyMap<string, string>): unknown {
  if (typeof value === 'string') return aliases.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => replaceStringAliases(item, aliases));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => (
      [key, replaceStringAliases(item, aliases)]
    )));
  }
  return value;
}

function declaredCreateIdentityAliases(catalogs: SnapshotCatalogs): {
  actualToDeclared: Map<string, string>;
  declaredToActual: Map<string, string>;
} {
  const actualToDeclared = new Map<string, string>();
  const declaredToActual = new Map<string, string>();
  for (const declaration of MICRO_MVP_L1_CONTENT_PATCH.createEntities) {
    const declared = declaration.entity;
    const rows = catalogs[declaration.collection] as Array<{ id: string; card_number: string }>;
    const matches = rows.filter((entity) => entity.card_number === declared.card_number);
    if (matches.length !== 1 || matches[0].id === declared.id) continue;
    // Relationships in declarative fields use stable card_number tokens; the
    // backend replaces those tokens with the assigned UUID after creating the
    // row. Normalize that surrogate UUID back to the stable token for CAS.
    actualToDeclared.set(matches[0].id, declared.card_number);
    declaredToActual.set(declared.id, matches[0].id);
    declaredToActual.set(declared.card_number, matches[0].id);
  }
  return { actualToDeclared, declaredToActual };
}

/**
 * The only compiler-side content adapter. Every entity rule is ordinary JSON
 * in the versioned patch; this function knows only identity, CAS hashes and
 * field replacement. It intentionally has no spell/class/feature branches.
 */
export function materializeMicroMvpL1ContentPatch(
  source: SnapshotCatalogs,
  options: { mode?: ContentPatchMode } = {},
): ContentPatchResult {
  const mode = options.mode ?? 'apply';
  const catalogs = cloneJson(source);
  const changes: ContentPatchChange[] = [];
  const alreadyMaterialized: ContentPatchChange[] = [];
  const problems: string[] = [];
  const createIdentityAliases = declaredCreateIdentityAliases(catalogs);

  for (const collection of ['effects', 'actions', 'spells'] as const) {
    for (const patch of MICRO_MVP_L1_CONTENT_PATCH.mechanicsPatches[collection]) {
      const items = catalogs[collection] as unknown as Array<{
        id: string;
        card_number: string;
        mechanics?: JsonObject | null;
      }>;
      let entity: (typeof items)[number] | null = null;
      try {
        entity = exactEntity(items, patch, collection);
      } catch (error) {
        problems.push(error instanceof Error ? error.message : String(error));
        continue;
      }
      if (!entity) {
        problems.push(`${collection}:${patch.cardNumber}/${patch.entityId}: required entity is absent`);
        continue;
      }
      const change: ContentPatchChange = {
        collection,
        entityId: patch.entityId,
        cardNumber: patch.cardNumber,
        operation: 'replace-mechanics',
      };
      if (same(entity.mechanics ?? null, patch.mechanics)) {
        alreadyMaterialized.push(change);
        continue;
      }
      const beforeHash = hashCanonical(entity.mechanics ?? null);
      if (beforeHash !== patch.expectedBeforeMechanicsHash) {
        problems.push(
          `${collection}:${patch.cardNumber}: expected mechanics ${patch.expectedBeforeMechanicsHash}, got ${beforeHash}`,
        );
        continue;
      }
      if (mode === 'verify-only') {
        problems.push(`${collection}:${patch.cardNumber}: declarative mechanics are not materialized`);
        continue;
      }
      entity.mechanics = cloneJson(patch.mechanics);
      changes.push(change);
    }
  }

  for (const patch of MICRO_MVP_L1_CONTENT_PATCH.fieldPatches) {
    const items = catalogs[patch.collection] as Array<{ id: string; card_number: string }>;
    let entity: SnapshotCatalogs[typeof patch.collection][number] | null = null;
    try {
      entity = exactEntity(items, patch, patch.collection) as (
        SnapshotCatalogs[typeof patch.collection][number] | null
      );
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
      continue;
    }
    if (!entity) {
      problems.push(`${patch.collection}:${patch.cardNumber}/${patch.entityId}: required entity is absent`);
      continue;
    }
    const currentFields = selectedFields(entity as unknown as JsonObject, patch.fields);
    const comparableFields = replaceStringAliases(
      currentFields,
      createIdentityAliases.actualToDeclared,
    );
    const reviewedProductionFields = productionFields(patch);
    const currentProductionFields = reviewedProductionFields
      ? selectedFields(entity as unknown as JsonObject, reviewedProductionFields)
      : null;
    const isProductionMaterialized = reviewedProductionFields !== null
      && same(currentProductionFields, reviewedProductionFields);
    let referenceFailure = false;
    const references = [
      ...(patch.entityReferences ?? []),
      ...(isProductionMaterialized ? patch.productionEntityReferences ?? [] : []),
    ];
    for (const reference of references) {
      try {
        const referenced = exactEntity(
          catalogs[reference.collection] as Array<{ id: string; card_number: string }>,
          reference,
          reference.collection,
        );
        if (!referenced) {
          problems.push(
            `${patch.collection}:${patch.cardNumber}: required reference `
            + `${reference.collection}:${reference.cardNumber}/${reference.entityId} is absent`,
          );
          referenceFailure = true;
        }
      } catch (error) {
        problems.push(error instanceof Error ? error.message : String(error));
        referenceFailure = true;
      }
    }
    if (referenceFailure) continue;
    const change: ContentPatchChange = {
      collection: patch.collection,
      entityId: patch.entityId,
      cardNumber: patch.cardNumber,
      operation: 'replace-fields',
    };
    if (same(comparableFields, patch.fields) || isProductionMaterialized) {
      alreadyMaterialized.push(change);
      continue;
    }
    const beforeHash = hashCanonical(currentFields);
    if (beforeHash !== patch.expectedBeforeFieldsHash) {
      problems.push(
        `${patch.collection}:${patch.cardNumber}: expected fields ${patch.expectedBeforeFieldsHash}, got ${beforeHash}`,
      );
      continue;
    }
    if (mode === 'verify-only') {
      problems.push(`${patch.collection}:${patch.cardNumber}: declarative fields are not materialized`);
      continue;
    }
    Object.assign(entity, cloneJson(replaceStringAliases(
      patch.fields,
      createIdentityAliases.declaredToActual,
    ) as JsonObject));
    changes.push(change);
  }

  for (const declaration of MICRO_MVP_L1_CONTENT_PATCH.createEntities) {
    const identity = {
      entityId: declaration.entity.id,
      cardNumber: declaration.entity.card_number,
    };
    const rows = catalogs[declaration.collection] as unknown as Array<{
      id: string;
      card_number: string;
      [key: string]: unknown;
    }>;
    const cardMatches = rows.filter((entity) => (
      entity.card_number === identity.cardNumber
    ));
    if (cardMatches.length > 1) {
      problems.push(`${declaration.collection}:${identity.cardNumber}: declared card_number is duplicated`);
      continue;
    }
    const existing = cardMatches[0] ?? null;
    const change: ContentPatchChange = {
      collection: declaration.collection,
      ...identity,
      operation: 'create',
    };
    if (existing) {
      // Production POST assigns its own UUID. Stable card_number is the data
      // identity; every other declared mutable field must still match exactly.
      const declared = declaredMutableFields(declaration.entity as unknown as JsonObject);
      const currentProjection = selectedFields(existing as unknown as JsonObject, declared);
      if (!same(currentProjection, declared)) {
        problems.push(`${declaration.collection}:${identity.cardNumber}: declared entity exists with different fields`);
      } else {
        alreadyMaterialized.push(change);
      }
      continue;
    }
    if (mode === 'verify-only') {
      problems.push(`${declaration.collection}:${identity.cardNumber}: declared entity is absent`);
      continue;
    }
    rows.push(cloneJson(declaration.entity) as unknown as (typeof rows)[number]);
    changes.push(change);
  }

  for (const declaration of MICRO_MVP_L1_CONTENT_PATCH.conditionPatches) {
    const matches = catalogs.effects.filter((entity) => (
      entity.card_number === declaration.cardNumber
    ));
    if (matches.length > 1) {
      problems.push(`effects:${declaration.cardNumber}: condition card_number is duplicated`);
      continue;
    }
    const existing = matches[0] ?? null;
    const change: ContentPatchChange = {
      collection: 'effects',
      entityId: existing?.id ?? declaration.fixtureEntityId,
      cardNumber: declaration.cardNumber,
      operation: existing ? 'replace-fields' : 'create',
    };
    if (existing) {
      if (declaration.entityId && existing.id !== declaration.entityId) {
        problems.push(`effects:${declaration.cardNumber}: expected condition id ${declaration.entityId}, got ${existing.id}`);
        continue;
      }
      const currentFields = selectedFields(existing as unknown as JsonObject, declaration.fields);
      if (same(currentFields, declaration.fields)) {
        alreadyMaterialized.push(change);
        continue;
      }
      const beforeHash = hashCanonical(currentFields);
      if (beforeHash !== declaration.expectedBeforeFieldsHash) {
        problems.push(
          `effects:${declaration.cardNumber}: expected condition fields `
          + `${String(declaration.expectedBeforeFieldsHash)}, got ${beforeHash}`,
        );
        continue;
      }
      if (mode === 'verify-only') {
        problems.push(`effects:${declaration.cardNumber}: condition fields are not materialized`);
        continue;
      }
      Object.assign(existing, cloneJson(declaration.fields));
      changes.push(change);
      continue;
    }
    if (declaration.entityId) {
      problems.push(`effects:${declaration.cardNumber}: expected condition entity is absent`);
      continue;
    }
    if (mode === 'verify-only') {
      problems.push(`effects:${declaration.cardNumber}: condition entity is absent`);
      continue;
    }
    catalogs.effects.push({
      ...cloneJson(declaration.createFields),
      id: declaration.fixtureEntityId,
      created_at: '2026-08-05T00:00:00.000Z',
      updated_at: '2026-08-05T00:00:00.000Z',
    } as SnapshotCatalogs['effects'][number]);
    changes.push(change);
  }

  if (problems.length) throw new DeclarativeContentPatchError(problems);
  return { catalogs, changes, alreadyMaterialized };
}

export function assertMicroMvpL1ContentMaterialized(source: SnapshotCatalogs): void {
  const result = materializeMicroMvpL1ContentPatch(source, { mode: 'verify-only' });
  if (result.changes.length !== 0) {
    throw new DeclarativeContentPatchError(['verify-only unexpectedly returned mutations']);
  }
}
