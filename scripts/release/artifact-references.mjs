import {databaseSchemaLedgerProof} from './database-schema-proof.mjs';
import {scanCompactReceipts} from '../database/receipt-codec.mjs';
import {normalizeMediaReference,mediaReferenceSQL} from './reference-values.mjs';
import {isCanonicalReleaseColumn,canonicalSourceReleaseReferences,canonicalReleaseTables} from './source-release-references.mjs';
const identifier = value => {if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw Error('Unsupported database identifier'); return `"${value}"`;};
export async function databaseRecoveryInventory(database, {pageRows=64,columnsPerBatch=4}={}) {
  if(!Number.isInteger(pageRows)||pageRows<1||pageRows>256||!Number.isInteger(columnsPerBatch)||columnsPerBatch<1||columnsPerBatch>16)throw Error('Bounded inventory page configuration required');
  const query = sql => database.query(sql, undefined, {sensitive:true});
  // Multiple short statements must see the same committed rows. A caller may
  // import one exported repeatable-read snapshot in every query. Otherwise a
  // concurrent transaction changes this token and the scan refuses completeness.
  const snapshot=()=>query('SELECT pg_current_snapshot()::text;');
  const initialSnapshot=(await snapshot()).trim();
  const columns = JSON.parse((await query(`SELECT coalesce(json_agg(json_build_object('table',c.table_name,'column',c.column_name,'type',c.data_type,'relation_kind',r.relkind) ORDER BY c.table_name,c.column_name),'[]'::json)
    FROM information_schema.columns c JOIN pg_namespace n ON n.nspname=c.table_schema JOIN pg_class r ON r.relnamespace=n.oid AND r.relname=c.table_name
    WHERE c.table_schema='public' AND c.table_name <> 'test_run_ownership';`)).trim());
  const artifactSet=new Set(),sourceReleaseSet=new Set(),mediaSet=new Set(),tables=new Map();let pages=0;
  const artifactKeys=['artifactHash','artifact_hash'],mediaKeys=['image_url','token_url','avatar_url','imageUrl','tokenUrl','avatarUrl'];
  for (const column of columns) {
    const kind=['json','jsonb'].includes(column.type)?'json':isCanonicalReleaseColumn(column)?'source-release':['artifact_hash','rules_artifact_hash'].includes(column.column)?'artifact':
      ['image_url','image_url_spent','token_url','avatar_url','image_cloudinary_url'].includes(column.column)||column.table==='audio_cues'&&column.column==='url'?'media':null;
    if(!kind)continue;
    if(!['r','p','m'].includes(column.relation_kind))throw Error('Reference inventory requires stored local relations; unsupported view/foreign relation');
    if(!tables.has(column.table))tables.set(column.table,[]);tables.get(column.table).push({...column,kind});
  }
  for(const [tableName,fields] of tables)for(let start=0;start<fields.length;start+=columnsPerBatch){
    const batch=fields.slice(start,start+columnsPerBatch);let cursor=['0','(0,0)'],limit=pageRows;
    const canonicalBinding=canonicalReleaseTables.includes(tableName)&&columns.some(row=>row.table===tableName&&row.column==='rules_artifact_hash');
    const selectedFields=[...new Set([...batch.map(c=>c.column),...(canonicalBinding?['rules_artifact_hash']:[])])];
    for(;;){
      if(!/^\d+$/.test(cursor[0])||!/^\(\d+,\d+\)$/.test(cursor[1]))throw Error('Invalid physical reference cursor');
      const selections=batch.map(column=>{
        const field=identifier(column.column);
        if(column.kind!=='json')return `SELECT '${column.kind}' AS kind,${field}::text AS value FROM page WHERE ${field} IS NOT NULL`;
        const predicate=[...artifactKeys,...mediaKeys,...(canonicalBinding?['rulesArtifactHash','rules_artifact_hash']:[])].map(key=>`@.key == "${key}"`).join(' || ');
        const semantic=canonicalBinding?`WHEN j->>'key' IN ('rulesArtifactHash','rules_artifact_hash') THEN CASE WHEN j->>'value'=rules_artifact_hash THEN 'source-release' ELSE 'invalid-source-release' END `:'';
        return `SELECT CASE ${semantic}WHEN j->>'key' IN ('artifactHash','artifact_hash') THEN 'artifact' ELSE 'media' END AS kind,j->>'value' AS value FROM page CROSS JOIN LATERAL jsonb_path_query(to_jsonb(${field}), 'strict $.** ? (@.type() == "object").keyvalue() ? (${predicate})', '{}'::jsonb, true) j WHERE jsonb_typeof(j->'value')='string'`;
      });
      let page;
      try{page=JSON.parse((await query(`WITH page AS MATERIALIZED (SELECT tableoid::oid AS scan_tableoid,ctid AS scan_tid,${selectedFields.map(identifier).join(',')} FROM public.${identifier(tableName)} WHERE ROW(tableoid::oid,ctid)>ROW(${cursor[0]}::oid,'${cursor[1]}'::tid) ORDER BY tableoid::oid,ctid LIMIT ${limit}), refs AS (${selections.join(' UNION ALL ')}), unique_refs AS (SELECT DISTINCT kind,CASE WHEN kind='media' THEN ${mediaReferenceSQL('value')} ELSE to_jsonb(value) END AS value FROM refs WHERE value <> '' OR kind='invalid-source-release')
        SELECT json_build_object('count',(SELECT count(*) FROM page),'cursor',(SELECT json_build_array(scan_tableoid::text,scan_tid::text) FROM page ORDER BY scan_tableoid DESC,scan_tid DESC LIMIT 1),'values',(SELECT coalesce(json_agg(json_build_object('kind',kind,'value',value) ORDER BY kind,value),'[]'::json) FROM unique_refs));`)).trim());}
      catch(error){if(limit>1&&['ENOBUFS','PG_STATEMENT_TIMEOUT','57014'].includes(error.code)){limit=Math.max(1,Math.floor(limit/2));continue;}throw error;}
      pages++;
      if(!Number.isInteger(page.count)||page.count<0||page.count>limit||!Array.isArray(page.values))throw Error('Invalid bounded reference page');
      for(const ref of page.values){if(ref.kind==='artifact'||ref.kind==='source-release'){if(typeof ref.value!=='string'||!ref.value)throw Error('Invalid artifact page value');(ref.kind==='artifact'?artifactSet:sourceReleaseSet).add(ref.value);}else if(ref.kind==='media')mediaSet.add(JSON.stringify(normalizeMediaReference(ref.value)));else throw Error('Invalid reference page kind');}
      if(page.count<limit)break;
      if(!Array.isArray(page.cursor)||page.cursor.length!==2||JSON.stringify(page.cursor)===JSON.stringify(cursor))throw Error('Reference scan cursor did not advance');cursor=page.cursor;
    }
  }
  const walk = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, nested] of Object.entries(value)) {
      if (typeof nested === 'string' && nested) {
        if (['artifactHash','artifact_hash'].includes(key)) artifactSet.add(nested);
        if (['image_url','token_url','avatar_url','imageUrl','tokenUrl','avatarUrl'].includes(key)) mediaSet.add(JSON.stringify(normalizeMediaReference(nested)));
      } else walk(nested);
    }
  };
  await scanCompactReceipts(database, walk);
  const artifactHashes = [...artifactSet].sort();
  if (artifactHashes.some(value => !/^sha256:[a-f0-9]{64}$/.test(value))) throw Error('Database contains an unrecognized artifact reference; inventory cannot be declared complete');
  const mediaReferences = [...mediaSet].sort().map(value=>JSON.parse(value));
  const sourceReleaseReferences=await canonicalSourceReleaseReferences(database,columns,sourceReleaseSet);
  const schemaProof=await databaseSchemaLedgerProof(database);
  if((await snapshot()).trim()!==initialSnapshot)throw Error('Database visibility snapshot changed during reference inventory; repeat from a stable snapshot');
  return {referenceInventoryVersion:2,artifactInventoryComplete: true, artifactHashes,sourceReleaseReferences,allDetectedRuleHashes:[...new Set([...artifactHashes,...sourceReleaseSet])].sort(),mediaReferences, migrations:schemaProof.migrations, schemaFingerprint:schemaProof.schemaFingerprint,
    scan: {scope: 'all-public-json-columns-and-declared-text-reference-columns', jsonColumns: columns.filter(column => ['json', 'jsonb'].includes(column.type)).length,pageRows,columnsPerBatch,pages,consistentVisibility:true}};
}
