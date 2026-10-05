import type {AssembledCharacter, EntityBundle} from './assemblyFactory';
import type {CharacterDraft} from './types';

function exactInputKey(input: unknown): string | null {
  const seen = new Set<object>();
  const encode = (value: unknown): unknown => {
    if (value === null) return ['null'];
    if (typeof value === 'undefined') return ['undefined'];
    if (typeof value === 'string' || typeof value === 'boolean') return [typeof value, value];
    if (typeof value === 'number') return ['number', Object.is(value, -0) ? '-0' : String(value)];
    if (typeof value !== 'object' || seen.has(value)) throw new Error('Unsupported static input');
    seen.add(value);
    try {
      if (Array.isArray(value)) return ['array', value.map(encode)];
      if (![null, Object.prototype].includes(Object.getPrototypeOf(value))) throw new Error('Non-JSON static input');
      return ['object', Object.entries(value).map(([key, item]) => [key, encode(item)])];
    } finally {seen.delete(value);}
  };
  try {return JSON.stringify(encode(input));} catch {return null;}
}

/** Browser-only reuse of the pure projection AFTER the canonical dependency
 * loader runs. No request, permission decision, runtime, seed or command is
 * retained. Exact loaded content and every draft field participate in the key.
 * The module instance is the executable boundary; an updated build starts empty.
 * Limits bound entries/serialized input size, not JS heap accounting. */
export function createAssemblyMemo(session: () => string | null, maxEntries = 4) {
  const entries = new Map<string, AssembledCharacter>();
  let owner: string | null | undefined;
  return (bundle: EntityBundle, draft: CharacterDraft, build: () => AssembledCharacter): AssembledCharacter => {
    const current = session();
    if (owner !== current) {entries.clear(); owner = current;}
    const key = exactInputKey([bundle, draft]);
    if (key === null || key.length > 262_144 || maxEntries < 1) return build();
    const hit = entries.get(key);
    if (hit) {entries.delete(key); entries.set(key, hit); return structuredClone(hit);}
    const value = build();
    // Keep a private copy: item grants and caller projections may enrich their
    // returned assembly without mutating another sheet or later preview.
    if (JSON.stringify(value).length <= 262_144) {
      entries.set(key, structuredClone(value));
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value!);
    }
    return value;
  };
}
