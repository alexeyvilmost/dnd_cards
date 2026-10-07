// Additive fault rehearsal on disposable restored databases. Never called by
// the application and never introduces a production fault-injection flag.
import {randomBytes} from 'node:crypto';
import {evidenceHash,compositionFingerprint} from './validate-manifest.mjs';
import {databaseMigrationSet,migrationScenarios,migrationRequestBaseline,assertLegacyMigrationBinding,assertExecutableMigrationRegistry} from './migration-transition.mjs';
import {isLegacyBaseline} from './legacy-baseline.mjs';
import {parallelHistoryReadSQL} from './history-fingerprint.mjs';
const equal=(a,b)=>evidenceHash(a)===evidenceHash(b);
const hash=value=>typeof value==='string'&&/^sha256:[a-f0-9]{64}$/.test(value);
const allowed=new Set(['298_compact_command_receipts','299_frozen_combat_catalogs','300_image_jobs','301_character_lifecycle','307_catalog_presentation']);
function requestFor(input){
  assertLegacyMigrationBinding(input.active,input.manifest.migrationSet);
  const baseline=databaseMigrationSet(input.active),target=input.manifest.migrationSet;
  const legacy=isLegacyBaseline(input.active)&&!input.active.database,matches=(a,b)=>legacy?a.id===b.id:equal(a,b);
  for(const row of baseline)if(!target.some(other=>matches(row,other)))throw Error('Rehearsal cannot remove or alter an applied migration');
  const added=target.filter(row=>!baseline.some(other=>matches(row,other)));
  if(!added.length||added.some(row=>!allowed.has(row.id)))throw Error('Only the explicit additive allowlist can be rehearsed');
  return {...migrationRequestBaseline(input.active),releaseId:input.manifest.releaseId,target,
    candidateSourceCommit:input.manifest.components.backend.sourceCommit,candidateInputFingerprint:input.manifest.components.backend.inputFingerprint};
}
export const migrationRehearsalRequest=requestFor;
function receiptValid(receipt,request,{applied}={}){
  if(receipt?.schemaVersion!==1||receipt.status!=='verified'||receipt.result?.status!=='verified'||receipt.result.releaseId!==request.releaseId
    ||!hash(receipt.result.schemaProofHash)||!equal(receipt.result.observedVersions,request.target.map(row=>row.id).sort())
    ||receipt.build?.provenance!=='baked'||receipt.build.sourceCommit!==request.candidateSourceCommit||receipt.build.inputFingerprint!==request.candidateInputFingerprint
    ||!Array.isArray(receipt.result.applied)||applied!==undefined&&receipt.result.applied.length!==applied)throw Error('Exact-executable migration receipt mismatch');
  if(request.schemaVersion===2&&receipt.result.baselineObservationHash!==request.baselineObservationHash)throw Error('Exact legacy observation receipt required');
  return receipt;
}
const requestIds=request=>request.schemaVersion===2?request.expectedCurrentIds:request.expectedCurrent.map(row=>row.id);
const requestRows=request=>request.schemaVersion===2?request.expectedCurrentIds.map(id=>({id})):request.expectedCurrent;
async function rejected(fn){try{await fn();}catch{return;}throw Error('Negative migration scenario unexpectedly succeeded');}
function unchanged(before,after){if(!equal(before,after))throw Error('Failed migration changed committed schema, ledger or historical bytes');}

