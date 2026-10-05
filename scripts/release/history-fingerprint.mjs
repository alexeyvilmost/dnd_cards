// Preserve the existing complete, sorted row-hash multiset exactly.
// No cached baseline, skipped table, sampled row, or new digest protocol.
const id=value=>{if(!/^[a-z_][a-z0-9_]*$/.test(value))throw Error('Unsupported catalog identifier');return `"${value}"`;};
export function oldColumns(table,baselineIds){
 return table==='roguelike_runs'&&!baselineIds.includes('299_frozen_combat_catalogs')?['combat_catalog_ref']:
 ['roguelike_command_receipts','character_runtime_commands'].includes(table)&&!baselineIds.includes('298_compact_command_receipts')?['response_version','response_payload','response_sha256','response_length']:[];
}
export function historyQuery(tables,baselineIds,{project=false}={}){
 const branches=tables.map(({name,columns})=>{
  const excluded=oldColumns(name,baselineIds);id(name);columns.forEach(id);
  const removed=excluded.length?`ARRAY[${excluded.map(x=>`'${x}'`).join(',')}]::text[]`:'ARRAY[]::text[]';
  const source=project?`(SELECT ${columns.filter(c=>!excluded.includes(c)).map(c=>`t.${id(c)}`).join(',')} FROM public.${id(name)} t) p`:`public.${id(name)} t`;
  const value=project?'to_jsonb(p)':`(to_jsonb(t)-${removed})`;
  return `SELECT '${name}' AS name,count(*) AS rows,encode(sha256(convert_to(coalesce(string_agg(h,'' ORDER BY h),''),'UTF8')),'hex') AS content FROM (SELECT encode(sha256(convert_to(${value}::text,'UTF8')),'hex') h FROM ${source}) q`;
 });
 return `SELECT json_agg(q ORDER BY name) FROM (${branches.join(' UNION ALL ')}) q;`;
}
