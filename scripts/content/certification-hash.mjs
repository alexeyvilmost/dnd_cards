import { createHash } from 'node:crypto';

const VOLATILE_ROOT_FIELDS = new Set([
  'support',
  // Forge presentation defaults are served from a sidecar catalog and are
  // intentionally not part of certified rules/content bytes.
  'choice_recommendations',
  'created_at',
  'updated_at',
  'deleted_at',
]);

function normalizedForHash(value, { root = false } = {}) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizedForHash(item));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => !(root && VOLATILE_ROOT_FIELDS.has(key)))
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, normalizedForHash(value[key])]),
    );
  }
  return value;
}

export function canonicalJson(value, options) {
  return JSON.stringify(normalizedForHash(value, options));
}

export function sha256Canonical(value, options) {
  return `sha256:${createHash('sha256').update(canonicalJson(value, options)).digest('hex')}`;
}

export function contentHash(entity) {
  return sha256Canonical(entity, { root: true });
}

const identityOf = (type, entity) => (
  `${type}:${entity.id ?? entity.card_number ?? contentHash(entity)}`
);

/**
 * Создаёт индекс ссылок по id и card_number.
 *
 * Один ключ может указывать на несколько сущностей: это лучше, чем молча выбрать
 * неверную запись при загрязнённом каталоге. В dependency hash попадут все
 * совпадения, и duplicate останется заметен при проверке контента.
 */
export function buildCertificationIndex(entityGroups) {
  const byReference = new Map();
  const byIdentity = new Map();

  for (const [type, entities] of Object.entries(entityGroups)) {
    for (const entity of entities ?? []) {
      const identity = identityOf(type, entity);
      if (byIdentity.has(identity)) continue;
      const record = { type, identity, entity };
      byIdentity.set(identity, record);
      for (const reference of [entity.id, entity.card_number]) {
        if (typeof reference !== 'string' || !reference) continue;
        const records = byReference.get(reference) ?? [];
        records.push(record);
        byReference.set(reference, records);
      }
    }
  }

  return { byReference, byIdentity };
}

function visitReferences(value, index, rootIdentity, dependencies, visitedObjects) {
  if (typeof value === 'string') {
    for (const record of index.byReference.get(value) ?? []) {
      if (record.identity === rootIdentity || dependencies.has(record.identity)) continue;
      dependencies.set(record.identity, record);
      visitReferences(
        record.entity,
        index,
        rootIdentity,
        dependencies,
        visitedObjects,
      );
    }
    return;
  }
  if (!value || typeof value !== 'object' || visitedObjects.has(value)) return;
  visitedObjects.add(value);

  for (const [key, nested] of Object.entries(value)) {
    if (VOLATILE_ROOT_FIELDS.has(key)) continue;
    visitReferences(nested, index, rootIdentity, dependencies, visitedObjects);
  }
}

/**
 * Хэширует транзитивное замыкание ссылок. Ссылкой считается точное совпадение
 * строкового значения с id/card_number известной сущности. Это покрывает как
 * related_effects, так и вложенные level_progression/equipment_options, не
 * привязывая release-gate к конкретной форме JSON каждой игровой системы.
 */
export function dependencySnapshot(entity, entityType, index) {
  const rootIdentity = identityOf(entityType, entity);
  const dependencies = new Map();
  visitReferences(entity, index, rootIdentity, dependencies, new WeakSet());

  return [...dependencies.values()]
    .map((record) => ({
      type: record.type,
      identity: record.identity,
      content_hash: contentHash(record.entity),
    }))
    .sort((left, right) => left.identity.localeCompare(right.identity));
}

export function certificationHashes(entity, entityType, index) {
  const dependencies = dependencySnapshot(entity, entityType, index);
  return {
    contentHash: contentHash(entity),
    dependencyHash: sha256Canonical(dependencies),
    dependencies,
  };
}
