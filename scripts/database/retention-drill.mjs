#!/usr/bin/env node
import {writeFile} from 'node:fs/promises';
import {startTestStack} from '../testing/stack.mjs';
import {collectStorageReport} from './storage-report.mjs';
import {collectDataURLInventory} from './data-url-inventory.mjs';
import {buildRetentionPlan} from './retention-plan.mjs';
const args=process.argv.slice(2);if(args.length!==2||args[0]!=='--output')throw Error('Usage: retention-drill.mjs --output <new plan.json>');
const stack=await startTestStack({profile:'integration',reuseBuild:true});
try {
  const plan=buildRetentionPlan(await collectStorageReport({dsn:stack.database.dsn,registry:stack.registry}),await collectDataURLInventory(stack.database));
  await writeFile(args[1],JSON.stringify(plan,null,2)+'\n',{flag:'wx'});
  process.stdout.write(`PASS: owned full-catalog plan has ${plan.candidates.length} reviewable exact duplicate candidates; nothing removed.\n`);
}finally{await stack.cleanup();}
