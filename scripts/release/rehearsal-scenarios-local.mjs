#!/usr/bin/env node
// Native API compatibility proof for the Docker collector's shared scenario.
// This receipt is deliberately not an OCI or deployment readiness report.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {startTestStack} from '../testing/stack.mjs';
import {createCanonicalPendingScenario,acceptedReceiptReplay,authorizeNativeRehearsal} from './rehearsal-scenarios.mjs';
import {evidenceHash} from './validate-manifest.mjs';

export async function checkCanonicalReceiptScenario(stack) {
  const pending=await createCanonicalPendingScenario(await authorizeNativeRehearsal(stack),{label:'Owned rehearsal compatibility'});
  assert.match(pending.id,/^[a-f0-9-]{36}$/);
  const sql=async text=>JSON.parse((await stack.database.query(text,undefined,{sensitive:true})).trim().split(/\r?\n/).at(-1));
  const invariant=()=>sql(`SELECT json_build_object('run',md5(to_jsonb(r)::text),'characters',(SELECT md5(coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id)::text,'')) FROM characters_v3 c WHERE c.user_id=r.user_id),'receipts',(SELECT md5(coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id)::text,'')) FROM roguelike_command_receipts c WHERE c.run_id=r.id),'events',(SELECT md5(coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.revision)::text,'')) FROM roguelike_combat_events e WHERE e.run_id=r.id)) FROM roguelike_runs r WHERE r.id='${pending.id}';`);
  const call=pending.request;
  const before=await invariant(),loaded=await call('');
  assert.equal(evidenceHash(loaded.run.combat_state.pendingD20Interrupt),evidenceHash(pending.held));
  assert.equal(evidenceHash(await invariant()),evidenceHash(before));
  const row=await sql(`SELECT to_jsonb(c) FROM roguelike_command_receipts c WHERE c.run_id='${pending.id}' ORDER BY created_at DESC LIMIT 1;`);
  const {body,response}=acceptedReceiptReplay(row);
  for(let i=0;i<2;i++){
    assert.equal(evidenceHash(await call('/commands',body)),evidenceHash(response));
    assert.equal(evidenceHash(await invariant()),evidenceHash(before));
  }
  const continuation={command_id:randomUUID(),expected_revision:loaded.run.revision,type:'combat_intent',payload:{intent:{type:'d20_interrupt',actorId:null}}};
  const continued=await call('/commands',continuation),after=await invariant();
  assert.equal(evidenceHash(await call('/commands',continuation)),evidenceHash(continued));
  assert.equal(evidenceHash(await invariant()),evidenceHash(after));
  assert.notEqual(evidenceHash(after),evidenceHash(before));
  return {schemaVersion:1,status:'passed',execution:'native-owned-api',runId:stack.registry.runId,
    checks:['canonical-pending-choice','read-without-mutation','decode-accepted-receipt','duplicate-accepted-twice','continue-pending-choice','duplicate-continuation'],
    pendingHash:evidenceHash(pending.held),acceptedHash:evidenceHash(response),continuedHash:evidenceHash(continued),invariantHash:evidenceHash(after),
    limitations:['Not an OCI image rehearsal','Does not prove production historical corpus or fresh migration chain']};
}

export async function main(){
  const stack=await startTestStack({profile:'integration',reuseBuild:true});let report;
  try{report=await checkCanonicalReceiptScenario(stack);}
  finally{await stack.cleanup();}
  report.cleanup={status:stack.registry.status,errors:stack.registry.cleanupErrors};
  const output=path.join(stack.registry.directory,'rehearsal-scenario-native.json');
  await writeFile(output,JSON.stringify(report,null,2)+'\n');
  process.stdout.write(JSON.stringify({status:report.status,runId:report.runId,checks:report.checks.length,cleanup:report.cleanup.status,output})+'\n');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{process.stderr.write(`Native collector scenario failed: ${error.message}\n`);process.exitCode=1;});
