// Read-only inspection of original migration guards, not a bootstrap or repair.
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {historicalSourceHash} from './historical-catalog-source.mjs';

const tables=Object.freeze({card:'cards',feat:'feats',spell:'spells',action:'actions',effect:'effects',resource:'resources',monster:'monsters'});
const phases=Object.freeze({
  278:{boundary:'277_partial_narrative_review',directory:'catalog-audit-20260929',targets:1656},
  279:{boundary:'278_catalog_mechanics_audit',directory:'item-completion-279',targets:2564},
});
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const literal=value=>{assert.equal(typeof value,'string');return "'"+value.replaceAll("'","''")+"'";};
const column=kind=>kind==='resource'?'resource_id':kind==='monster'?'slug':'card_number';

export async function historicalCatalogConditions(phase){
  assert(Object.hasOwn(phases,phase),'Unsupported historical catalog phase');
  const config=phases[phase],base=new URL('../../backend/migrations/data/'+config.directory+'/',import.meta.url);
  const entries=[],sourceFiles=[],counts=[];
  for(const file of (await readdir(base)).filter(name=>name.endsWith('.json')).sort()){
    const bytes=await readFile(new URL(file,base)),manifest=JSON.parse(bytes);
    assert.equal(manifest.schema_version,1);
    sourceFiles.push({path:'backend/migrations/data/'+config.directory+'/'+file,sha256:historicalSourceHash(bytes),bytes:bytes.length});
    if(manifest.expected_active_cards!==undefined){assert(Number.isSafeInteger(manifest.expected_active_cards)&&manifest.expected_active_cards>0);counts.push({table:'cards',expected:manifest.expected_active_cards});}
    for(const [key,guard]of [['entities',false],['guards',true]])for(const entity of manifest[key]??[]){
      assert(Object.hasOwn(tables,entity.entity_type));assert(uuid.test(entity.id));assert.equal(typeof entity.card_number,'string');assert(entity.card_number.length);
      assert(entity.preimage==null||typeof entity.preimage==='object'&&!Array.isArray(entity.preimage));
      if(entity.preimage!=null){assert(Object.keys(entity.preimage).every(key=>/^[a-z][a-z0-9_]*$/.test(key)));assert.match(entity.description_sha256,/^[a-f0-9]{64}$/);}
      entries.push({entity,file,guard});
    }
  }
  assert.equal(entries.length,config.targets,'Original guard coverage changed');
  return {...config,phase:Number(phase),entries,sourceFiles,counts};
}

export function evaluateHistoricalCatalogCondition({entity:e,file,guard},matches){
  assert(Array.isArray(matches));
  for(const row of matches){assert(uuid.test(row.id));assert.equal(typeof row.reference,'string');assert.equal(typeof row.active,'boolean');assert.match(row.rowHash,/^[a-f0-9]{64}$/);assert(Array.isArray(row.differentColumns)&&row.differentColumns.every(key=>typeof key==='string'));}
  const actual=matches.length===1?matches[0]:null,identityExact=Boolean(actual&&actual.id===e.id&&actual.reference===e.card_number&&actual.active);
  const descriptionExact=Boolean(actual&&historicalSourceHash(JSON.stringify([actual.description??null,actual.detailed_description??null]))==='sha256:'+e.description_sha256);
  const insert=e.preimage==null,success=insert?matches.length===0:identityExact&&descriptionExact&&actual.differentColumns.length===0;
  return {file,guard,kind:e.entity_type,id:e.id,reference:e.card_number,insert,matches:matches.length,identityExact,descriptionExact,
    differentColumns:actual?.differentColumns??[],actualRowHash:actual?'sha256:'+actual.rowHash:null,
    expectedFieldsHash:historicalSourceHash(JSON.stringify(e.preimage??null)),status:success?'passed':'failed'};
}

export async function inspectHistoricalCatalog(query,phase){
  assert.equal(typeof query,'function');const plan=await historicalCatalogConditions(phase);
  assert.equal((await query('SELECT max(version) FROM schema_migrations;')).trim(),plan.boundary,'Historical inspection requires the exact preceding ledger boundary');
  const counts=[];for(const count of plan.counts){const raw=(await query('SELECT count(*) FROM cards WHERE deleted_at IS NULL;')).trim();assert(/^\d+$/.test(raw));const actual=Number(raw);assert(Number.isSafeInteger(actual));counts.push({...count,actual,status:actual===count.expected?'passed':'failed'});}
  const rows=[];
  for(let offset=0;offset<plan.entries.length;offset+=32){
    const group=plan.entries.slice(offset,offset+32),pieces=group.map(({entity:e},index)=>
      `SELECT ${offset+index} AS ordinal,coalesce(json_agg(json_build_object('id',t.id::text,'reference',t.${column(e.entity_type)},'active',t.deleted_at IS NULL,'rowHash',encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'description',t.description,'detailed_description',to_jsonb(t)->'detailed_description','differentColumns',(SELECT coalesce(json_agg(k ORDER BY k),'[]'::json) FROM (SELECT key k FROM jsonb_each(${literal(JSON.stringify(e.preimage??{}))}::jsonb) WHERE (to_jsonb(t)->key) IS DISTINCT FROM value) d))),'[]'::json) AS matches FROM ${tables[e.entity_type]} t WHERE t.id=${literal(e.id)}::uuid OR t.${column(e.entity_type)}=${literal(e.card_number)}`);
    const values=JSON.parse(await query(`SELECT json_agg(row_to_json(x) ORDER BY ordinal) FROM (${pieces.join(' UNION ALL ')}) x;`));
    assert(Array.isArray(values));assert.equal(values.length,group.length);
    assert.deepEqual(values.map(value=>value.ordinal),group.map((_,i)=>offset+i),'Missing, duplicated or reordered guard results');
    for(const value of values)rows.push(evaluateHistoricalCatalogCondition(plan.entries[value.ordinal],value.matches));
  }
  const passed=rows.filter(row=>row.status==='passed').length;
  return {schemaVersion:1,kind:'read-only-original-catalog-preconditions',phase:plan.phase,boundary:plan.boundary,sourceFiles:plan.sourceFiles,
    counts,targets:rows.length,passed,failed:rows.length-passed,status:passed===rows.length&&counts.every(count=>count.status==='passed')?'passed':'failed',rows,
    scope:{mutation:false,preimagesReconstructed:false,historicalChainVerified:false}};
}
