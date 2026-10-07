import test from 'node:test';
import assert from 'node:assert/strict';
import {historicalCatalogConditions,evaluateHistoricalCatalogCondition,inspectHistoricalCatalog} from './historical-catalog-preconditions.mjs';
import {loadHistoricalCatalogSources} from './historical-catalog-source.mjs';
const source=await loadHistoricalCatalogSources();
const plan=await historicalCatalogConditions(278);
function actual(entry,dataset=source.pre278){const e=entry.entity,row=dataset.rows.find(row=>row.kind===e.entity_type&&row.id===e.id).row;return {id:row.id,reference:row[row.resource_id?'resource_id':row.slug?'slug':'card_number'],active:true,rowHash:'a'.repeat(64),description:row.description,detailed_description:row.detailed_description,differentColumns:[]};}
test('portable manifest coverage includes every original guard and insert for both phases',async()=>{
  assert.equal(plan.entries.length,1656);assert.equal(plan.entries.filter(row=>row.entity.preimage==null).length,51);
  const next=await historicalCatalogConditions(279);assert.equal(next.entries.length,2564);assert.equal(next.entries.filter(row=>row.entity.preimage==null).length,190);
  for(const phase of [plan,next])for(const file of phase.sourceFiles)assert.match(file.sha256,/^sha256:[a-f0-9]{64}$/);
});
test('different entity data use the same identity, activity, description and field checks',()=>{
  for(const kind of ['spell','resource']){
    const entry=plan.entries.find(row=>row.entity.entity_type===kind&&row.entity.preimage!=null),row=actual(entry);
    assert.equal(evaluateHistoricalCatalogCondition(entry,[row]).status,'passed');
    for(const change of [{active:false},{reference:'wrong'},{description:'changed'},{differentColumns:['mechanics']}])assert.equal(evaluateHistoricalCatalogCondition(entry,[{...row,...change}]).status,'failed');
    assert.equal(evaluateHistoricalCatalogCondition(entry,[]).status,'failed');assert.equal(evaluateHistoricalCatalogCondition(entry,[row,row]).status,'failed');
  }
});
test('insertion guards require complete absence and cannot reuse a matching current row',()=>{
  const entry=plan.entries.find(row=>row.entity.preimage==null);
  assert.equal(evaluateHistoricalCatalogCondition(entry,[]).status,'passed');
  const row={id:entry.entity.id,reference:entry.entity.card_number,active:true,rowHash:'b'.repeat(64),description:null,detailed_description:null,differentColumns:[]};
  assert.equal(evaluateHistoricalCatalogCondition(entry,[row]).status,'failed');
});
test('inspection refuses unsupported phase and wrong ledger before reading any entity',async()=>{
  await assert.rejects(historicalCatalogConditions('278; DROP TABLE cards'),/Unsupported/);
  const calls=[];await assert.rejects(inspectHistoricalCatalog(async sql=>{calls.push(sql);return '307_catalog_presentation';},278),/preceding ledger/);assert.equal(calls.length,1);
});
test('condition reports do not disclose source descriptions or private metadata',()=>{
  const entry=plan.entries.find(row=>row.entity.entity_type==='spell'&&row.entity.preimage!=null),row=actual(entry),result=evaluateHistoricalCatalogCondition(entry,[row]);
  for(const field of ['description','detailed_description','support','author','user_id'])assert(!Object.hasOwn(result,field));
});
function fixtureQuery({activeCards=886,duplicateResult=false,conditions=plan,dataset=source.pre278}={}){
  return async sql=>{
    assert(sql.startsWith('SELECT '),'Inspection must issue read-only queries');
    if(sql==='SELECT max(version) FROM schema_migrations;')return conditions.boundary;
    if(sql==='SELECT count(*) FROM cards WHERE deleted_at IS NULL;')return String(activeCards);
    const ordinals=[...sql.matchAll(/SELECT (\d+) AS ordinal/g)].map(match=>Number(match[1]));assert(ordinals.length>0&&ordinals.length<=32);
    const values=ordinals.map(ordinal=>({ordinal,matches:conditions.entries[ordinal].entity.preimage==null?[]:[actual(conditions.entries[ordinal],dataset)]}));
    if(duplicateResult&&values.length>1)values[1]=values[0];return JSON.stringify(values);
  };
}
test('full inspection counts every guard but active-card drift still refuses acceptance',async()=>{
  const good=await inspectHistoricalCatalog(fixtureQuery(),278);assert.equal(good.targets,1656);assert.equal(good.passed,1656);assert.equal(good.status,'passed');assert.equal(good.scope.historicalChainVerified,false);
  const conditions=await historicalCatalogConditions(279);assert(conditions.counts.length>0);
  const next=await inspectHistoricalCatalog(fixtureQuery({conditions,dataset:source.pre279}),279);assert.equal(next.status,'passed');assert.equal(next.targets,2564);
  const drift=await inspectHistoricalCatalog(fixtureQuery({conditions,dataset:source.pre279,activeCards:885}),279);assert.equal(drift.failed,0);assert.equal(drift.status,'failed');assert(drift.counts.some(count=>count.status==='failed'));
});
test('duplicated query results cannot conceal a missing original condition',async()=>{
  await assert.rejects(inspectHistoricalCatalog(fixtureQuery({duplicateResult:true}),278),/Missing, duplicated or reordered/);
});
