#!/usr/bin/env node
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPlan} from '../release/plan-components.mjs';
import {requiredVerificationTier} from '../release/ci-release.mjs';
import {readSuites, selectGroups, catalogTests} from './suites.mjs';
import {suiteWorkload} from './workload.mjs';
import {shardPlan} from './shards.mjs';

export function selectCISuite(plan,{eventName,requestedSuite='core'}={}) {
  if (eventName === 'workflow_dispatch') {
    if (!['core','extended','legacy-manual'].includes(requestedSuite)) throw Error('Unknown manually requested suite');
    return requestedSuite;
  }
  if (!['push','pull_request'].includes(eventName)) throw Error('Unsupported CI event');
  // Push CI must verify accumulated changes since the last deployment as well
  // as the latest push. That deployment baseline is intentionally unavailable
  // to ordinary CI, so main always produces a releasable extended receipt.
  if(eventName==='push')return 'extended';
  return requiredVerificationTier(plan);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const plan=createPlan({mode:'ci',candidate:'HEAD',base:process.env.BASE_SHA});
  const suite=selectCISuite(plan,{eventName:process.env.GITHUB_EVENT_NAME,requestedSuite:process.env.REQUESTED_SUITE});
  const {manifest}=readSuites();
  const selection=selectGroups(manifest,plan,{suite,select:process.env.LEGACY_SUITE});
  const names=suite==='legacy-manual'?['legacy']:shardPlan(suiteWorkload({selection,catalog:catalogTests(manifest),manifest,suite})).names;
  process.stdout.write(`suite=${suite}\nshards=${JSON.stringify(names)}\n`);
}
