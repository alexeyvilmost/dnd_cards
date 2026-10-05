import {randomBytes} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {dockerCommand} from '../release/rehearsal-command.mjs';
import {readDockerInventory,withLegacyReadSnapshot} from '../release/read-snapshot.mjs';
import {withDockerReadSession} from '../release/docker-read-session.mjs';
import {cursorInventory} from '../release/reference-cursor.mjs';
import {checksum} from '../release/backup-manifest.mjs';
import {evidenceHash} from '../release/validate-manifest.mjs';
import {historyQuery} from '../release/history-fingerprint.mjs';

// Public synthetic rows only. No supplied DSN/dump, host mount, provider or
// production configuration can redirect this mandatory transport acceptance.
export async function checkReferenceCursorTransport(directory){
 directory=path.resolve(directory);await fs.mkdir(directory,{recursive:true,mode:0o700});
 const owner=`cursor_contract_${randomBytes(12).toString('hex')}`,label=`bagofholding.cursor-contract=${owner}`,network=owner+'_net',pg=owner+'_pg';
 const image='postgres@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73';
 const password=randomBytes(24).toString('hex'),readerPassword=randomBytes(24).toString('hex'),url=new URL('postgresql://placeholder/cursor_contract');url.hostname=pg;url.username='inventory_reader';url.password=readerPassword;const dsn=url.href;
 const config={postgresImage:image,databaseNetwork:network},resources=[],helpers=new Map();
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
 const sourcePaths=['scripts/release/docker-read-session.mjs','scripts/release/reference-cursor.mjs','scripts/release/read-snapshot.mjs','scripts/release/history-fingerprint.mjs','scripts/testing/reference-cursor-contract.mjs'];
 const sourceFiles=()=>Promise.all(sourcePaths.map(async p=>({path:p,sha256:await checksum(path.join(root,p))})));
 const report={schemaVersion:1,kind:'actual-owned-reference-cursor-transport',status:'running',image,checks:[],cleanup:[],sourceFiles:await sourceFiles(),productionData:false};
 const command=async(args,options)=>{
  if(args[0]==='run'&&args.includes('--label')){const tag=args[args.indexOf('--label')+1];if(tag.startsWith('bagofholding.legacy-inspection='))helpers.set(args[args.indexOf('--name')+1],tag);}
  return dockerCommand(args,options);
 };
 const sql=text=>command(['exec','-i',pg,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate','-U','cursor_contract','-d','cursor_contract'],{input:`SET log_min_error_statement='PANIC';${text}`});
 const artifact=c=>'sha256:'+c.repeat(64),domain=({scan,...rest})=>rest;
 const check=(value,id)=>{if(!value)throw Error('Synthetic transport assertion failed');report.checks.push({id,status:'passed'});};
 const ownedRemove=async(kind,name)=>{
  const value=JSON.parse(await command([kind,'inspect',name]))[0];
  if((kind==='container'?value.Config.Labels:value.Labels)?.['bagofholding.cursor-contract']!==owner)throw Error('Synthetic resource ownership changed');
  await command([kind,'rm',...(kind==='container'?['--force']:[]),name]);
 };
 const verifyHelpers=async()=>{
  for(const [keeper,tag]of helpers){const rows=(await command(['container','ls','-a','--filter',`label=${tag}`,'--format','{{.Names}}'])).split(/\r?\n/);if(rows.includes(keeper)||rows.includes(keeper.replace(/_snapshot$/,'_stream')))throw Error('Inventory helper remained');}
 };
 try{
  try{await command(['image','inspect',image]);}catch{await command(['pull',image],{timeout:180000});}
  resources.push(['network',network]);await command(['network','create','--internal','--label',label,network]);
  resources.push(['container',pg]);await command(['run','-d','--name',pg,'--label',label,'--network',network,'--memory','256m','--cpus','1','--pids-limit','128','--tmpfs','/var/lib/postgresql/data:rw,nosuid,nodev,size=256m','-e','POSTGRES_USER=cursor_contract','-e','POSTGRES_DB=cursor_contract','-e','POSTGRES_PASSWORD',image,'-c','log_statement=none','-c','log_min_error_statement=panic'],{env:{POSTGRES_PASSWORD:password}});
  for(let attempt=0;;attempt++){try{await command(['exec',pg,'pg_isready','-h','127.0.0.1','-U','cursor_contract','-d','cursor_contract']);break;}catch{if(attempt===100)throw Error('Synthetic PostgreSQL startup deadline');await new Promise(resolve=>setTimeout(resolve,100));}}
  const net=JSON.parse(await command(['network','inspect',network]))[0],state=JSON.parse(await command(['container','inspect',pg]))[0];
  check(net.Internal===true&&Object.keys(state.NetworkSettings.Networks).join(',')===network&&!Object.values(state.NetworkSettings.Ports??{}).some(Boolean),'owned-internal-only-no-published-ports');
  await sql('CREATE TABLE zero_history(); INSERT INTO zero_history DEFAULT VALUES; INSERT INTO zero_history DEFAULT VALUES; CREATE TABLE roguelike_command_receipts(response_version int,response_payload bytea,response_sha256 text,response_length int); INSERT INTO roguelike_command_receipts VALUES(1,NULL,NULL,NULL);');
  const historyTables=[{name:'zero_history',columns:[]},{name:'roguelike_command_receipts',columns:['response_version','response_payload','response_sha256','response_length']}];
  const baselineHistory=JSON.parse(await sql(historyQuery(historyTables,[]))),projectedHistory=JSON.parse(await sql(historyQuery(historyTables,[],{project:true})));
  check(evidenceHash(baselineHistory)===evidenceHash(projectedHistory),'zero-column-and-all-excluded-records-preserve-empty-object-multiset');
  await sql("ALTER TABLE zero_history ADD COLUMN unexpected text; UPDATE zero_history SET unexpected='new-data';");historyTables[0].columns=['unexpected'];
  const changed=JSON.parse(await sql(historyQuery(historyTables,[],{project:true})));
  check(evidenceHash(changed)!==evidenceHash(baselineHistory)&&evidenceHash(changed)===evidenceHash(JSON.parse(await sql(historyQuery(historyTables,[])))),'fresh-columns-retain-unexpected-added-data');
  await sql('DROP TABLE zero_history; DROP TABLE roguelike_command_receipts;');
  await sql(`CREATE TABLE schema_migrations(version text); INSERT INTO schema_migrations VALUES('297_public_fixture'); CREATE TABLE unknown_json(payload jsonb,other json); INSERT INTO unknown_json VALUES(jsonb_build_object('nested',jsonb_build_array(jsonb_build_object('artifactHash','${artifact('a')}','image_url','https://example.invalid/Ж😀'))),'null');
   CREATE ROLE inventory_reader LOGIN PASSWORD '${readerPassword}'; GRANT CONNECT ON DATABASE cursor_contract TO inventory_reader; GRANT USAGE ON SCHEMA public TO inventory_reader; GRANT SELECT ON ALL TABLES IN SCHEMA public TO inventory_reader;`);
  const initial=await readDockerInventory({command,...config,dsn});check(initial.artifactHashes.join(',')===artifact('a')&&initial.mediaReferences.length===1,'actual-export-import-complete-inventory');
  const name=`legacy_inspect_${owner}_repeat`,tag=`bagofholding.legacy-inspection=${name}`;
  await withLegacyReadSnapshot({command,config,dsn,name,label:tag},(snapshot,progress)=>withDockerReadSession({command,config,dsn,name,label:tag,snapshot,progress},async db=>{
   check((await db.query("SELECT rolsuper::text FROM pg_roles WHERE rolname=current_user;"))==='false','actual-reader-is-not-superuser');
   let attachedOutput;await db.rows("SELECT repeat('Ж😀',65536);",line=>{if(attachedOutput!==undefined)throw Error('Synthetic attached stream duplicated output');attachedOutput=line;});
   const streamState=JSON.parse(await command(['container','inspect',name+'_stream']))[0];
   check(attachedOutput==='Ж😀'.repeat(65536)&&streamState.HostConfig.LogConfig.Type==='none'&&streamState.LogPath===''&&streamState.Config.Labels?.['bagofholding.legacy-inspection']===name,'attached-utf8-stream-preserves-complete-output-without-persisted-container-log');
   const before=await cursorInventory(db);await sql(`UPDATE unknown_json SET payload=jsonb_build_object('artifactHash','${artifact('b')}');`);const after=await cursorInventory(db);
   check(evidenceHash(domain(before))===evidenceHash(domain(after)),'concurrent-committed-write-invisible-in-one-exported-snapshot');
  }));
  const fresh=await readDockerInventory({command,...config,dsn});check(fresh.artifactHashes.join(',')===artifact('b'),'new-inventory-sees-fresh-committed-reference');
  for(const mode of ['truncate','materialized-refresh']){
   if(mode==='materialized-refresh')await sql("CREATE MATERIALIZED VIEW materialized_refs AS SELECT payload FROM unknown_json; GRANT SELECT ON materialized_refs TO inventory_reader;");
   const name=`legacy_inspect_${owner}_${mode.replaceAll('-','_')}`,tag=`bagofholding.legacy-inspection=${name}`;let rejected=false,entered=false;
   try{await withLegacyReadSnapshot({command,config,dsn,name,label:tag},async(snapshot,progress)=>{
    // Rewrite after export, before reader discovery/lock. PostgreSQL's pinned
    // catalog still names the old filenode but current relcache names the new.
    await sql(mode==='truncate'?`TRUNCATE unknown_json; INSERT INTO unknown_json VALUES(jsonb_build_object('artifactHash','${artifact('b')}'),'null');`:'REFRESH MATERIALIZED VIEW materialized_refs;');entered=true;
    return withDockerReadSession({command,config,dsn,name,label:tag,snapshot,progress},db=>cursorInventory(db));
   });}catch(error){rejected=/physical relation changed/.test(error.message);}
   check(rejected&&entered,`${mode}-after-export-before-lock-refuses-completeness`);
   if(mode==='materialized-refresh')await sql('DROP MATERIALIZED VIEW materialized_refs;');
  }
  for(const mode of ['exporter-loss','cancelled-last-read','metadata-bound','inflight-process-loss']){
   const name=`legacy_inspect_${owner}_${mode.replaceAll('-','_')}`,tag=`bagofholding.legacy-inspection=${name}`;let cancelled=false,read=false,rejected=false,kill,survivedExporterLoss=false,readyForTerminal=false,failure;
   const workload=(...args)=>{if(cancelled)throw Error('Synthetic workload cancelled');return command(...args);};
   try{await withLegacyReadSnapshot({command:workload,cleanupCommand:command,config,dsn,name,label:tag},(snapshot,progress)=>withDockerReadSession({command:workload,cleanupCommand:command,config,dsn,name,label:tag,snapshot,progress,limits:mode==='metadata-bound'?{maxMetadataBytes:1024}:undefined},async db=>{
    check((await db.query('SELECT 1;'))==='1',`${mode}-import-read`);read=true;
    if(mode==='exporter-loss'){
     const keeper=name+'_snapshot',state=JSON.parse(await command(['container','inspect',keeper]))[0];if(state.Config.Labels?.['bagofholding.legacy-inspection']!==name)throw Error('Keeper owner changed');await command(['container','rm','--force',keeper]);
     // The imported transaction remains usable; only final forced authority
     // validation can refuse this otherwise successful result.
     if((await db.query('SELECT 2;'))!=='2')throw Error('Imported reader unexpectedly unavailable');survivedExporterLoss=true;
    }else if(mode==='cancelled-last-read')cancelled=true;
    else if(mode==='metadata-bound')await db.query("SELECT repeat('x',2048);");
    else{
     const pending=db.rows("SELECT 'partial'; SELECT pg_sleep(30);",()=>{});pending.catch(()=>{});
     for(let attempt=0;;attempt++){
      const waiting=await sql("SELECT to_json(EXISTS(SELECT 1 FROM pg_stat_activity WHERE usename='inventory_reader' AND datname='cursor_contract' AND wait_event='PgSleep' AND query LIKE '%pg_sleep(30)%')); ");
      if(waiting==='true')break;if(attempt===30)throw Error('Owned in-flight reader was not observed');await new Promise(resolve=>setTimeout(resolve,50));
     }
     kill=(async()=>{const client=name+'_stream',state=JSON.parse(await command(['container','inspect',client]))[0];if(state.Config.Labels?.['bagofholding.legacy-inspection']!==name)throw Error('Reader owner changed');await command(['container','kill',client]);})();await kill;await pending;
    }
    readyForTerminal=true;return {complete:true};
   }));}catch(error){rejected=true;failure=error;}finally{if(kill)await kill;}
   check(rejected&&read&&(mode!=='exporter-loss'||survivedExporterLoss&&readyForTerminal)
    &&(mode!=='metadata-bound'||failure?.code==='CURSOR_METADATA_LIMIT')
    &&(mode!=='cancelled-last-read'||readyForTerminal&&failure?.message==='Synthetic workload cancelled')
    &&(mode!=='inflight-process-loss'||failure?.code==='CURSOR_SUBPROCESS_FAILED'),`${mode}-refuses-complete-result`);await verifyHelpers();
  }
  await verifyHelpers();check(evidenceHash(await sourceFiles())===evidenceHash(report.sourceFiles),'executed-production-source-unchanged');report.status='passed';
 }catch{report.status='failed';report.failureKind='owned-cursor-transport-contract-failed';}
 finally{
  for(const [kind,name]of resources.reverse())try{await ownedRemove(kind,name);report.cleanup.push({kind,status:'stopped'});}catch{report.cleanup.push({kind,status:'failed'});report.status='failed';}
  try{await verifyHelpers();report.cleanup.push({kind:'exporter-and-stream-clients',status:'stopped'});}catch{report.cleanup.push({kind:'exporter-and-stream-clients',status:'failed'});report.status='failed';}
  await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
 }
 if(report.status!=='passed')throw Error('Owned reference cursor transport acceptance failed');return report;
}
