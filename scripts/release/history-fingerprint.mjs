// Preserve the existing complete, sorted row-hash multiset exactly.
// No cached baseline, skipped table, sampled row, or new digest protocol.
const id=value=>{if(!/^[a-z_][a-z0-9_]*$/.test(value))throw Error('Unsupported catalog identifier');return `"${value}"`;};
export function oldColumns(table,baselineIds){
 const added=[];
 if(table==='roguelike_runs'&&!baselineIds.includes('299_frozen_combat_catalogs'))added.push('combat_catalog_ref');
 if(['roguelike_command_receipts','character_runtime_commands'].includes(table)&&!baselineIds.includes('298_compact_command_receipts'))added.push('response_version','response_payload','response_sha256','response_length');
 if(['characters_v3','roguelike_runs'].includes(table)&&!baselineIds.includes('301_character_lifecycle'))added.push('deleted_at');
 if(!baselineIds.includes('307_catalog_presentation')){
  if(['actions','spells'].includes(table))added.push('is_narrative');
  if(table==='effects')added.push('is_technical');
 }
 return added;
}
export function historyQuery(tables,baselineIds,{project=false,parallel=false}={}){
 const branches=tables.map(({name,columns})=>{
  const excluded=oldColumns(name,baselineIds);id(name);columns.forEach(id);
  const removed=excluded.length?`ARRAY[${excluded.map(x=>`'${x}'`).join(',')}]::text[]`:'ARRAY[]::text[]';
  const source=project?`(SELECT ${columns.filter(c=>!excluded.includes(c)).map(c=>`t.${id(c)}`).join(',')} FROM public.${id(name)} t) p`:`public.${id(name)} t`;
  const value=project?'to_jsonb(p)':`(to_jsonb(t)-${removed})`;
  if(parallel)return `SELECT '${name}'::text AS name,encode(sha256(convert_to(${value}::text,'UTF8')),'hex') AS h FROM ${source}`;
  return `SELECT '${name}' AS name,count(*) AS rows,encode(sha256(convert_to(coalesce(string_agg(h,'' ORDER BY h),''),'UTF8')),'hex') AS content FROM (SELECT encode(sha256(convert_to(${value}::text,'UTF8')),'hex') h FROM ${source}) q`;
 });
 if(parallel)return `WITH row_hashes AS MATERIALIZED (${branches.join(' UNION ALL ')}) SELECT json_agg(q ORDER BY name) FROM (SELECT names.name,coalesce(g.rows,0) AS rows,coalesce(g.content,encode(sha256(convert_to('','UTF8')),'hex')) AS content FROM (VALUES ${tables.map(t=>`('${t.name}')`).join(',')}) names(name) LEFT JOIN (SELECT name,count(*) AS rows,encode(sha256(convert_to(string_agg(h,'' ORDER BY h),'UTF8')),'hex') AS content FROM row_hashes GROUP BY name) g USING(name)) q;`;
 return `SELECT json_agg(q ORDER BY name) FROM (${branches.join(' UNION ALL ')}) q;`;
}

// Only a disposable rehearsal uses this complete scan. Keep the existing
// row bytes and sorted multiset, including empty tables and duplicate rows.
// Session-local planning settings permit two workers on the large relation;
// independent table aggregates otherwise leave that relation on one worker.
export function parallelHistoryReadSQL(tables,baselineIds){
 return "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;SET LOCAL parallel_setup_cost=0;SET LOCAL parallel_tuple_cost=0;SET LOCAL min_parallel_table_scan_size=0;SET LOCAL max_parallel_workers_per_gather=2;SET LOCAL parallel_leader_participation=off;"+historyQuery(tables,baselineIds,{project:true,parallel:true})+'ROLLBACK;';
}
