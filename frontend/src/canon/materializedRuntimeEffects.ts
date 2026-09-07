type JsonObject = Record<string, unknown>;

export interface MaterializedRuntimeEffect {
  id: string;
  card_number: string;
  mechanics?: unknown;
}

export type MaterializedRuntimeEffectRegistry = Readonly<Record<
  string,
  { mechanics?: unknown } | undefined
>>;

/** Index runtime effect entities by both durable catalog identities. Duplicate
 * aliases are rejected so semantic verification cannot silently pick a row. */
export function buildMaterializedRuntimeEffectRegistry<T extends MaterializedRuntimeEffect>(
  effects: readonly T[],
): Readonly<Record<string, T>> {
  const registry: Record<string, T> = {};
  for (const effect of effects) {
    for (const reference of [effect.card_number, effect.id]) {
      if (!reference) throw new Error('materialized runtime effect has a blank identity');
      if (registry[reference] && registry[reference] !== effect) {
        throw new Error(`materialized runtime effect identity ${reference} is ambiguous`);
      }
      registry[reference] = effect;
    }
  }
  return registry;
}

/** Reconstruct the executable payload that a grant_effect reference resolves
 * to at runtime. Only migration-owned EFFECT-runtime-* references are folded;
 * all ordinary grant_effect relationships remain explicit catalog semantics. */
export function resolveMaterializedRuntimeEffects<T>(
  value: T,
  registry: MaterializedRuntimeEffectRegistry,
  path = 'mechanics',
  resolving: readonly string[] = [],
): T {
  if (Array.isArray(value)) {
    return value.map((item, index) => (
      resolveMaterializedRuntimeEffects(item, registry, `${path}[${index}]`, resolving)
    )) as T;
  }
  if (!value || typeof value !== 'object') return value;

  const record = value as JsonObject;
  if (record.kind === 'grant_effect'
      && typeof record.value === 'string'
      && record.value.startsWith('EFFECT-runtime-')) {
    const reference = record.value;
    const resolved = registry[reference];
    if (!resolved?.mechanics || typeof resolved.mechanics !== 'object') {
      throw new Error(`${path}: materialized effect ${reference} is unresolved`);
    }
    const unexpected = Object.keys(record).filter((key) => !['kind', 'value'].includes(key));
    if (unexpected.length > 0) {
      throw new Error(
        `${path}: materialized effect reference carries unexpected fields: ${unexpected.join(', ')}`,
      );
    }
    if (resolving.includes(reference)) {
      throw new Error(`${path}: materialized effect reference cycle ${[...resolving, reference].join(' -> ')}`);
    }
    return resolveMaterializedRuntimeEffects(
      resolved.mechanics,
      registry,
      `${path}->${reference}`,
      [...resolving, reference],
    ) as T;
  }

  return Object.fromEntries(Object.entries(record).map(([key, nested]) => [
    key,
    resolveMaterializedRuntimeEffects(nested, registry, `${path}.${key}`, resolving),
  ])) as T;
}
