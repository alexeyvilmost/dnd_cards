import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';
const yaml=createRequire(new URL('../../frontend/package.json',import.meta.url))('js-yaml');
const workflow=name=>yaml.load(readFileSync(new URL(`../../.github/workflows/${name}.yml`,import.meta.url),'utf8'));
test('canonical no-op skips all component jobs, publication and downstream deployment',()=>{
 const release=workflow('release'),deploy=workflow('deploy');
 assert.match(release.jobs.prepare.outputs.no_deployment,/steps.plan.outputs.no_deployment/);
 for(const job of ['components','publish'])assert.match(release.jobs[job].if,/needs.prepare.outputs.no_deployment != 'true'/);
 assert.match(deploy.jobs.deploy.if,/needs.prepare.outputs.candidate_available == 'true'/);
 const identity=deploy.jobs.prepare.steps.find(s=>s.id==='identity');assert.match(identity.run,/release-publication\.mjs/);
 const download=deploy.jobs.prepare.steps.find(s=>s.uses?.startsWith('actions/download-artifact'));
 assert.match(download.if,/candidate_available == 'true'/);assert.match(download.with['artifact-ids'],/steps.identity.outputs.artifact_id/);assert.equal(download.with.name,undefined);
});
test('actual hosted mixed-image gate is after image publication and before the immutable candidate upload',()=>{
 const w=workflow('release'),steps=w.jobs.publish.steps;
 const publish=steps.findIndex(s=>s.run?.includes('ci-images.mjs publish')),mixed=steps.findIndex(s=>s.run?.includes('ui-mixed-oci.mjs')),upload=steps.findIndex(s=>s.with?.name==='release-candidate');
 assert.ok(publish>=0&&mixed>publish&&upload>mixed);assert.match(steps[mixed].if,/required == 'true'/);
 const installs=steps.filter(s=>s.run==='npm ci --ignore-scripts'&&s['working-directory']==='control/frontend');assert.equal(installs.length,1);const install=installs[0];assert.equal(install.if,"steps.mixed.outputs.required == 'true'");
 assert.ok(steps.indexOf(install)<mixed);assert.ok(steps.filter(s=>s.run==='npm ci --ignore-scripts'&&s['working-directory']==='writer-source/frontend').every(s=>s.if==="steps.writer.outputs.required == 'true'"));
 assert.ok(!steps[mixed].run.includes('hostConfig'));assert.equal(w.jobs.publish['runs-on'],'ubuntu-24.04');
 const plan=w.jobs.prepare.steps.find(s=>s.id==='plan');assert.ok(plan.env.GITHUB_TOKEN);assert.match(plan.env.FRONTEND_SELECTIVE_ENABLED,/vars\./);
});
test('CI carries fresh downloaded planning into every lane and uses independent hosted runners',()=>{
 const w=workflow('ci');assert.equal(w.jobs.contracts.strategy['max-parallel'],4);assert.equal(w.jobs.contracts['runs-on'],'ubuntu-24.04');
 const discovery=w.jobs.plan.steps.find(s=>s.id==='deployed'),download=w.jobs.plan.steps.find(s=>s.uses?.startsWith('actions/download-artifact'));
 assert.match(discovery.run,/ui-ci.mjs discover/);assert.match(download.with['artifact-ids'],/steps.deployed.outputs.artifact_id/);
 assert.ok(w.jobs.plan.steps.find(s=>s.id==='policy').env.FRONTEND_PLANNING_FILE);
 assert.match(w.jobs.contracts.steps.find(s=>s.name==='Run the shared suite runner').run,/--frontend-planning outputs\/testing\/frontend-planning.json/);
});
