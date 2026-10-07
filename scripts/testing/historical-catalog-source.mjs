// Frozen, source-backed PUBLIC catalog inputs for historical migration tests.
// This module never reads dumps, imports support/certificates, or writes a DB.
import assert from 'node:assert/strict';
import {readFile,lstat,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';

const directory=fileURLToPath(new URL('./fixtures/historical-catalog/',import.meta.url));
export const historicalCatalogManifestHash="sha256:ecd833e983374f5c9c5da614c2cd7179817453f9ca505723719b661d35012aa2";
const contracts=Object.freeze({pre278:1575,pre279:2374,caster296:42,cardMembership:1011});
const identities=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const privateFields=new Set(['author','support','user_id','group_id','owner_id','created_by','created_at','updated_at']);
const privateKeys=new Set(['author','support','user_id','group_id','owner_id','created_by','password','authorization','access_token','refresh_token','api_key','dsn']);
const mediaFields=new Set(['image_url','image_cloudinary_id','image_cloudinary_url','image_generated','image_generation_prompt']);
const kinds=new Set(['card','feat','spell','action','effect','resource','monster']);
export const historicalSourceHash=value=>'sha256:'+createHash('sha256').update(value).digest('hex');

function assertPublic(value){
 if(typeof value==='string')assert(!/(?:postgres(?:ql)?:\/\/|sk-(?:proj-)?[A-Za-z0-9]{16}|BEGIN [A-Z ]*PRIVATE KEY)/.test(value),'Credentials cannot be catalog fixture input');
 else if(value&&typeof value==='object')for(const[key,child]of Object.entries(value)){assert(!privateKeys.has(key),'Private metadata cannot be catalog fixture input');assertPublic(child);}
}
export function projectHistoricalCatalogEntity(entity){
 assert(entity&&kinds.has(entity.kind)&&identities.test(entity.id));assert(entity.row&&entity.row.id===entity.id);
 // Values are projected from the actual saved row. Guards only validate them.
 const row=Object.fromEntries(Object.entries(entity.row).filter(([key])=>!privateFields.has(key)&&!mediaFields.has(key)));
 const projected={kind:entity.kind,id:entity.id,row,provenance:structuredClone(entity.provenance)};assertPublic(projected);return projected;
}
export function validateHistoricalCatalogDataset(data,dataset){
 assert(Object.hasOwn(contracts,dataset));assert.equal(data.schemaVersion,1);assert.equal(data.dataset,dataset);
 assert.deepEqual(Object.keys(data).sort(),['dataset','rows','schemaVersion']);assert(Array.isArray(data.rows));assert.equal(data.rows.length,contracts[dataset]);assertPublic(data);
 const keys=[];
 for(const row of data.rows){
  assert(identities.test(row.id));
  if(dataset==='cardMembership'){
   assert.deepEqual(Object.keys(row).sort(),['deleted_at','id','name','reference']);assert.equal(typeof row.reference,'string');assert.equal(typeof row.name,'string');assert(row.deleted_at===null||typeof row.deleted_at==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(row.deleted_at));keys.push(row.id);
  }else if(dataset==='caster296'){
   assert(['classes','effects'].includes(row.table));assert.equal(row.fields.id,row.id);assert.equal(row.fields.card_number,row.reference);assert.equal(typeof row.sourceDumpHash,'string');assert.equal(typeof row.sourceProjectionHash,'string');keys.push(row.table+':'+row.id);
  }else{
   assert(kinds.has(row.kind));assert.equal(row.row.id,row.id);assert(Object.keys(row.row).every(key=>/^[a-z][a-z0-9_]*$/.test(key)&&!privateFields.has(key)&&!mediaFields.has(key)));const reference=row.row[row.kind==='resource'?'resource_id':row.kind==='monster'?'slug':'card_number'];assert.equal(typeof reference,'string');assert(reference.length);assert(row.provenance&&typeof row.provenance==='object');keys.push(row.kind+':'+row.id);
  }
 }
 assert.equal(new Set(keys).size,keys.length,'Ambiguous source identities');return data;
}
export function decodeHistoricalCatalogDataset(bytes,entry,dataset){
 assert(Number.isSafeInteger(entry.bytes)&&entry.bytes>0&&entry.bytes<=2*1024**2);assert.equal(bytes.length,entry.bytes);assert.equal(historicalSourceHash(bytes),entry.sha256);
 assert(Number.isSafeInteger(entry.jsonBytes)&&entry.jsonBytes>0&&entry.jsonBytes<=24*1024**2);
 const json=gunzipSync(bytes,{maxOutputLength:entry.jsonBytes});assert.equal(json.length,entry.jsonBytes);assert.equal(historicalSourceHash(json),entry.jsonSha256);
 // JSON parse failures are data errors; never echo a dataset to command output.
 let data;try{data=JSON.parse(json);}catch{throw Error('Historical public catalog JSON is invalid');}
 return validateHistoricalCatalogDataset(data,dataset);
}
export async function loadHistoricalCatalogSources(){
 assert.equal(await realpath(directory),path.resolve(directory),'Fixture directory must be real');
 const manifestFile=path.join(directory,'manifest.json');assert(!(await lstat(manifestFile)).isSymbolicLink());const bytes=await readFile(manifestFile);assert.equal(historicalSourceHash(bytes),historicalCatalogManifestHash,'Reviewed public source manifest changed');const manifest=JSON.parse(bytes);assert.equal(manifest.schemaVersion,1);assert.equal(manifest.productionBootstrap,false);assert.equal(manifest.originalFullSnapshot,false);assert.deepEqual(Object.keys(manifest.datasets).sort(),Object.keys(contracts).sort());
 const datasets={};
 for(const[dataset,entry]of Object.entries(manifest.datasets)){assert.equal(entry.file,dataset+'.json.gz');const file=path.join(directory,entry.file);assert.equal(await realpath(file),file);assert(!(await lstat(file)).isSymbolicLink());datasets[dataset]=decodeHistoricalCatalogDataset(await readFile(file),entry,dataset);}
 const pre278=new Map(datasets.pre278.rows.map(row=>[row.kind+':'+row.id,row]));
 for(const row of datasets.pre279.rows){const previous=pre278.get(row.kind+':'+row.id);if(previous){const column=row.kind==='resource'?'resource_id':row.kind==='monster'?'slug':'card_number';assert.equal(previous.row[column],row.row[column]);}}
 const pre279=new Map(datasets.pre279.rows.map(row=>[row.kind+':'+row.id,row]));assert([...pre278.keys()].every(key=>pre279.has(key)),'278 identity source must remain covered');
 const identityUnion=datasets.pre279.rows.map(candidate=>{const earlier=pre278.get(candidate.kind+':'+candidate.id),row=earlier??candidate,dataset=earlier?'pre278':'pre279',column=row.kind==='resource'?'resource_id':row.kind==='monster'?'slug':'card_number';return {...row,reference:row.row[column],identitySource:{dataset,originalSourceSha256:manifest.datasets[dataset].originalSourceSha256}};});
 assert.equal(datasets.cardMembership.rows.filter(row=>row.deleted_at===null).length,886);
 return {manifest,manifestHash:historicalCatalogManifestHash,...datasets,identityUnion};
}
