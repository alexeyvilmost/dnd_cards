import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';
const yaml=createRequire(new URL('../../frontend/package.json',import.meta.url))('js-yaml');
test('manual record uses the sole serialized production deploy job with isolated record input and transport',()=>{
  const w=yaml.load(readFileSync(new URL('../../.github/workflows/deploy.yml',import.meta.url),'utf8'));
  assert.equal(w.on.workflow_dispatch.inputs.retirement_operation_id.required,false);assert.match(w['run-name'],/Record retirement/);
  assert.equal(Object.entries(w.jobs).filter(([id,j])=>(j.name??id)==='deploy').length,1);assert.equal(w.jobs.deploy.environment,'production');
  assert.equal(w.concurrency.group,'production-composition');assert.equal(w.concurrency['cancel-in-progress'],false);
  const identity=w.jobs.prepare.steps.find(s=>s.id==='identity');assert.match(identity.run,/test "\$DEPLOY_EVENT" = workflow_dispatch/);assert.match(identity.run,/test "\$ADOPT_LEGACY" = false/);assert.match(identity.run,/test -z "\$RELEASE_RUN"/);
  const record=w.jobs.prepare.steps.find(s=>s.id==='record');assert.match(record.if,/deployment_mode == 'record-retirement'/);assert.match(record.run,/retirement-record-ci/);
  const steps=w.jobs.deploy.steps,normal=steps.find(s=>s.run?.includes('ssh-deploy.mjs')),manual=steps.find(s=>s.run?.includes('ssh-retirement-record.mjs'));
  assert.match(normal.if,/deployment_mode != 'record-retirement'/);assert.match(manual.if,/deployment_mode == 'record-retirement'/);
  assert.equal(manual.env.DEPLOY_SSH_PRIVATE_KEY,'${{ secrets.DEPLOY_SSH_PRIVATE_KEY }}');assert.equal(manual.env.GITHUB_TOKEN,'${{ github.token }}');
  assert(!JSON.stringify(manual).includes('retirement-host.mjs'));assert(!JSON.stringify(w.jobs.prepare).includes('secrets.'));
});
