/** Embedded database snapshots can contain the JSON text of the properties column. */
export function cardPropertyList(value: unknown): string[] {
  if(value==null)return [];
  if(typeof value==='string'){
    try { const parsed:unknown=JSON.parse(value); if(Array.isArray(parsed))return parsed.filter((item):item is string=>typeof item==='string'); }
    catch { /* A plain single property is also an older supported representation. */ }
    return value.trim()?[value]:[];
  }
  return Array.isArray(value)?value.filter((item):item is string=>typeof item==='string'):[];
}
