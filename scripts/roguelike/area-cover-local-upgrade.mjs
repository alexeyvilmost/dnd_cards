// Explicit, audited upgrade of the reported LOCAL encounter. No replay/history
// rewriting, new RNG, action execution, HP changes or production connection.
// Dry run by default. Run with --apply only after tests and worker restart.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {snapshotHash} from '../../frontend/worker/server.mjs';
const runId='3ebf1c9c-1022-4aee-80c2-7e88c256a939';
const deathSaves=process.argv.includes('--death-saves');
const previousHash=deathSaves?'sha256:81a3aca4d3a2aeaf9ab17dfa9a90c6d4b3ce0ccee45a9e6af3acc3155df9c2dc':'sha256:20d750e28e6a3ec224a780b1fef2a01064b0bea8d9ebe0ae4c90c24e4332f933';
const config=JSON.parse(await readFile('C:/Users/alexe/AppData/Local/dnd-cards-dev/local-env.json','utf8'));
const db=new URL(config.DATABASE_URL);
assert.ok(['127.0.0.1','localhost'].includes(db.hostname),'Local database required');
db.pathname='/shop_review_249_20260915';
function query(sql){
 const result=spawnSync('C:/Users/alexe/AppData/Local/dnd-cards-dev/tools/postgresql-17.11/pgsql/bin/psql.exe',
  [db.href,'-X','-A','-t','-v','ON_ERROR_STOP=1'],{encoding:'utf8',maxBuffer:100*1024*1024,input:sql});
 if(result.status!==0)throw Error('Local database operation rejected; transaction rolled back');
 return result.stdout;
}
const snapshot=JSON.parse(query(`BEGIN READ ONLY; SELECT jsonb_build_object('revision',revision,'envelope',combat_envelope,
 'catalog',combat_catalog,'attempt',attempt,'encounter',encounter,
 'eventCount',(SELECT count(*) FROM roguelike_combat_events WHERE run_id='${runId}'))
 FROM roguelike_runs WHERE id='${runId}'; ROLLBACK;`).split('\n').find(l=>l.startsWith('{')));
const artifact=await readFile('frontend/worker/dist/artifact.cjs');
const hash='sha256:'+createHash('sha256').update(artifact).digest('hex');
if(snapshot.envelope.artifactHash===hash){console.log('Already upgraded; no changes');process.exit(0);}
assert.equal(snapshot.envelope.artifactHash,previousHash,'Unexpected previous rules version');
const state=snapshot.envelope.state;
assert.equal(state.outcome,'active');assert.equal(state.world.pendingResolution,null);
assert.equal(state.world.scene.mode,'encounter');
assert.ok((state.controlledCharacterIds??[state.characterId]).includes(state.world.scene.initiative[state.world.scene.activeIndex]));
assert.ok(!state.playerMovement && !Object.entries(state).some(([key,value])=>key.startsWith('pending')&&(Array.isArray(value)?value.length>0:Boolean(value))),'Resolve all pending decisions before upgrade');
const next=structuredClone(snapshot.envelope);next.artifactHash=hash;
assert.deepEqual(next.state,snapshot.envelope.state);assert.deepEqual(next.entropy,snapshot.envelope.entropy);
if(deathSaves){
 next.state.deathSavesVersion=1;
 const actor=next.state.world.actors[next.state.world.scene.initiative[next.state.world.scene.activeIndex]];
 if(actor.runtime.hp.current===0){
  // This repair is only for an untouched start-of-turn from the old worker.
  assert.ok(next.state.log.at(-1)?.text.includes('Начало хода'),'Only upgrade a pending zero-HP start of turn');
  actor.runtime.firedThisTurn=[...new Set([...(actor.runtime.firedThisTurn??[]),'system:death-save-due'])];
 }
}
const beforeHash=snapshotHash(snapshot.envelope),afterHash=snapshotHash(next);
console.log(JSON.stringify({mode:process.argv.includes('--apply')?'apply':'dry-run',runId,revision:snapshot.revision,previousHash,hash,unchangedGameplay:true,deathSaves}));
if(!process.argv.includes('--apply'))process.exit(0);
const health=await (await fetch('http://127.0.0.1:8090/health')).json();assert.equal(health.artifactHash,hash,'Restart the local worker first');
const archive=await readFile(`outputs/rules-artifacts-251/${hash.slice(7)}.cjs`);assert.deepEqual(archive,artifact);
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
await mkdir('outputs/area-cover',{recursive:true});
await writeFile(`outputs/area-cover/before-upgrade-${stamp}.json`,JSON.stringify(snapshot),{flag:'wx'});
const commandId=randomUUID(),revision=snapshot.revision+1;
const record={schemaVersion:1,type:'local_rules_upgrade',reason:deathSaves?'Enable persisted death saves; mark untouched zero-HP start of turn as due':'Area-origin propagation and center-to-center cover; explicit local repair',
 previousArtifactHash:previousHash,artifactHash:hash,beforeHash,afterHash,randomValues:[],baseline:next,baselinePosition:'after'};
const key=createHash('sha256').update(hash+':'+next.entropy.seed).digest('hex');
const literal=value=>"'"+JSON.stringify(value).replaceAll("'","''")+"'::jsonb";
query(`BEGIN;
 DO $upgrade$ BEGIN
  PERFORM 1 FROM roguelike_runs WHERE id='${runId}' AND revision=${snapshot.revision}
   AND combat_envelope=${literal(snapshot.envelope)} FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Encounter changed; abort upgrade'; END IF;
 END $upgrade$;
 UPDATE roguelike_runs SET combat_envelope=${literal(next)},
  combat_catalog=jsonb_set(combat_catalog,'{artifactHash}',to_jsonb('${hash}'::text)),
  revision=${revision},updated_at=NOW() WHERE id='${runId}';
 INSERT INTO roguelike_combat_events(id,run_id,command_id,revision,combat_key,attempt,encounter_number,record,created_at)
 VALUES(gen_random_uuid(),'${runId}','${commandId}',${revision},'${key}',${snapshot.attempt},${Number(snapshot.encounter.number)},${literal(record)},NOW());
 COMMIT;`);
const verified=JSON.parse(query(`BEGIN READ ONLY; SELECT jsonb_build_object('revision',revision,'envelope',combat_envelope,
 'eventCount',(SELECT count(*) FROM roguelike_combat_events WHERE run_id='${runId}')) FROM roguelike_runs WHERE id='${runId}'; ROLLBACK;`).split('\n').find(l=>l.startsWith('{')));
assert.equal(verified.revision,revision);assert.deepEqual(verified.envelope,next);assert.equal(verified.eventCount,snapshot.eventCount+1);
console.log(JSON.stringify({status:'verified',revision,history:'preserved; one upgrade baseline appended',state:deathSaves?'death-save capability and due marker only':'unchanged',entropy:'unchanged'}));
