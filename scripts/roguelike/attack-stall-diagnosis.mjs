// Read-only local diagnostics. Private snapshot stays in ignored outputs/.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const runId='3ebf1c9c-1022-4aee-80c2-7e88c256a939';
const config=JSON.parse(await readFile('C:/Users/alexe/AppData/Local/dnd-cards-dev/local-env.json','utf8'));
const db=new URL(config.DATABASE_URL);if(!['127.0.0.1','localhost'].includes(db.hostname))throw Error('Local only');db.pathname='/shop_review_249_20260915';
const result=spawnSync('C:/Users/alexe/AppData/Local/dnd-cards-dev/tools/postgresql-17.11/pgsql/bin/psql.exe',[db.href,'-X','-A','-t','-v','ON_ERROR_STOP=1'],{encoding:'utf8',maxBuffer:100*1024*1024,input:`BEGIN READ ONLY; SELECT jsonb_build_object('id',id,'revision',revision,'status',status,'phase',phase,'envelope',combat_envelope,'events',(SELECT jsonb_agg(jsonb_build_object('revision',revision,'record',record) ORDER BY revision) FROM roguelike_combat_events WHERE run_id='${runId}')) FROM roguelike_runs WHERE id='${runId}'; ROLLBACK;`});
if(result.status!==0)throw Error(result.stderr);
const snapshot=JSON.parse(result.stdout.split('\n').find(line=>line.startsWith('{')));
await mkdir('outputs/attack-stall',{recursive:true});await writeFile('outputs/attack-stall/snapshot.json',JSON.stringify(snapshot));
const state=snapshot.envelope?.state;
console.log(JSON.stringify({revision:snapshot.revision,status:snapshot.status,phase:snapshot.phase,artifact:snapshot.envelope?.artifactHash,events:snapshot.events?.length,
 map:state?.battleMap&&{id:state.battleMap.id,width:state.battleMap.width,height:state.battleMap.height,features:state.battleMap.features.length},
 actors:state&&Object.values(state.world.actors).map(a=>({id:a.id,name:a.name,hp:a.runtime.hp.current,position:state.tokens[a.id]?.position})),scene:state?.world.scene,
 pending:state?.world.pendingResolution?.type,interrupt:state?.pendingD20Interrupt?.operation,
 lastEvents:snapshot.events?.slice(-5).map(e=>({revision:e.revision,keys:Object.keys(e.record),intent:e.record.intent}))},null,2));
for(const path of ['http://localhost:3001/','http://localhost:8080/api/health','http://localhost:8090/health']){const start=performance.now();try{const response=await fetch(path,{signal:AbortSignal.timeout(5000)});console.log(path,response.status,Math.round(performance.now()-start)+'ms');}catch(e){console.log(path,e.message);}}
