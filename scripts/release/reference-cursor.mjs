import {databaseSchemaLedgerProof} from './database-schema-proof.mjs';
import {scanCompactReceipts} from '../database/receipt-codec.mjs';
import {normalizeMediaReference} from './reference-values.mjs';
import {isCanonicalReleaseColumn,canonicalSourceReleaseReferences,canonicalReleaseTables} from './source-release-references.mjs';
const id=s=>{if(!/^[a-z_][a-z0-9_]*$/.test(s))throw Error('Unsupported catalog identifier');return `"${s}"`;};
const artifactKeys=new Set(['artifactHash','artifact_hash']);
const mediaKeys=new Set(['image_url','token_url','avatar_url','imageUrl','tokenUrl','avatarUrl']);
export function collectReferences(value,{canonical=false,releaseHash,artifactSet,sourceReleaseSet,mediaSet}){
 const pending=[value];while(pending.length){const current=pending.pop();if(!current||typeof current!=='object')continue;
  for(const [key,nested] of Object.entries(current)){
   if(typeof nested==='string'){
    if(canonical&&['rulesArtifactHash','rules_artifact_hash'].includes(key)){if(nested!==releaseHash)throw Error('Canonical JSON release binding differs');if(nested)sourceReleaseSet.add(nested);}
    else if(nested&&artifactKeys.has(key))artifactSet.add(nested);
    else if(nested&&mediaKeys.has(key))mediaSet.add(JSON.stringify(normalizeMediaReference(nested)));
   }else if(nested&&typeof nested==='object')pending.push(nested);
  }
 }
}
// Adapter contract: query runs inside one pinned readonly RR session; rows sends
// each result line to a synchronous consumer with a bounded UTF-8 line buffer.
export async function cursorInventory(database,{pageRows=64,columnsPerBatch=64}={}){
 if(!Number.isInteger(pageRows)||pageRows<1||pageRows>256||!Number.isInteger(columnsPerBatch)||columnsPerBatch<1||columnsPerBatch>64)throw Error('Bounded cursor configuration required');
 const query=sql=>database.query(sql,undefined,{sensitive:true});
 const inheritance=JSON.parse(await query(`WITH RECURSIVE descendants(root,child) AS (SELECT c.oid,i.inhrelid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_inherits i ON i.inhparent=c.oid WHERE n.nspname='public' UNION SELECT d.root,i.inhrelid FROM descendants d JOIN pg_inherits i ON i.inhparent=d.child)
 SELECT json_build_object('externalChildren',coalesce(bool_or(n.nspname<>'public'),false),'canonicalRoots',coalesce(bool_or(r.relname IN (${canonicalReleaseTables.map(t=>`'${t}'`).join(',')})),false)) FROM descendants d JOIN pg_class c ON c.oid=d.child JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_class r ON r.oid=d.root;`));
 // Deliberate refusal, not a complete inventory: broader qualified relation
 // closure is a separate required extension before supporting these layouts.
 if(inheritance.externalChildren||inheritance.canonicalRoots)throw Error('Reference inheritance closure needs explicit provenance');
 const columns=JSON.parse(await query(`SELECT coalesce(json_agg(json_build_object('table',c.relname,'column',a.attname,'type',CASE a.atttypid WHEN 114 THEN 'json' WHEN 3802 THEN 'jsonb' ELSE format_type(a.atttypid,a.atttypmod) END,'relation_kind',c.relkind,'oid',c.oid::text,'filenode',c.relfilenode::text,'domain',t.typtype='d') ORDER BY c.relname,a.attnum),'[]'::json)
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid JOIN pg_type t ON t.oid=a.atttypid
 WHERE n.nspname='public' AND c.relkind IN ('r','p','m','v','f') AND c.relname<>'test_run_ownership' AND a.attnum>0 AND NOT a.attisdropped;`));
 if(columns.some(c=>c.domain))throw Error('Domain columns need explicit reference type proof');
 const budget={bytes:0,count:0};class BoundedSet extends Set{add(value){if(!this.has(value)){const bytes=Buffer.byteLength(value);if(budget.bytes+bytes>32*1024*1024||budget.count+1>262144)throw Error('Bounded reference inventory exceeded');budget.bytes+=bytes;budget.count++;}return super.add(value);}}
 const artifactSet=new BoundedSet(),sourceReleaseSet=new BoundedSet(),mediaSet=new BoundedSet(),tables=new Map();
 for(const column of columns){
  const kind=['json','jsonb'].includes(column.type)?'json':isCanonicalReleaseColumn(column)?'source-release':['artifact_hash','rules_artifact_hash'].includes(column.column)?'artifact':
   ['image_url','image_url_spent','token_url','avatar_url','image_cloudinary_url'].includes(column.column)||column.table==='audio_cues'&&column.column==='url'?'media':null;
  if(!kind)continue;if(!['r','p','m'].includes(column.relation_kind))throw Error('Unsupported non-stored reference relation');
  if(column.relation_kind==='p')continue; // Every actual leaf is independently in pg_class and scanned ONLY once.
  if(!tables.has(column.table))tables.set(column.table,[]);tables.get(column.table).push({...column,kind});
 }
 // Retain locks for the whole pinned transaction, so a later physical relation
 // cannot be truncated/replaced while an earlier table is being streamed.
 // Parsing a zero-row SELECT acquires the same ACCESS SHARE lock and also
 // supports materialized views, which LOCK TABLE does not uniformly accept.
 for(const table of [...tables.keys()].sort())await query(`SELECT NULL FROM ONLY public.${id(table)} LIMIT 0;`);
 // TRUNCATE/physical rewrites are not MVCC-safe if they happened after the
 // export but before these locks. Compare pinned catalog identity with the
 // current relcache mapping after locks; dropped/replaced OIDs also refuse.
 const physical=[...tables].map(([table,fields])=>({table,oid:fields[0].oid,filenode:fields[0].filenode}));
 if(physical.some(row=>!/^\d+$/.test(row.oid)||!/^\d+$/.test(row.filenode)||row.filenode==='0'))throw Error('Stored reference relation identity unavailable');
 if(physical.length){
  const observed=JSON.parse(await query(`SELECT json_agg(json_build_object('oid',expected.oid::text,'filenode',pg_relation_filenode(expected.oid)::text) ORDER BY expected.oid) FROM unnest(ARRAY[${physical.map(row=>row.oid).join(',')}]::oid[]) expected(oid);`));
  if(!Array.isArray(observed)||observed.length!==physical.length||physical.some(row=>!observed.some(actual=>actual.oid===row.oid&&actual.filenode===row.filenode)))throw Error('Reference physical relation changed since exported snapshot');
 }
 const snapshot=(await query('SELECT pg_current_snapshot()::text;')).trim();let pages=0,rowsRead=0,index=0;
 for(const [table,fields]of tables)for(let start=0;start<fields.length;start+=columnsPerBatch){
  const batch=fields.slice(start,start+columnsPerBatch),canonical=canonicalReleaseTables.includes(table)&&columns.some(c=>c.table===table&&c.column==='rules_artifact_hash');
  const expressions=batch.map(c=>c.kind==='json'?`to_jsonb(${id(c.column)})`:`to_jsonb(${id(c.column)}::text)`);if(canonical)expressions.push('to_jsonb(rules_artifact_hash::text)');
  const cursor=`reference_cursor_${index++}`;await query(`DECLARE ${cursor} NO SCROLL CURSOR FOR SELECT jsonb_build_array(${expressions.join(',')})::text FROM ONLY public.${id(table)};`);
  try{
   for(;;){let count=0;await database.rows(`FETCH FORWARD ${pageRows} FROM ${cursor};`,line=>{
    let values;try{values=JSON.parse(line);}catch{throw Error('Invalid cursor JSON row');}
    if(!Array.isArray(values)||values.length!==expressions.length)throw Error('Cursor field count differs');count++;rowsRead++;
    for(let i=0;i<batch.length;i++){const field=batch[i],value=values[i];
     if(field.kind==='json')collectReferences(value,{canonical,releaseHash:canonical?values.at(-1):undefined,artifactSet,sourceReleaseSet,mediaSet});
     else if(value!==null){if(typeof value!=='string')throw Error('Invalid text reference type');if(!value)continue;if(field.kind==='artifact')artifactSet.add(value);else if(field.kind==='source-release')sourceReleaseSet.add(value);else mediaSet.add(JSON.stringify(normalizeMediaReference(value)));}
    }
   });pages++;if(count>pageRows)throw Error('Cursor exceeded page limit');if(count<pageRows)break;
   }
  }finally{await query(`CLOSE ${cursor};`);}
 }
 await scanCompactReceipts(database,response=>collectReferences(response,{artifactSet,sourceReleaseSet,mediaSet}));
 const artifactHashes=[...artifactSet].sort();if(artifactHashes.some(v=>!/^sha256:[a-f0-9]{64}$/.test(v)))throw Error('Unrecognized executable reference');
 const sourceReleaseReferences=await canonicalSourceReleaseReferences(database,columns,sourceReleaseSet),schema=await databaseSchemaLedgerProof(database);
 if((await query('SELECT pg_current_snapshot()::text;')).trim()!==snapshot)throw Error('Cursor visibility changed');
 return {referenceInventoryVersion:2,artifactInventoryComplete:true,artifactHashes,sourceReleaseReferences,allDetectedRuleHashes:[...new Set([...artifactHashes,...sourceReleaseSet])].sort(),mediaReferences:[...mediaSet].sort().map(x=>JSON.parse(x)),migrations:schema.migrations,schemaFingerprint:schema.schemaFingerprint,
 scan:{scope:'all-public-json-columns-and-declared-text-reference-columns',method:'readonly-rr-cursor-per-physical-relation',jsonColumns:columns.filter(c=>['json','jsonb'].includes(c.type)).length,pageRows,columnsPerBatch,pages,rowsRead,consistentVisibility:true}};
}
