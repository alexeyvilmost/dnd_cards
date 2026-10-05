#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {assertTestDsn,assertRealOwnedPath} from '../testing/guards.mjs';
import {runsRoot,readRegistry,cleanEnvironment,execute} from '../testing/runtime.mjs';
import {collectStorageReport} from './storage-report.mjs';
import {collectDataURLInventory} from './data-url-inventory.mjs';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const identifier=value=>{if(!/^[a-z_][a-z0-9_]*$/.test(value))throw Error('Unsupported SQL identifier');return `"${value}"`;};
const recoverableDDL=row=>/^[a-z_][a-z0-9_]*$/.test(row.name)&&/^[a-z_][a-z0-9_]*$/.test(row.relation)&&new RegExp(`^CREATE INDEX ${row.name} ON public\\.${row.relation} USING btree \\([a-z_][a-z0-9_]*(?:, [a-z_][a-z0-9_]*)*\\)$`).test(row.definition);
const safeIndex=row=>row.is_valid===true&&row.is_ready===true&&row.is_unique===false&&row.is_primary===false&&row.is_replica_identity===false&&Number(row.dependants)===0&&row.is_simple_btree===true&&recoverableDDL(row);
const preimage=row=>({relation:row.relation,name:row.name,definition:row.definition,semantic_definition:row.semantic_definition,is_valid:row.is_valid,is_ready:row.is_ready,is_primary:row.is_primary,is_unique:row.is_unique,is_replica_identity:row.is_replica_identity,dependants:Number(row.dependants),is_simple_btree:row.is_simple_btree});
const literal=value=>`convert_from(decode('${Buffer.from(value).toString('hex')}','hex'),'UTF8')`;
// Same semantic projection as storage-inventory.sql, re-read while holding the
// table lock. Checking only the printed CREATE INDEX misses validity/dependants.
const indexPreimageSQL=name=>`(SELECT jsonb_build_object('relation',t.relname,'name',c.relname,
  'definition',pg_get_indexdef(c.oid),'semantic_definition',jsonb_build_object('table',x.indrelid,'access_method',c.relam,
  'keys',x.indkey::text,'operator_classes',x.indclass::text,'collations',x.indcollation::text,'options',x.indoption::text,
  'key_columns',x.indnkeyatts,'all_columns',x.indnatts,'predicate',pg_get_expr(x.indpred,x.indrelid),'expressions',pg_get_expr(x.indexprs,x.indrelid),
  'unique',x.indisunique,'nulls_not_distinct',x.indnullsnotdistinct,'tablespace',c.reltablespace,'storage_options',c.reloptions)::text,
  'is_valid',x.indisvalid,'is_ready',x.indisready,'is_primary',x.indisprimary,'is_unique',x.indisunique,'is_replica_identity',x.indisreplident,
  'dependants',(SELECT count(*) FROM pg_depend d WHERE d.refclassid='pg_class'::regclass AND d.refobjid=c.oid),
  'is_simple_btree',x.indexprs IS NULL AND x.indpred IS NULL AND x.indnkeyatts=x.indnatts AND a.amname='btree')
  FROM pg_class c JOIN pg_index x ON x.indexrelid=c.oid JOIN pg_class t ON t.oid=x.indrelid JOIN pg_am a ON a.oid=c.relam
  WHERE c.oid=to_regclass(${literal('public.'+name)}))`;

