import {randomUUID} from 'node:crypto';
import {databaseRecoveryInventory} from './artifact-references.mjs';
import {databaseSchemaLedgerProof} from './database-schema-proof.mjs';
export async function withLegacyReadSnapshot({command,cleanupCommand=command,config,dsn,name,label},visit){
  if(!/^legacy_inspect_[a-z0-9_]+$/.test(name)||label!==`bagofholding.legacy-inspection=${name}`)throw Error('Generated read-snapshot ownership required');
  const {idleSeconds=120,totalSeconds=1800,renewSeconds=30}=config.snapshotLease??{};
  if(![idleSeconds,totalSeconds,renewSeconds].every(Number.isInteger)||idleSeconds<2||idleSeconds>120||totalSeconds<idleSeconds||totalSeconds>1800||renewSeconds<1||renewSeconds>=idleSeconds)throw Error('Bounded snapshot progress lease required');
  const keeper=`${name}_snapshot`;
  const cleanup=async()=>{
    const listed=await cleanupCommand(['container','ls','-a','--filter',`label=${label}`,'--format','{{.Names}}']);
    if(listed.split(/\r?\n/).includes(keeper)){
      const value=JSON.parse(await cleanupCommand(['container','inspect',keeper]))[0];if(value.Config.Labels?.['bagofholding.legacy-inspection']!==name)throw Error('Snapshot helper ownership changed');
      await cleanupCommand(['container','rm','--force',keeper]);
    }
  };
  try{
    // One read-only exporter keeps a consistent view across small scanner
    // statements. Progress renews a short lease; a dead/hung caller releases the
    // transaction within 120s, and even an active scan has a 30-minute ceiling.
    // The DSN is inherited privately; only fixed SQL and generated names are argv.
    await command(['run','--name',keeper,'--label',label,'-d','--read-only','--tmpfs','/tmp:rw,nosuid,nodev,size=1m','--network',config.databaseNetwork,'-e','DATABASE_URL','-e','PGCONNECT_TIMEOUT=10','--entrypoint','sh',config.postgresImage,'-ec',
      `{ touch /tmp/lease; started=$(date +%s); printf '%s\\n' 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;' 'SELECT pg_export_snapshot();'; while :; do now=$(date +%s); renewed=$(stat -c %Y /tmp/lease); if [ "$((now-renewed))" -ge ${idleSeconds} ] || [ "$((now-started))" -ge ${totalSeconds} ]; then break; fi; printf '%s\\n' 'SELECT pg_sleep(1);'; sleep 1; done; printf '%s\\n' 'ROLLBACK;'; } | psql "$DATABASE_URL" -X -qAt -v ON_ERROR_STOP=1 -o /tmp/snapshot`],{env:{DATABASE_URL:dsn}});
    let snapshot;
    for(let attempt=0;attempt<100;attempt++){
      const keeperState=JSON.parse(await command(['container','inspect',keeper]))[0];if(keeperState.State?.Running!==true)throw Error('Read snapshot exporter exited');
      try{const value=(await command(['exec',keeper,'cat','/tmp/snapshot'])).trim();if(/^[a-fA-F0-9]{8}-[a-fA-F0-9]{8}-[0-9]+$/.test(value)){snapshot=value;break;}}catch{}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    if(!snapshot)throw Error('Read snapshot export unavailable');
    let lastProgress=Date.now();
    const progress=async()=>{
      if(Date.now()-lastProgress<renewSeconds*1000)return;
      const value=JSON.parse(await command(['container','inspect',keeper]))[0];
      if(value.State?.Running!==true||value.Config.Labels?.['bagofholding.legacy-inspection']!==name)throw Error('Read snapshot progress lease expired or ownership changed');
      await command(['exec',keeper,'touch','/tmp/lease']);lastProgress=Date.now();
    };
    return await visit(snapshot,progress);
  }finally{await cleanup();}
}
async function readDockerDatabase({command,cleanupCommand=command,postgresImage,databaseNetwork,dsn},visit){
  const name=`legacy_inspect_${randomUUID().replaceAll('-','')}`,label=`bagofholding.legacy-inspection=${name}`,client=`${name}_query`,config={postgresImage,databaseNetwork};
  return withLegacyReadSnapshot({command,cleanupCommand,config,dsn,name,label},async (snapshot,progress)=>{
    const query=async sql=>{
      await progress();
      try{const output=await command(['run','--name',client,'--label',label,'--rm','-i','--read-only','--network',databaseNetwork,'-e','DATABASE_URL','-e','PGCONNECT_TIMEOUT=10','--entrypoint','sh',postgresImage,'-ec','exec psql "$DATABASE_URL" -X -qAt -v ON_ERROR_STOP=1'],{input:`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;SET TRANSACTION SNAPSHOT '${snapshot}';SET LOCAL statement_timeout='60s';SET LOCAL lock_timeout='2s';\n${sql}\nCOMMIT;`,env:{DATABASE_URL:dsn}});await progress();return output;}
      finally{
        const listed=await cleanupCommand(['container','ls','-a','--filter',`label=${label}`,'--format','{{.Names}}']);
        if(listed.split(/\r?\n/).includes(client)){
          const value=JSON.parse(await cleanupCommand(['container','inspect',client]))[0];if(value.Config.Labels?.['bagofholding.legacy-inspection']!==name)throw Error('Inventory query helper ownership changed');
          await cleanupCommand(['container','rm','--force',client]);
        }
      }
    };
    return visit({query});
  });
}

export const readDockerInventory=options=>readDockerDatabase(options,database=>databaseRecoveryInventory(database,options.options));
export const readDockerSchemaLedgerProof=options=>readDockerDatabase(options,databaseSchemaLedgerProof);
