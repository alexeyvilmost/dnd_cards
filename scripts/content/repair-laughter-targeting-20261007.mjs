import {spawnSync} from 'node:child_process';
import {mkdirSync,openSync,writeFileSync,fsyncSync,closeSync} from 'node:fs';
import {dirname,isAbsolute,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {assertPrivateRegularFile} from './private-artifact.mjs';

// Reviewed content correction, never an engine branch or a schema migration.
export const laughterTargetingPatch={entityId:'4abefac8-329b-4c70-a59a-84dca2d194d3',baseTargets:1};
export function missingBaseTargetPlan(row,baseTargets){
 if(!Number.isInteger(baseTargets)||baseTargets<1||baseTargets>100)throw Error('Invalid reviewed base target count');
 const targeting=row?.mechanics?.targeting;
 if(!row||row.deleted_at||targeting?.shape!=='multiple'||Object.hasOwn(targeting,'max_targets'))return null;
 if(targeting.min_targets!==undefined&&targeting.min_targets!==baseTargets)throw Error('Custom minimum target count requires review');
 return {mechanics:{...row.mechanics,targeting:{...targeting,min_targets:baseTargets,max_targets:baseTargets}},support:{...row.support,status:'not_verified'}};
}
const protectedRuns=`SELECT encode(sha256(convert_to(COALESCE(jsonb_agg(jsonb_build_object(
 'id',id,'combat_envelope',combat_envelope,'combat_catalog',combat_catalog,'combat_catalog_ref',combat_catalog_ref,
 'encounter',encounter,'history',checkpoint->'encounter_history') ORDER BY id),'[]'::jsonb)::text,'UTF8')),'hex') FROM roguelike_runs`;
const protectedCatalogs=`SELECT encode(sha256(convert_to(COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.user_id,c.content_hash),'[]'::jsonb)::text,'UTF8')),'hex') FROM frozen_combat_catalogs c`;
function query(sql){
 if(!process.env.DATABASE_URL)throw Error('DATABASE_URL must be supplied privately');
 const database=new URL(process.env.DATABASE_URL);
 if(!['postgres:','postgresql:'].includes(database.protocol)||!database.hostname)throw Error('PostgreSQL URI required');
 const environment={...process.env,PGHOST:database.hostname,PGPORT:database.port||'5432',
  PGUSER:decodeURIComponent(database.username),PGPASSWORD:decodeURIComponent(database.password),PGDATABASE:decodeURIComponent(database.pathname.slice(1))};
 const parameters={sslmode:'PGSSLMODE',sslrootcert:'PGSSLROOTCERT',sslcert:'PGSSLCERT',sslkey:'PGSSLKEY',connect_timeout:'PGCONNECT_TIMEOUT',options:'PGOPTIONS'};
 for(const [key,value] of database.searchParams){if(!parameters[key])throw Error('Unsupported private connection parameter');environment[parameters[key]]=value;}
 const result=spawnSync(process.env.PSQL_BIN||'psql',['-X','-q','-v','ON_ERROR_STOP=1','-At','-f','-'],{
  input:sql,encoding:'utf8',timeout:120000,maxBuffer:32*1024*1024,env:environment});
 if(result.status!==0)throw Error('Database operation was not confirmed; inspect the private archive and current state before retrying');
 const lines=result.stdout.trim().split(/\r?\n/).filter(line=>line.startsWith('{'));
 if(lines.length!==1)throw Error('Unexpected database evidence');
 return JSON.parse(lines[0]);
}
export function targetingRepairSQL(expectedHash){
 if(!/^sha256:[a-f0-9]{64}$/.test(expectedHash))throw Error('Exact reviewed preimage hash required');
 const {entityId,baseTargets}=laughterTargetingPatch;
 return `BEGIN ISOLATION LEVEL REPEATABLE READ;
 SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='90s';
 DO $repair$
 DECLARE original spells%ROWTYPE; repaired spells%ROWTYPE; runs_before text; catalogs_before text;
 BEGIN
 SELECT * INTO STRICT original FROM spells WHERE id='${entityId}' FOR UPDATE;
 IF 'sha256:'||encode(sha256(convert_to(to_jsonb(original)::text,'UTF8')),'hex') <> '${expectedHash}' THEN
  RAISE EXCEPTION 'Reviewed preimage changed'; END IF;
 IF original.deleted_at IS NOT NULL OR original.mechanics#>>'{targeting,shape}' IS DISTINCT FROM 'multiple'
  OR jsonb_typeof(original.mechanics->'targeting') IS DISTINCT FROM 'object'
  OR (original.mechanics->'targeting' ? 'min_targets' AND original.mechanics#>'{targeting,min_targets}' IS DISTINCT FROM '${baseTargets}'::jsonb)
  OR original.mechanics->'targeting' ? 'max_targets' THEN RAISE EXCEPTION 'Repair predicate changed'; END IF;
 runs_before := (${protectedRuns}); catalogs_before := (${protectedCatalogs});
 UPDATE spells SET mechanics=jsonb_set(jsonb_set(mechanics,'{targeting,max_targets}','${baseTargets}'::jsonb,true),'{targeting,min_targets}','${baseTargets}'::jsonb,true),
  support=COALESCE(support,'{}'::jsonb)||'{"status":"not_verified"}'::jsonb,updated_at=NOW() WHERE id='${entityId}';
 SELECT * INTO STRICT repaired FROM spells WHERE id='${entityId}';
 IF (to_jsonb(repaired)-'mechanics'-'support'-'updated_at') IS DISTINCT FROM (to_jsonb(original)-'mechanics'-'support'-'updated_at')
  OR repaired.mechanics IS DISTINCT FROM jsonb_set(jsonb_set(original.mechanics,'{targeting,max_targets}','${baseTargets}'::jsonb,true),'{targeting,min_targets}','${baseTargets}'::jsonb,true)
  OR repaired.support IS DISTINCT FROM COALESCE(original.support,'{}'::jsonb)||'{"status":"not_verified"}'::jsonb THEN
  RAISE EXCEPTION 'Unexpected entity changes'; END IF;
 IF (${protectedRuns}) <> runs_before OR (${protectedCatalogs}) <> catalogs_before THEN
  RAISE EXCEPTION 'Frozen history changed'; END IF;
 END $repair$;
 COMMIT;
 SELECT json_build_object('status','applied','affected',1,'entityId','${entityId}',
 'afterHash',(SELECT 'sha256:'||encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') FROM spells s WHERE id='${entityId}'),
 'runsHash',(${protectedRuns}),'catalogsHash',(${protectedCatalogs}));`;
}
export function runTargetingRepair(args){
 const apply=args.includes('--apply'),option=name=>args.find(arg=>arg.startsWith(name+'='))?.slice(name.length+1);
 const inspection=query(`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
 SELECT json_build_object('row',to_jsonb(s),'beforeHash','sha256:'||encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex'),
 'runsHash',(${protectedRuns}),'catalogsHash',(${protectedCatalogs})) FROM spells s WHERE id='${laughterTargetingPatch.entityId}'; ROLLBACK;`);
 const plan=missingBaseTargetPlan(inspection.row,laughterTargetingPatch.baseTargets);
 const summary={status:plan?'planned':'not-needed',affected:plan?1:0,entityId:laughterTargetingPatch.entityId,
  beforeHash:inspection.beforeHash,runsHash:inspection.runsHash,catalogsHash:inspection.catalogsHash};
 if(!apply||!plan)return summary;
 if(option('--expected-before')!==inspection.beforeHash)throw Error('Apply requires the exact hash from the read-only plan');
 const archive=option('--archive');
 if(!archive||!isAbsolute(archive))throw Error('Apply requires an absolute private archive path');
 const boundary=assertPrivateRegularFile(archive,'Before archive',{allowMissing:true});
 if(boundary.exists)throw Error('Before archive already exists; never overwrite it');
 mkdirSync(dirname(archive),{recursive:true,mode:0o700});
 const file=openSync(archive,'wx',0o600);
 try{writeFileSync(file,JSON.stringify({schemaVersion:1,operation:'laughter-base-targets',...inspection,expectedAfter:plan},null,2)+'\n');fsyncSync(file);}finally{closeSync(file);}
 assertPrivateRegularFile(archive,'Before archive');
 return {...query(targetingRepairSQL(inspection.beforeHash)),archive:resolve(archive)};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 try{console.log(JSON.stringify(runTargetingRepair(process.argv.slice(2))));}
 catch(error){console.error(error.message);process.exitCode=1;}
}