async function indexOperation(database,registry,saved,restore=false) {
  const {drop,keep}=saved.proof;
  const expected=literal(JSON.stringify(saved));
  const result=await database.query(`BEGIN;SET LOCAL lock_timeout='250ms';SET LOCAL statement_timeout='5s';SET LOCAL client_min_messages='warning';
    SELECT pg_advisory_xact_lock(1840829154,14);
    CREATE TABLE IF NOT EXISTS public.test_retention_operations(candidate_id text PRIMARY KEY,prepared jsonb NOT NULL,status text NOT NULL CHECK(status IN ('applied','restored')));
    LOCK TABLE public.${identifier(drop.relation)} IN SHARE MODE;
    DO $operation$ DECLARE prepared jsonb := ${expected}::jsonb; previous public.test_retention_operations%ROWTYPE;
      actual_drop jsonb; actual_keep jsonb; outcome text;
    BEGIN
      IF (SELECT run_id FROM public.test_run_ownership FOR SHARE) IS DISTINCT FROM ${literal(registry.runId)} THEN RAISE EXCEPTION 'ownership marker changed'; END IF;
      SELECT * INTO previous FROM public.test_retention_operations WHERE candidate_id=${literal(saved.candidateId)} FOR UPDATE;
      IF FOUND AND previous.prepared IS DISTINCT FROM prepared THEN RAISE EXCEPTION 'prepared identity changed'; END IF;
      actual_drop := ${indexPreimageSQL(drop.name)}; actual_keep := ${indexPreimageSQL(keep.name)};
      IF actual_keep IS DISTINCT FROM prepared->'proof'->'keep' THEN RAISE EXCEPTION 'retained index preimage changed'; END IF;
      ${restore ? `
      IF previous.candidate_id IS NULL THEN RAISE EXCEPTION 'owned applied operation missing'; END IF;
      IF previous.status='restored' THEN
        IF actual_drop IS DISTINCT FROM prepared->'proof'->'drop' THEN RAISE EXCEPTION 'restored index preimage changed'; END IF;
        outcome := 'already_restored';
      ELSE
        IF actual_drop IS NOT NULL THEN RAISE EXCEPTION 'dropped index was recreated outside this operation'; END IF;
        ${drop.definition};
        UPDATE public.test_retention_operations SET status='restored' WHERE candidate_id=${literal(saved.candidateId)};
        outcome := 'restored';
      END IF;` : `
      IF previous.candidate_id IS NOT NULL THEN
        IF previous.status<>'applied' OR actual_drop IS NOT NULL THEN RAISE EXCEPTION 'applied operation postimage changed'; END IF;
        outcome := 'already_applied';
      ELSE
        IF actual_drop IS DISTINCT FROM prepared->'proof'->'drop' THEN RAISE EXCEPTION 'index preimage changed'; END IF;
        DROP INDEX public.${identifier(drop.name)};
        INSERT INTO public.test_retention_operations(candidate_id,prepared,status) VALUES(${literal(saved.candidateId)},prepared,'applied');
        outcome := 'applied';
      END IF;`}
      PERFORM set_config('bagofholding.retention_outcome',outcome,true);
    END $operation$;
    SELECT json_build_object('status',current_setting('bagofholding.retention_outcome'));COMMIT;`).catch(()=>{throw Error('Index operation failed: preimage changed, ownership changed or acknowledgement unavailable; retry the same prepared identity');});
  return JSON.parse(result.replace(/^\s*$/gm,'').trim());
}

export function buildRetentionPlan(report,dataURLs=null) {
  if(report.scope!=='local-disposable-database')throw Error('Only an owned local inventory may produce an executable plan');
  const candidates=[],groups=new Map();
  for(const row of report.inventory.indexes) {
    if(!safeIndex(row)||typeof row.semantic_definition!=='string')continue;
    identifier(row.name);identifier(row.relation);
    const key=`${row.relation}:${row.semantic_definition}`;
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);
  }
  for(const rows of groups.values()) {
    rows.sort((a,b)=>a.name.localeCompare(b.name));
    for(const duplicate of rows.slice(1)) {
      const retained=rows[0];
      const proof={drop:preimage(duplicate),keep:preimage(retained)};
      candidates.push({id:hash(proof),kind:'exact-duplicate-nonunique-index',proof,estimatedIndexBytes:duplicate.bytes,
        reason:'Exact same valid plain btree semantics and no constraints/dependants. Scan counters are not the justification.'});
    }
  }
  const plan={schemaVersion:1,scope:'owned-local-only',runId:report.run_id,createdAt:new Date().toISOString(),sourceCollectedAt:report.inventory.collected_at,
    statisticsReset:report.inventory.stats_reset,candidates,dataURLs,protected:[
      {category:'characters,runs,paper_documents,images',decision:'retain',reason:'Owner data; soft deletion and non-use are not authorization for physical deletion.'},
      {category:'command receipts and journals',decision:'retain',reason:'Durable idempotency and history; no TTL, trigger removal or response rewrite.'},
      {category:'frozen catalogs and rules CJS',decision:'retain',reason:'Union of active/history/pending/backups/rollback references; incomplete inventory blocks deletion.'},
      {category:'unused subsystem tables',decision:'retain',reason:'Need ownership/lifecycle, query-window and recovery evidence before any archival choice.'}],
    retentionJobsEnabled:false,productionActionsSupported:false,limitations:['Exact duplicates only; unique/partial/expression/include/replica/constraint-dependent indexes are never executable candidates.','Statistics window is reported. Zero scans alone never imply a removable index.','Data URL inventory is metadata-only; external object migration requires separate authorization and exact reference preservation.','Ordinary VACUUM may reuse dead space and is not a promise of shrinking files or OS disk usage.']};
  return {...plan,planHash:hash(plan)};
}
export function verifyRetentionPlan(plan) {
  const {planHash,...body}=plan;
  if(body.schemaVersion!==1||body.scope!=='owned-local-only'||hash(body)!==planHash||!Array.isArray(body.candidates)||body.retentionJobsEnabled!==false||body.productionActionsSupported!==false)throw Error('Invalid or modified retention plan');
  return plan;
}

export async function ownedRetentionDatabase({dsn,registry}) {
  assertTestDsn(dsn,registry);await assertRealOwnedPath(runsRoot,registry.directory);
  if(registry.status!=='ready'||registry.database?.driver!=='native')throw Error('A ready owned native stand is required');
  const url=new URL(dsn),env=cleanEnvironment({PGHOST:url.hostname,PGPORT:url.port,PGDATABASE:url.pathname.slice(1),PGUSER:url.username,PGPASSWORD:decodeURIComponent(url.password),PGSSLMODE:'disable',PGCONNECT_TIMEOUT:'5'});
  const query=sql=>execute(registry.database.psql,['-X','-q','-A','-t','-v','ON_ERROR_STOP=1'],{env,input:sql,timeout:15_000});
  if((await query('SELECT run_id FROM public.test_run_ownership;')).trim()!==registry.runId)throw Error('Owned database marker mismatch');
  return {query,dsn};
}