export async function runMigrationRehearsal(input,adapter){
  const request=requestFor(input),metadata=await adapter.preflight(input),trials=[];
  assertExecutableMigrationRegistry(metadata,request.target,requestRows(request));
  if(adapter.execution!=='docker'||metadata?.schemaVersion!==1
    ||!/^\d{1,19}$/.test(metadata.migrationLockId??'')||BigInt(metadata.migrationLockId)>9223372036854775807n
    ||metadata.build?.provenance!=='baked'||metadata.build.sourceCommit!==request.candidateSourceCommit||metadata.build.inputFingerprint!==request.candidateInputFingerprint)throw Error('Candidate embedded migration/lock metadata differs');
  for(const row of request.target.filter(row=>allowed.has(row.id)))if(!metadata.additiveMigrations?.some(actual=>equal(row,actual)))throw Error('Candidate source checksum differs from requested additive migration');
  const checks=[];
  const trial=async()=>{const id=await adapter.createTrial();trials.push(id);return id;};
  // Keep only databases still needed by later scenarios. In particular the
  // first trial must survive until repeat/schema proof; finished siblings do
  // not. Retain ownership until DROP succeeds so finally can retry cleanup.
  const retire=async id=>{await adapter.dropTrial(id);trials.splice(trials.indexOf(id),1);};
  const record=(id,proof)=>checks.push({id,status:'passed',...proof});
  let failed,cleanup,stage='atomic-ddl-ledger';
  try{
    const first=await trial(),before=await adapter.snapshot(first);
    if(!equal(before.versions,[...requestIds(request)].sort()))throw Error('Trial baseline ledger differs from approved predecessor');
    const applied=receiptValid(await adapter.execute(first,request),request,{applied:request.target.length-requestIds(request).length});
    const after=await adapter.snapshot(first);
    if(!equal(after.versions,request.target.map(row=>row.id).sort())||after.historyHash!==before.historyHash)throw Error('Successful expansion altered history or omitted ledger rows');
    record('atomic-ddl-ledger',{schemaProofHash:applied.result.schemaProofHash,historyHash:after.historyHash,versions:after.versions});

    stage='crash-before-ledger';const crash=await trial(),crashBefore=await adapter.snapshot(crash);let handle;
    try{
      handle=await adapter.beginBlocked(crash,request,'ledger',metadata.migrationLockId);
      const blocked=await adapter.observeBlocked(handle);
      if(blocked.stage!=='ledger-insert'||blocked.candidateConnections!==1||blocked.advisorySameSession!==true||blocked.ddlSameSession!==true)throw Error('Did not reach same-connection DDL before ledger');
      await adapter.kill(handle);
    }finally{if(handle)await adapter.release(handle);}
    unchanged(crashBefore,await adapter.snapshot(crash));
    receiptValid(await adapter.execute(crash,request),request);
    record('crash-before-ledger',{transactionRolledBack:true,restartPassed:true,committedBaselineHash:evidenceHash(crashBefore)});
    await retire(crash);

    // Treat the first successful receipt as lost: re-observe and run the same
    // immutable request again. No failure flag or hidden application branch.
    stage='repeat-after-commit';const observed=receiptValid(await adapter.execute(first,request,{inspectOnly:true}),request,{applied:0});
    const repeated=receiptValid(await adapter.execute(first,request),request,{applied:0});
    if(observed.result.schemaProofHash!==applied.result.schemaProofHash||repeated.result.schemaProofHash!==applied.result.schemaProofHash)throw Error('Lost-ack replay changed schema proof');
    unchanged(after,await adapter.snapshot(first));
    record('repeat-after-commit',{reapplied:0,schemaProofHash:repeated.result.schemaProofHash,historyHash:after.historyHash});

    stage='same-connection-lock';const locked=await trial();handle=undefined;
    try{
      handle=await adapter.beginBlocked(locked,request,'advisory',metadata.migrationLockId);
      const blocked=await adapter.observeBlocked(handle);
      if(blocked.stage!=='migration-lock'||blocked.candidateConnections!==1)throw Error('Candidate bypassed real startup migration lock');
      await adapter.release(handle);receiptValid(await adapter.finish(handle),request);
    }finally{if(handle)await adapter.release(handle);}
    record('same-connection-lock',{startupLockShared:true,ddlAndLedgerSessionVerified:true});
    await retire(locked);

    stage='unknown-migration-rejected';const unknown=await trial();await adapter.mutate(unknown,'unknown-ledger');const unknownBefore=await adapter.snapshot(unknown);
    await rejected(()=>adapter.execute(unknown,request));unchanged(unknownBefore,await adapter.snapshot(unknown));
    record('unknown-migration-rejected',{rejected:true,committedStateHash:evidenceHash(unknownBefore)});
    await retire(unknown);

    stage='schema-proof';await adapter.mutate(first,'trigger-when-false');const corrupt=await adapter.snapshot(first);
    await rejected(()=>adapter.execute(first,request,{inspectOnly:true}));await rejected(()=>adapter.execute(first,request));unchanged(corrupt,await adapter.snapshot(first));
    record('schema-proof',{tamperedTriggerRejected:true,noSilentRepair:true});
    await retire(first);

    // Main clone is expanded only after all destructive fault scenarios ran on
    // private sibling databases. Old app reads/retries remain on this clone.
    stage='old-readers-after-expansion';const mainBefore=await adapter.snapshot('main');receiptValid(await adapter.execute('main',request),request);
    if((await adapter.snapshot('main')).historyHash!==mainBefore.historyHash)throw Error('Main clone history changed during expansion');
    let oldProof;
    try{await adapter.startPrevious();oldProof=await adapter.oldReadProof();}
    finally{await adapter.stopApplications();}
    if(oldProof?.status!=='passed'||oldProof.checked!==true||!hash(oldProof.pendingHash)||!hash(oldProof.acceptedHash)||!hash(oldProof.invariantHash)
      ||(await adapter.snapshot('main')).historyHash!==mainBefore.historyHash)throw Error('Old backend reader/retry proof failed on expanded schema');
    record('old-readers-after-expansion',{...oldProof,writerFlagsOff:true});
  }catch(error){failed=error;}
  finally{
    const errors=[];for(const db of trials.reverse())try{await adapter.dropTrial(db);}catch{errors.push('owned-trial-cleanup-failed');}
    cleanup={status:errors.length?'failed':'trials-cleared',remaining:errors.length};if(errors.length)failed??=Error('Migration trial cleanup incomplete');
  }
  if(failed)throw Object.assign(Error('Exact-image additive rehearsal failed',{cause:failed}),{migrationReport:{status:'failed',failureStage:stage,checks,cleanup}});
  const report={schemaVersion:1,kind:'additive-migration-rehearsal',execution:'docker',status:'passed',candidateHash:input.candidateHash,
    candidateSourceCommit:request.candidateSourceCommit,candidateInputFingerprint:request.candidateInputFingerprint,
    baseline:requestRows(request),target:request.target,...(request.schemaVersion===2?{baselineObservationHash:request.baselineObservationHash}:{}),compositionFingerprint:compositionFingerprint(input.manifest),
    backwardCompatible:true,rollbackWriters:'off',scenarios:[...migrationScenarios],checks,cleanup};
  const approval={schemaVersion:1,mode:'additive-298-300',baseline:report.baseline,target:report.target,...(request.schemaVersion===2?{baselineObservationHash:request.baselineObservationHash}:{}),compositionFingerprint:report.compositionFingerprint,reportHash:evidenceHash(report)};
  const result={report,approval};validateMigrationRehearsal(input,result);return result;
}
export function validateMigrationRehearsal(input,result){
  const request=requestFor(input),r=result?.report,a=result?.approval;
  if(r?.schemaVersion!==1||r.kind!=='additive-migration-rehearsal'||r.execution!=='docker'||r.status!=='passed'||r.candidateHash!==input.candidateHash
    ||r.candidateSourceCommit!==request.candidateSourceCommit||r.candidateInputFingerprint!==request.candidateInputFingerprint
    ||!equal(r.baseline,requestRows(request))||!equal(r.target,request.target)||r.compositionFingerprint!==compositionFingerprint(input.manifest)
    ||r.backwardCompatible!==true||r.rollbackWriters!=='off'||!equal(r.scenarios,migrationScenarios)||!equal(r.checks?.map(row=>row.id),migrationScenarios)
    ||r.checks.some(row=>row.status!=='passed')||r.cleanup?.status!=='trials-cleared'||r.cleanup.remaining!==0
    ||a?.schemaVersion!==1||a.mode!=='additive-298-300'||a.reportHash!==evidenceHash(r)||a.compositionFingerprint!==r.compositionFingerprint
    ||!equal(a.baseline,r.baseline)||!equal(a.target,r.target))throw Error('Missing exact-executable additive rehearsal evidence');
  if(request.schemaVersion===2&&(r.baselineObservationHash!==request.baselineObservationHash||a.baselineObservationHash!==request.baselineObservationHash))throw Error('Legacy rehearsal observation differs');
  const c=Object.fromEntries(r.checks.map(row=>[row.id,row]));
  if(!hash(c['atomic-ddl-ledger'].historyHash)||!hash(c['atomic-ddl-ledger'].schemaProofHash)||!equal(c['atomic-ddl-ledger'].versions,request.target.map(row=>row.id).sort())
    ||c['crash-before-ledger'].transactionRolledBack!==true||c['crash-before-ledger'].restartPassed!==true
    ||c['repeat-after-commit'].reapplied!==0||c['repeat-after-commit'].schemaProofHash!==c['atomic-ddl-ledger'].schemaProofHash
    ||c['same-connection-lock'].startupLockShared!==true||c['same-connection-lock'].ddlAndLedgerSessionVerified!==true
    ||c['unknown-migration-rejected'].rejected!==true||c['schema-proof'].tamperedTriggerRejected!==true||c['schema-proof'].noSilentRepair!==true
    ||!hash(c['crash-before-ledger'].committedBaselineHash)||!hash(c['unknown-migration-rejected'].committedStateHash)
    ||c['repeat-after-commit'].historyHash!==c['atomic-ddl-ledger'].historyHash
    ||c['old-readers-after-expansion'].checked!==true||c['old-readers-after-expansion'].writerFlagsOff!==true
    ||!hash(c['old-readers-after-expansion'].pendingHash)||!hash(c['old-readers-after-expansion'].acceptedHash)||!hash(c['old-readers-after-expansion'].invariantHash))throw Error('Incomplete additive scenario proof');
  return result;
}

