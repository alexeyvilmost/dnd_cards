#!/usr/bin/env node
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDeploymentStore, planDeployment, deploy, recover} from './deploy-state.mjs';
import {adaptLegacyManifest} from './validate-manifest.mjs';
import {assertHostConfiguration, createDockerDeploymentAdapter} from './docker-deployment.mjs';
import {isLegacyBaseline} from './legacy-baseline.mjs';
const read = file => JSON.parse(readFileSync(file, 'utf8'));
export async function main(args) {
  const [mode, ...rest] = args;
  if (mode === 'legacy-inspect' && rest.length === 1) return adaptLegacyManifest(read(rest[0]));
  if (mode === 'plan' && rest.length === 3) return planDeployment(read(rest[0]), read(rest[1]), read(rest[2]));
  if (mode === 'status' && rest.length === 1) {const store = createDeploymentStore(rest[0]); return {active: store.active(), pending: store.pending()};}
  if (!['apply','adopt', 'recover', 'rollback'].includes(mode) || rest.length !== 4 || rest[0] !== '--production') throw Error('Usage: deploy.mjs plan candidate.json bundle.json active.json | legacy-inspect old.json | status root | apply/adopt/recover/rollback --production config.json policy.json candidate-directory-or-release-id');
  const [, configFile, policyFile, target] = rest;
  const config = assertHostConfiguration(read(configFile), read(policyFile), {production: true});
  const store = createDeploymentStore(config.root,{legacyBaselineFile:config.legacyBaselineDirectory?path.join(config.legacyBaselineDirectory,'baseline.json'):undefined});
  if(mode==='apply'&&isLegacyBaseline(store.active()))throw Error('First legacy transition requires explicit adopt mode');
  if(mode==='adopt'&&!config.legacyBaselineDirectory)throw Error('Reviewed observed legacy baseline directory required');
  const adapter = await createDockerDeploymentAdapter(config);
  if (mode === 'apply'||mode==='adopt') return deploy({store, adapter, candidate: read(path.join(target, 'manifest.json')), bundle: read(path.join(target, 'bundle.json'))});
  return recover({store, adapter, releaseId: target, rollback: mode === 'rollback'});
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {process.stdout.write(JSON.stringify(await main(process.argv.slice(2)), null, 2) + '\n');}
  catch (error) {process.stderr.write(`Deployment refused/failed: ${error.message}\n`); process.exitCode = 1;}
}