export async function applyOneDuplicate({dsn,registry,plan,candidateId}) {
  verifyRetentionPlan(plan);if(plan.runId!==registry.runId)throw Error('Plan belongs to another owned stand');
  const database=await ownedRetentionDatabase({dsn,registry});
  const candidate=plan.candidates.find(row=>row.id===candidateId);
  if(!candidate||hash(candidate.proof)!==candidateId)throw Error('Invalid prepared candidate');
  const {drop,keep}=candidate.proof;
  if(!safeIndex(drop)||!safeIndex(keep)||drop.relation!==keep.relation||drop.name===keep.name||drop.semantic_definition!==keep.semantic_definition)throw Error('Invalid duplicate proof');
  const directory=path.join(registry.directory,'index-recovery');await mkdir(directory,{recursive:true});await assertRealOwnedPath(registry.directory,directory);
  const exported={schemaVersion:2,scope:'owned-index-recovery',runId:registry.runId,planHash:plan.planHash,candidateId,proof:candidate.proof};
  const exportPath=path.join(directory,`${candidateId}.json`), bytes=JSON.stringify({...exported,exportHash:hash(exported)},null,2)+'\n';
  try {await writeFile(exportPath,bytes,{flag:'wx',mode:0o600});}
  catch(error) {if(error.code!=='EEXIST')throw error;await assertRealOwnedPath(directory,exportPath);if(await readFile(exportPath,'utf8')!==bytes)throw Error('Prepared recovery export changed');}
  const result=await indexOperation(database,registry,exported);
  return {...result,scope:'owned-local-only',candidateId,exportPath};
}

export async function restoreOneDuplicate({dsn,registry,exportPath}) {
  const database=await ownedRetentionDatabase({dsn,registry});await assertRealOwnedPath(registry.directory,exportPath);
  const {exportHash,...saved}=JSON.parse(await readFile(exportPath,'utf8'));
  if(![1,2].includes(saved.schemaVersion)||saved.scope!=='owned-index-recovery'||saved.runId!==registry.runId||hash(saved)!==exportHash||hash(saved.proof)!==saved.candidateId)throw Error('Invalid index recovery export');
  const {drop}=saved.proof;identifier(drop.name);identifier(drop.relation);
  // Only plain column btree indexes emitted by the strict candidate selector.
  if(!safeIndex(drop))throw Error('Recovery DDL requires an explicit reviewed adapter');
  if(saved.schemaVersion===2) {
    if(!/^[a-f0-9]{64}$/.test(saved.planHash??'')||!safeIndex(saved.proof.keep)||saved.proof.keep.relation!==drop.relation)throw Error('Invalid prepared recovery identity');
    return {...await indexOperation(database,registry,saved,true),candidateId:saved.candidateId};
  }
  // Explicit legacy v1 export restore: no invented operation receipt or retry
  // proof. Existing historical export bytes are not rewritten.
  await database.query(`BEGIN;SET LOCAL lock_timeout='250ms';SET LOCAL statement_timeout='5s';${drop.definition};COMMIT;`);
  const actual=(await database.query(`SELECT pg_get_indexdef('public.${drop.name}'::regclass);`)).trim();
  if(actual!==drop.definition)throw Error('Restored index definition differs');return {status:'restored',candidateId:saved.candidateId};
}

async function main() {
  const args=process.argv.slice(2),options={};
  for(let i=0;i<args.length;i+=2){if(!['--run-directory','--output','--plan','--candidate','--restore'].includes(args[i])||!args[i+1]||Object.hasOwn(options,args[i]))throw Error('Explicit named local retention options required');options[args[i]]=args[i+1];}
  const registry=await readRegistry(path.resolve(options['--run-directory'])),dsn=process.env.TEST_DATABASE_URL;
  if(options['--restore']){console.log(JSON.stringify(await restoreOneDuplicate({dsn,registry,exportPath:path.resolve(options['--restore'])})));return;}
  if(options['--plan']){if(!options['--candidate'])throw Error('Choose exactly one candidate');console.log(JSON.stringify(await applyOneDuplicate({dsn,registry,plan:JSON.parse(await readFile(options['--plan'],'utf8')),candidateId:options['--candidate']})));return;}
  if(!options['--output'])throw Error('Explicit new output required');
  const database=await ownedRetentionDatabase({dsn,registry}),report=await collectStorageReport({dsn,registry});
  const plan=buildRetentionPlan(report,await collectDataURLInventory(database));await writeFile(options['--output'],JSON.stringify(plan,null,2)+'\n',{flag:'wx'});console.log('Owned retention plan saved; no changes applied.');
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main().catch(()=>{process.stderr.write('Local retention action failed; no automatic retry or broad cleanup.\n');process.exitCode=1;});
