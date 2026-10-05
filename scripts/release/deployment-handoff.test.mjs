import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {checkTrigger,deploymentMode} from './deployment-handoff.mjs';
import {assertHostConfiguration} from './docker-deployment.mjs';
import {verifyRun} from './ci-release.mjs';
const yaml = createRequire(new URL('../../frontend/package.json', import.meta.url))('js-yaml');
test('manual and automatic production policy gates remain independently enforced', () => {
  const reviewed = JSON.parse(readFileSync(new URL('../../infra/deployment-policy.json', import.meta.url)));
  const event = {name: 'workflow_dispatch', branch: 'main', sha: 'a'.repeat(40)};
  checkTrigger(reviewed,event,event.sha);
  const policy={...reviewed,productionEnabled:false,autoDeployMain:false};
  assert.throws(() => checkTrigger(policy, event, event.sha), /disabled/);
  const manual = {...policy, productionEnabled: true}; checkTrigger(manual, event, event.sha);
  assert.throws(() => checkTrigger(manual, {...event, name: 'workflow_run', conclusion: 'success'}, event.sha), /Automatic/);
  checkTrigger({...manual, autoDeployMain: true}, {...event, name: 'workflow_run', conclusion: 'success'}, event.sha);
  assert.throws(() => checkTrigger(manual, event, 'b'.repeat(40)), /Exact/);
  assert.throws(() => assertHostConfiguration({}, policy, {production: true, enabled: 'true'}), /disabled/);
});
test('first legacy adoption is explicit manual only and emits the ordinary successful deployment receipt path',()=>{
 assert.equal(deploymentMode('workflow_dispatch','true'),'adopt');assert.equal(deploymentMode('workflow_dispatch'),'apply');assert.equal(deploymentMode('workflow_run'),'apply');
 assert.throws(()=>deploymentMode('workflow_run','true'));assert.throws(()=>deploymentMode('pull_request','true'));assert.throws(()=>deploymentMode('workflow_dispatch','yes'));
 const workflow=yaml.load(readFileSync(new URL('../../.github/workflows/deploy.yml',import.meta.url),'utf8'));
 assert.equal(workflow.on.workflow_dispatch.inputs.adopt_legacy.default,false);assert.equal(workflow.on.workflow_dispatch.inputs.adopt_legacy.type,'boolean');
 const step=workflow.jobs.deploy.steps.find(step=>step.env?.DEPLOY_MODE);assert.match(step.run,/ssh-deploy\.mjs control candidate deployed-release/);
 const host=readFileSync(new URL('./ssh-host-release.mjs',import.meta.url),'utf8');assert.match(host,/command\('deploy\.mjs',\[request.mode,'--production'/);assert.match(host,/command\('deployment-handoff\.mjs',\['receipt'/);
});
test('deployment workflow serializes noncancellable cutovers, trusts exact upstream and has no package write', () => {
  const workflow = yaml.load(readFileSync(new URL('../../.github/workflows/deploy.yml', import.meta.url), 'utf8'));
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  assert.match(workflow.jobs.prepare.if, /PRODUCTION_DEPLOY_ENABLED/); assert.match(workflow.jobs.prepare.if, /AUTO_DEPLOY_MAIN_ENABLED/);
  assert.equal(workflow.jobs.deploy.environment, 'production'); assert.equal(workflow.jobs.deploy.permissions.packages, 'read');
  for (const job of Object.values(workflow.jobs)) for (const step of job.steps) if (step.uses) assert.match(step.uses, /^[\w/-]+@[a-f0-9]{40}$/);
  const run = {id: 42, path: '.github/workflows/deploy.yml', status: 'completed', conclusion: 'success', event: 'workflow_run', head_branch: 'main', head_sha: 'b'.repeat(40), repository: {full_name: 'own/repo'}, head_repository: {full_name: 'own/repo'}};
  verifyRun(run, {repository: 'own/repo', kind: 'deployment'});
  assert.throws(() => verifyRun(run, {repository: 'own/repo', kind: 'release'}));
});
