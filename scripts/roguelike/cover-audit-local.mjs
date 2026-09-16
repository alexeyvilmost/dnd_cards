import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const config=JSON.parse(await readFile('C:/Users/alexe/AppData/Local/dnd-cards-dev/local-env.json','utf8'));
const db=new URL(config.DATABASE_URL);if(!['127.0.0.1','localhost'].includes(db.hostname))throw Error('Local only');db.pathname='/shop_review_249_20260915';
const runId='2f4e861d-5467-4541-80bf-1df63ac2e7f9';
const result=spawnSync('C:/Users/alexe/AppData/Local/dnd-cards-dev/tools/postgresql-17.11/pgsql/bin/psql.exe',[db.href,'-X','-A','-t','-v','ON_ERROR_STOP=1'],{encoding:'utf8',maxBuffer:50*1024*1024,input:`SELECT jsonb_build_object('id',id,'revision',revision,'status',status,'phase',phase,'envelope',combat_envelope,'events',(SELECT jsonb_agg(jsonb_build_object('revision',revision,'record',record) ORDER BY revision) FROM roguelike_combat_events WHERE run_id='${runId}')) FROM roguelike_runs WHERE id='${runId}';`});
if(result.status!==0)throw Error(result.stderr);const snapshot=JSON.parse(result.stdout);
await mkdir('outputs/cover-symmetry',{recursive:true});await writeFile('outputs/cover-symmetry/battle-before.json',JSON.stringify(snapshot));
console.log(JSON.stringify({revision:snapshot.revision,status:snapshot.status,phase:snapshot.phase,envelopeKeys:Object.keys(snapshot.envelope),events:snapshot.events?.length,firstEventKeys:Object.keys(snapshot.events?.[0]?.record??{})}));
