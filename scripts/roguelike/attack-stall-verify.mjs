// Verify the real resumed roll against its saved pinned-artifact continuation.
// Database access is read-only. No command is sent to the live encounter.
import {readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
const require=createRequire(import.meta.url);
const before=JSON.parse(await readFile('outputs/attack-stall/snapshot.json','utf8'));
assert.match(before.id,/^[0-9a-f-]{36}$/);
const config=JSON.parse(await readFile('C:/Users/alexe/AppData/Local/dnd-cards-dev/local-env.json','utf8'));
const db=new URL(config.DATABASE_URL);if(!['localhost','127.0.0.1'].includes(db.hostname))throw Error('Local only');db.pathname='/shop_review_249_20260915';
const query=spawnSync('C:/Users/alexe/AppData/Local/dnd-cards-dev/tools/postgresql-17.11/pgsql/bin/psql.exe',[db.href,'-X','-A','-t','-v','ON_ERROR_STOP=1'],{encoding:'utf8',maxBuffer:30*1024*1024,input:`BEGIN READ ONLY; SELECT jsonb_build_object('revision',revision,'envelope',combat_envelope) FROM roguelike_runs WHERE id='${before.id}'; ROLLBACK;`});
if(query.status!==0)throw Error(query.stderr);
const after=JSON.parse(query.stdout.split('\n').find(line=>line.startsWith('{')));
await writeFile('outputs/attack-stall/resumed.json',JSON.stringify(after));
assert.equal(after.revision,before.revision+1,'Expected exactly one continuation since diagnosis');
const artifact=require(`../../outputs/rules-artifacts-251/${before.envelope.artifactHash.slice(7)}.cjs`);
// HTTP/JSONB drops optional undefined fields; compare the wire representation.
const expected=JSON.parse(JSON.stringify(artifact.stepRoguelikeCombat(before.envelope,{type:'d20_interrupt',actorId:null},before.envelope.artifactHash).envelope.state));
assert.ok(isDeepStrictEqual(after.envelope.state.world,expected.world),'World differs from saved continuation');
assert.ok(isDeepStrictEqual(after.envelope.state.log,expected.log),'Log differs from saved continuation');
assert.equal(after.envelope.state.pendingD20Interrupt,undefined);
assert.equal(after.envelope.artifactHash,before.envelope.artifactHash);
const owner=before.envelope.state.pendingD20Interrupt.command.actorId;
assert.equal(after.envelope.state.world.actors[owner].runtime.resources.heroic_inspiration,before.envelope.state.world.actors[owner].runtime.resources.heroic_inspiration);
console.log(JSON.stringify({verified:true,revision:after.revision,exactlyOneContinuation:true,samePinnedArtifact:true,worldAndLogMatchSavedRoll:true,inspirationUnspent:true}));