// Uses only the parent adapter's labelled disposable PostgreSQL/container
// namespace. Every mutation is confined to that clone or a generated trial DB.
export function createMigrationDockerAdapter({command,resource,envFile,names,run,label,secrets,startPrevious,stopApplications,oldReadProof}){
  const trials=new Set(),handles=new Set();let input,baselineTables;
  const identifier=name=>{if(!/^[a-z][a-z0-9_]{0,62}$/.test(name))throw Error('Unsafe owned database identifier');return `"${name}"`;};
  const resolve=db=>db==='main'?'rehearsal':trials.has(db)?db:db==='postgres'?'postgres':(()=>{throw Error('Database is not an owned migration trial');})();
  async function ownedPostgres(){
    const pg=JSON.parse(await command(['container','inspect',names.postgres]))[0];
    if(pg?.Config?.Labels?.['bagofholding.rehearsal']!==run||pg.State?.Running!==true||!pg.NetworkSettings?.Networks?.[names.network])throw Error('Migration trial PostgreSQL ownership changed');
  }
  const queryOn=async(db,sql)=>{await ownedPostgres();return command(['exec','-i',names.postgres,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','rehearsal','-d',resolve(db)],{input:sql,timeout:180000});};
  const json=async(db,sql)=>JSON.parse(await queryOn(db,sql));
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function until(probe,handle){
    const deadline=Date.now()+125000;
    while(Date.now()<deadline){const value=await probe();if(value)return value;if(handle?.outcome)throw Error('Candidate exited before the required lock boundary');await pause(150);}
    throw Error('Migration fault boundary deadline exceeded');
  }
  async function ownedContainer(name){const c=JSON.parse(await command(['container','inspect',name]))[0];if(c?.Config?.Labels?.['bagofholding.rehearsal']!==run)throw Error('Migration executable container ownership changed');return c;}
  async function removeHandle(handle){if(handle.removed)return;await ownedContainer(handle.name);await command(['container','rm','--force',handle.name]);handle.removed=true;handles.delete(handle);}
  async function start(db,request,inspectOnly){
    await ownedPostgres();const database=resolve(db),suffix=randomBytes(8).toString('hex'),name=`${run}_migration_${suffix}`,application=`migration_${suffix}`;
    const databaseURL=new URL('postgres://postgres:5432/');databaseURL.username='rehearsal';databaseURL.password=secrets.database;databaseURL.pathname=database;databaseURL.searchParams.set('sslmode','disable');databaseURL.searchParams.set('application_name',application);
    const file=await envFile(`migration-${suffix}`,{DATABASE_URL:databaseURL.toString(),
      RELEASE_ID:request.releaseId,RELEASE_COMMIT:input.manifest.releaseCommit});
    await resource('container',name,['create','-i','--name',name,'--label',label,'--network',names.network,'--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true',
      '--env-file',file,input.manifest.components.backend.imageDigest,inspectOnly?'--inspect-release-migrations':'--migrate-release']);
    const handle={db,name,application,request};handles.add(handle);
    handle.completion=command(['start','--attach','--interactive',name],{input:JSON.stringify(request),timeout:310000})
      .then(output=>({ok:true,receipt:JSON.parse(output)}),()=>({ok:false})).catch(()=>({ok:false})).then(outcome=>{handle.outcome=outcome;return outcome;});
    return handle;
  }
  async function finish(handle){
    const outcome=await handle.completion;
    try{if(!outcome.ok)throw Error('Exact candidate migration command failed');return outcome.receipt;}
    finally{await removeHandle(handle);}
  }
  async function release(handle){
    if(!handle.holder||handle.released)return;
    // The exact generated session is inside this labelled clone and trial DB.
    await queryOn(handle.db,`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${resolve(handle.db)}' AND usename='rehearsal' AND application_name='${handle.holder.application}';`);
    await handle.holder.completion;handle.released=true;
  }
  async function schema(db){
    return json(db,`SELECT json_build_object(
      'columns',(SELECT json_agg(json_build_array(c.relname,a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(d.adbin,d.adrelid)) ORDER BY c.relname,a.attnum) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE n.nspname='public' AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped),
      'constraints',(SELECT json_agg(json_build_array(r.relname,c.conname,c.convalidated,pg_get_constraintdef(c.oid)) ORDER BY r.relname,c.conname) FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public'),
      'indexes',(SELECT json_agg(json_build_array(tablename,indexname,indexdef) ORDER BY tablename,indexname) FROM pg_indexes WHERE schemaname='public'),
      'triggers',(SELECT json_agg(json_build_array(c.relname,t.tgname,t.tgenabled,t.tgtype,pg_get_expr(t.tgqual,t.tgrelid),p.prosrc,p.proconfig) ORDER BY c.relname,t.tgname) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid WHERE n.nspname='public' AND NOT t.tgisinternal));`);
  }
  return {
    execution:'docker',
    async preflight(value){
      input=value;await ownedPostgres();
      const network=JSON.parse(await command(['network','inspect',names.network]))[0];
      if(network.Internal!==true||network.Labels?.['bagofholding.rehearsal']!==run)throw Error('Migration rehearsal network must be owned and deny egress');
      await command(['pull',input.manifest.components.backend.imageDigest]);
      baselineTables=await json('main',"SELECT coalesce(json_agg(tablename ORDER BY tablename),'[]'::json) FROM pg_tables WHERE schemaname='public' AND tablename<>'schema_migrations';");
      const probe=`${run}_metadata_${randomBytes(8).toString('hex')}`;
      return JSON.parse(await resource('container',probe,['run','--name',probe,'--label',label,'--network','none','--read-only',input.manifest.components.backend.imageDigest,'--migration-info']));
    },
    async createTrial(){
      const db=`migration_${randomBytes(12).toString('hex')}`;trials.add(db);
      try{await queryOn('postgres',`CREATE DATABASE ${identifier(db)} TEMPLATE rehearsal;`);}catch(error){trials.delete(db);throw error;}
      return db;
    },
    async snapshot(db){
      if(!baselineTables)throw Error('Migration preflight required');
      baselineTables.forEach(identifier);
      // Fresh columns at every snapshot preserve the old protocol even if an
      // unexpected extra column appears. Only the existing declared additions
      // are omitted; the table list and every independent full scan stay intact.
      const tables=baselineTables.length?await json(db,`SELECT json_agg(json_build_object('name',c.relname,'columns',(SELECT coalesce(json_agg(a.attname ORDER BY a.attnum),'[]'::json) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)) ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN (${baselineTables.map(table=>`'${table}'`).join(',')}) AND c.relkind IN ('r','p');`):[];
      if(!Array.isArray(tables)||!equal(tables.map(table=>table.name),[...baselineTables].sort()))throw Error('Complete baseline history table set required');
      const history=tables.length?await json(db,parallelHistoryReadSQL(tables,databaseMigrationSet(input.active).map(row=>row.id))):[];
      return {versions:await json(db,"SELECT coalesce(json_agg(version ORDER BY version),'[]'::json) FROM schema_migrations;"),schemaHash:evidenceHash(await schema(db)),historyHash:evidenceHash(history)};
    },
    async execute(db,request,{inspectOnly=false}={}){return finish(await start(db,request,inspectOnly));},
    async beginBlocked(db,request,kind,lock){
      if(!['ledger','advisory'].includes(kind)||!/^\d{1,19}$/.test(lock))throw Error('Unknown owned fault boundary');
      const application=`holder_${randomBytes(8).toString('hex')}`;
      const sql=`SET application_name='${application}'; BEGIN; ${kind==='ledger'?'LOCK TABLE schema_migrations IN SHARE MODE':`SELECT pg_advisory_lock(${lock}::bigint)`}; SELECT pg_sleep(180); ROLLBACK;`;
      const holder={application,completion:queryOn(db,sql).then(()=>true,()=>false)};
      let handle;
      try{
        await until(async()=>await json(db,`SELECT to_json(EXISTS(SELECT 1 FROM pg_stat_activity a JOIN pg_locks l ON l.pid=a.pid WHERE a.application_name='${application}' AND a.datname='${resolve(db)}' AND l.granted AND ${kind==='ledger'?"l.mode='ShareLock' AND l.relation='schema_migrations'::regclass":"l.locktype='advisory'"}));`));
        handle=await start(db,request,false);Object.assign(handle,{holder,kind,lock});return handle;
      }catch(error){await release({db,holder});throw error;}
    },
    async observeBlocked(handle){
      const key=BigInt(handle.lock),classid=key>>32n,objid=key&0xffffffffn;
      return until(async()=>{
        const state=await json(handle.db,`SELECT json_build_object('candidateConnections',(SELECT count(*) FROM pg_stat_activity WHERE datname='${resolve(handle.db)}' AND application_name='${handle.application}'),
          'waiting',EXISTS(SELECT 1 FROM pg_stat_activity a JOIN pg_locks l ON l.pid=a.pid WHERE a.datname='${resolve(handle.db)}' AND a.application_name='${handle.application}' AND NOT l.granted AND ${handle.kind==='ledger'?"l.relation='schema_migrations'::regclass AND a.query LIKE 'INSERT INTO schema_migrations%'":"l.locktype='advisory'"}),
          'advisorySameSession',EXISTS(SELECT 1 FROM pg_stat_activity a JOIN pg_locks l ON l.pid=a.pid WHERE a.datname='${resolve(handle.db)}' AND a.application_name='${handle.application}' AND l.locktype='advisory' AND l.granted AND l.classid=${classid} AND l.objid=${objid} AND l.objsubid=1),
          'ddlSameSession',EXISTS(SELECT 1 FROM pg_stat_activity a JOIN pg_locks l ON l.pid=a.pid WHERE a.datname='${resolve(handle.db)}' AND a.application_name='${handle.application}' AND l.granted AND l.locktype='relation' AND l.mode='AccessExclusiveLock'));`);
        return state.waiting?{...state,stage:handle.kind==='ledger'?'ledger-insert':'migration-lock'}:null;
      },handle);
    },
    async kill(handle){await ownedContainer(handle.name);await command(['kill','--signal','KILL',handle.name]);const outcome=await handle.completion;if(outcome.ok)throw Error('Killed candidate unexpectedly committed successfully');await removeHandle(handle);},
    release,finish,
    async mutate(db,mode){
      if(!trials.has(db))throw Error('Fault mutation is forbidden outside a generated trial database');
      const sql=mode==='unknown-ledger'?"INSERT INTO schema_migrations(version,description,executed_at) VALUES('999_unapproved_rehearsal','owned fault',NOW());"
        :mode==='trigger-when-false'?"DROP TRIGGER frozen_catalog_immutable ON frozen_combat_catalogs; CREATE TRIGGER frozen_catalog_immutable BEFORE UPDATE OR DELETE ON frozen_combat_catalogs FOR EACH ROW WHEN (false) EXECUTE FUNCTION reject_frozen_catalog_mutation();":null;
      if(!sql)throw Error('Unknown schema fault');await queryOn(db,sql);
    },
    async dropTrial(db){
      if(!trials.has(db))throw Error('Not an owned migration trial');
      for(const handle of [...handles].filter(handle=>handle.db===db)){await release(handle);await removeHandle(handle);}
      await queryOn('postgres',`DROP DATABASE ${identifier(db)} WITH (FORCE);`);trials.delete(db);
    },
    startPrevious,stopApplications,oldReadProof,
  };
}
