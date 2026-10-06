import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';
const yaml=createRequire(new URL('../../frontend/package.json',import.meta.url))('js-yaml');
const workflow=name=>yaml.load(readFileSync(new URL(`../../.github/workflows/${name}.yml`,import.meta.url),'utf8'));
test('automatic preflight is on the serialized prepare side and stale candidates cannot schedule a deploy job',()=>{
  const w=workflow('deploy'),steps=w.jobs.prepare.steps;
  assert.equal(w.concurrency.group,'production-composition');assert.equal(w.concurrency['cancel-in-progress'],false);
  assert.match(w.jobs.prepare.outputs.candidate_available,/steps.freshness.outputs.candidate_available/);
  assert.match(w.jobs.deploy.if,/needs.prepare.outputs.candidate_available == 'true'/);
  const fresh=steps.findIndex(s=>s.id==='freshness'),candidate=steps.findIndex(s=>s.id==='candidate'),upload=steps.findIndex(s=>s.with?.name==='validated-deployment-input');
  assert.ok(fresh>candidate&&upload>fresh);assert.match(steps[upload].if,/freshness.outputs.candidate_available == 'true'/);
  assert.match(steps[fresh].run,/preflight candidate verified-release-run.json latest-deployment.json current-baseline/);
  assert.ok(!Object.keys(w.jobs.prepare.permissions).some(key=>['deployments','packages'].includes(key)));
});
test('main-only successful-deployment coordinator has no dispatch input, secrets or host permission and opts in explicitly',()=>{
  const w=workflow('reconcile');assert.deepEqual(Object.keys(w.on),['workflow_run']);assert.deepEqual(w.on.workflow_run.branches,['main']);
  assert.deepEqual(w.on.workflow_run.workflows,['Deploy validated immutable composition']);assert.deepEqual(w.on.workflow_run.types,['completed']);
  assert.match(w['run-name'],/github.event.workflow_run.id.*github.event.workflow_run.run_attempt/);
  assert.equal(w.concurrency['cancel-in-progress'],false);assert.equal(w.jobs.reconcile.permissions.actions,'write');assert.equal(w.jobs.reconcile.permissions.contents,'read');
  assert.match(w.jobs.reconcile.if,/conclusion == 'success'/);assert.match(w.jobs.reconcile.if,/AUTO_RECONCILE_MAIN_ENABLED == 'true'/);
  for(const key of ['RELEASE_BUILD_ENABLED','AUTO_RELEASE_MAIN_ENABLED','RELEASE_PUBLICATION_ENABLED','PRODUCTION_DEPLOY_ENABLED','AUTO_DEPLOY_MAIN_ENABLED'])assert.ok(w.jobs.reconcile.if.includes(`${key} == 'true'`));
  assert.ok(!JSON.stringify(w).includes('secrets.'));assert.ok(!JSON.stringify(w).includes('ssh-'));assert.equal(w.jobs.reconcile.environment,undefined);
});
test('immutable claim is uploaded before the sole POST, and the result/claim survive unknown dispatch results',()=>{
  const steps=workflow('reconcile').jobs.reconcile.steps,plan=steps.findIndex(s=>s.id==='plan'),claim=steps.findIndex(s=>s.with?.name==='${{ steps.plan.outputs.claim_name }}'),post=steps.findIndex(s=>s.run?.includes('convergence-cli.mjs dispatch'));
  assert.ok(plan<claim&&claim<post);assert.equal(steps[claim].with['retention-days'],90);assert.equal(steps[claim].with['if-no-files-found'],'error');
  assert.equal(steps.filter(s=>s.run?.includes('convergence-cli.mjs dispatch')).length,1);
  const result=steps.find(s=>s.with?.name==='reconciliation-result');assert.equal(result.if,'always()');assert.ok(result.with.path.includes('reconciliation-dispatch.json'));
});
test('CI validates request source, main, actual claim and extended suite before workload selection; ordinary CI retains its existing path',()=>{
  const w=workflow('ci');assert.equal(w.on.workflow_dispatch.inputs.reconcile_request.required,false);
  const guard=w.jobs.plan.steps.findIndex(s=>s.run?.includes('convergence-cli.mjs ci-guard')),policy=w.jobs.plan.steps.findIndex(s=>s.id==='policy');assert.ok(guard>=0&&guard<policy);
  assert.equal(w.jobs.plan.permissions.actions,'read');assert.equal(w.jobs.contracts.strategy['max-parallel'],4);
  assert.match(w.jobs.plan.steps[guard].env.AUTO_RECONCILE_MAIN_ENABLED,/vars.AUTO_RECONCILE_MAIN_ENABLED/);
  assert.equal(w.concurrency['cancel-in-progress'],true);
});
