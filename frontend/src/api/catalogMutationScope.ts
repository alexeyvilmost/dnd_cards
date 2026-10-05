type Row = Record<string, unknown>;
type Observed = {key: string; revision: number; signature: string};
const object = (value: unknown): value is Row => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const has = (row: Row, key: string) => Object.prototype.hasOwnProperty.call(row, key);
function character(row: unknown): Observed | null {
  if (!object(row) || typeof row.id !== 'string' || typeof row.user_id !== 'string'
    || !has(row, 'equipment') || !has(row, 'inventory_items') || !Number.isSafeInteger(row.runtime_revision)) return null;
  if ((row.equipment !== null && !object(row.equipment)) || !Array.isArray(row.inventory_items)) return null;
  const ids = new Set<string>();
  for (const id of Object.values(object(row.equipment) ? row.equipment : {})) if (typeof id === 'string') ids.add(id);
  for (const item of Array.isArray(row.inventory_items) ? row.inventory_items : []) {
    if (!object(item) || typeof item.card_id !== 'string') return null;
    ids.add(item.card_id);
  }
  return {key: `character/${row.id}`, revision: row.runtime_revision as number,
    signature: JSON.stringify([row.user_id, row.character_type, [...ids].sort()])};
}
function observations(data: unknown): Observed[] {
  if (!object(data)) return [];
  if (object(data.run)) {
    const run = data.run;
    if (typeof run.id !== 'string' || typeof run.user_id !== 'string' || !Number.isSafeInteger(run.revision)
      || !has(run, 'shop') || !has(run, 'last_reward') || !has(run, 'party')) return [];
    const rows = [run.character, ...(Array.isArray(run.characters) ? run.characters : [])].filter(Boolean).map(character);
    if (!rows.length || rows.some(row => !row)) return [];
    return [{key: `run/${run.id}`, revision: run.revision as number,
      signature: JSON.stringify([run.user_id, run.character_id, run.status, run.party, run.shop, run.last_reward,
        rows.map(row => [row!.key, row!.signature]).sort(([a], [b]) => a.localeCompare(b))])}, ...rows as Observed[]];
  }
  if (Array.isArray(data.participants)) {
    const rows = data.participants.map(row => object(row) ? character(row.character) : null);
    return rows.length && rows.every(Boolean) ? rows as Observed[] : [];
  }
  const row = character(data); return row ? [row] : [];
}

/** A conservative invalidation hint, never authority or a cache freshness proof.
 * Only known full pre/postimages with identical ownership keep the catalog.
 * Unknown shapes, older receipts and unobserved preimages invalidate normally. */
export function createCatalogMutationScope() {
  const seen = new Map<string, Observed>();
  let owner: string | null | undefined;
  return ({method, url, data, session}: {method: string; url: string; data: unknown; session: string | null}): boolean => {
    if (session !== owner) {seen.clear(); owner = session;}
    const path = url.split(/[?#]/)[0];
    if (!/^\/api\/(?:characters-v3|roguelike)(?:\/|$)/.test(path)) return false;
    const rows = observations(data);
    const narrow = /^\/api\/characters-v3\/[^/]+\/(?:runtime|equipment-commands)$/.test(path)
      || path === '/api/characters-v3/runtime-commands' || /^\/api\/roguelike\/runs\/[^/]+\/commands$/.test(path);
    const unchanged = method !== 'get' && narrow && rows.length > 0 && rows.every(row => {
      const previous = seen.get(row.key);
      return previous && row.revision >= previous.revision && previous.signature === row.signature;
    });
    for (const row of rows) {
      const previous = seen.get(row.key);
      if (!previous || row.revision >= previous.revision) {seen.delete(row.key); seen.set(row.key, row);}
    }
    while (seen.size > 256) seen.delete(seen.keys().next().value!);
    return unchanged;
  };
}
