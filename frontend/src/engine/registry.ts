/**
 * Реестр сущностей по slug (card_number). Чистый TS — резолвер инъецируется.
 */

export type EntityKind = 'spell' | 'action' | 'effect' | 'feat';

export interface EntityResolver {
  resolveSpell(slug: string): Promise<unknown | null>;
  resolveAction(slug: string): Promise<unknown | null>;
  resolveEffect(slug: string): Promise<unknown | null>;
  resolveFeat(slug: string): Promise<unknown | null>;
}

export interface BrokenRef {
  kind: EntityKind;
  slug: string;
  source: string;
}

export interface Registry {
  resolve<T = unknown>(kind: EntityKind, slug: string): Promise<T | null>;
  resolveMany<T = unknown>(kind: EntityKind, slugs: string[]): Promise<(T | null)[]>;
  auditRefs(refs: BrokenRef[]): Promise<BrokenRef[]>;
  clearCache(): void;
}

function cacheKey(kind: EntityKind, slug: string): string {
  return `${kind}:${slug}`;
}

export function createRegistry(resolver: EntityResolver): Registry {
  const cache = new Map<string, unknown | null>();

  async function resolveOne<T>(kind: EntityKind, slug: string): Promise<T | null> {
    const key = cacheKey(kind, slug);
    if (cache.has(key)) return cache.get(key) as T | null;

    let entity: unknown | null = null;
    switch (kind) {
      case 'spell':
        entity = await resolver.resolveSpell(slug);
        break;
      case 'action':
        entity = await resolver.resolveAction(slug);
        break;
      case 'effect':
        entity = await resolver.resolveEffect(slug);
        break;
      case 'feat':
        entity = await resolver.resolveFeat(slug);
        break;
    }
    cache.set(key, entity);
    return entity as T | null;
  }

  return {
    async resolve<T = unknown>(kind: EntityKind, slug: string): Promise<T | null> {
      return resolveOne<T>(kind, slug);
    },

    async resolveMany<T = unknown>(kind: EntityKind, slugs: string[]): Promise<(T | null)[]> {
      return Promise.all(slugs.map((slug) => resolveOne<T>(kind, slug)));
    },

    async auditRefs(refs: BrokenRef[]): Promise<BrokenRef[]> {
      const broken: BrokenRef[] = [];
      for (const ref of refs) {
        const entity = await resolveOne(ref.kind, ref.slug);
        if (!entity) broken.push(ref);
      }
      return broken;
    },

    clearCache() {
      cache.clear();
    },
  };
}

/** Извлечь slug-ссылки из JSON механик (grant_spell, feat, class и т.д.). */
export function collectMechanicRefs(
  mechanics: unknown,
  source: string,
  out: BrokenRef[] = [],
): BrokenRef[] {
  if (!mechanics || typeof mechanics !== 'object') return out;

  const walk = (node: unknown, path: string) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    const obj = node as Record<string, unknown>;
    if (obj.kind === 'grant_spell' && typeof obj.value === 'string') {
      out.push({ kind: 'spell', slug: obj.value, source: `${source}${path}.grant_spell` });
    }
    if (obj.type === 'feat' && typeof obj.value === 'string') {
      out.push({ kind: 'feat', slug: obj.value, source: `${source}${path}.feat` });
    }
    if (typeof obj.effect_id === 'string') {
      out.push({ kind: 'effect', slug: obj.effect_id, source: `${source}${path}.effect_id` });
    }
    if (typeof obj.action_id === 'string') {
      out.push({ kind: 'action', slug: obj.action_id, source: `${source}${path}.action_id` });
    }
    for (const [k, v] of Object.entries(obj)) {
      walk(v, `${path}.${k}`);
    }
  };

  walk(mechanics, '');
  return out;
}
