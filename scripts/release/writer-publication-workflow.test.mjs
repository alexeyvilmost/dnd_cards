import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';

const yaml=createRequire(new URL('../../frontend/package.json',import.meta.url))('js-yaml');
const load=async()=>yaml.load(await readFile(new URL('../../.github/workflows/release.yml',import.meta.url),'utf8'));
const writerCondition="steps.writer.outputs.required == 'true'";
function assertWriterHook(workflow){
 const job=workflow.jobs.publish,steps=job.steps;
 assert.equal(job['runs-on'],'ubuntu-24.04');assert.equal(job.permissions.actions,'read');
 assert.equal(job.env?.GITHUB_TOKEN,undefined);
 const find=predicate=>{const rows=steps.filter(predicate);assert.equal(rows.length,1);return rows[0];};
 const publish=find(s=>s.run?.includes('ci-images.mjs publish'));
 const mixed=find(s=>s.id==='mixed'),discover=find(s=>s.id==='writer');
 assert.equal(discover.if,"steps.mixed.outputs.required != 'true'");
 assert.match(discover.run,/writer-fixture-cli\.mjs discover artifacts\/candidate\/candidate.json artifacts\/writer-discovery.json >> "\$GITHUB_OUTPUT"$/);
 assert.equal(discover.env.GITHUB_TOKEN,'${{ github.token }}');
 const previous=find(s=>s.with?.path==='artifacts/writer-previous');
 assert.match(previous.uses,/^actions\/download-artifact@[a-f0-9]{40}$/);
 assert.equal(previous.with['artifact-ids'],'${{ steps.writer.outputs.baseline_artifact_id }}');
 assert.equal(previous.with['run-id'],'${{ steps.writer.outputs.baseline_run_id }}');
 assert.equal(previous.with.name,undefined);assert.equal(previous.with['merge-multiple'],true);
 const source=find(s=>s.with?.path==='writer-source');
 assert.match(source.uses,/^actions\/checkout@[a-f0-9]{40}$/);
 assert.equal(source.with.ref,'${{ steps.writer.outputs.source_commit }}');assert.equal(source.with['persist-credentials'],false);
 const install=find(s=>s['working-directory']==='writer-source/frontend'&&s.run?.startsWith('npm'));
 assert.equal(install.run,'npm ci --ignore-scripts');
 const browser=find(s=>s.run==='node node_modules/playwright/cli.js install --with-deps chromium');
 assert.equal(browser['working-directory'],'writer-source/frontend');
 const pg=find(s=>s.run?.includes('sudo apt-get install --yes postgresql-17'));
 assert.match(pg.run,/https:\/\/www.postgresql.org\/media\/keys\/ACCC4CF8.asc/);
 const produce=find(s=>s.run?.includes('writer-fixture-cli.mjs produce'));
 assert.equal(produce.run,'node control/scripts/release/writer-fixture-cli.mjs produce artifacts/candidate/candidate.json artifacts/writer-discovery.json artifacts/writer-previous writer-source artifacts/writer-fixture');
 assert.equal(produce.env.GITHUB_TOKEN,'${{ github.token }}');assert.equal(produce.env.TEST_PG_BIN,'/usr/lib/postgresql/17/bin');
 const upload=find(s=>s.with?.name==='release-candidate');
 assert.match(upload.uses,/^actions\/upload-artifact@[a-f0-9]{40}$/);
 assert.equal(upload.with.path,'artifacts/candidate/');assert.equal(upload.if,undefined);
 assert.equal(upload.with['if-no-files-found'],'error');
 const ordered=[publish,mixed,discover,previous,source,install,browser,pg,produce,upload].map(s=>steps.indexOf(s));
 assert.deepEqual(ordered,[...ordered].sort((a,b)=>a-b));
 for(const step of [previous,source,install,browser,pg,produce])assert.equal(step.if,writerCondition);
 for(const step of [discover,previous,source,install,browser,pg,produce,upload]){
  assert.notEqual(step['continue-on-error'],true);assert.ok(!/\|\|\s*true|always\(\)/.test(step.run??''));
 }
 for(const step of [install,browser,pg])assert.equal(step.env?.GITHUB_TOKEN,undefined);
 // The selective collector remains a separate path, with its own OCI proof.
 const selective=find(s=>s.run?.includes('ui-mixed-oci.mjs'));
 assert.equal(selective.if,"steps.mixed.outputs.required == 'true'");assert.ok(steps.indexOf(selective)<steps.indexOf(upload));
}

test('writer proof runs before the sole candidate upload, using exact source and actual predecessor artifact',async()=>assertWriterHook(await load()));

test('publication workflow guards reject stale artifact, unsafe source and a bypassed or optional proof',async()=>{
 const baseline=await load();
 for(const mutate of [
  w=>{w.jobs.publish.steps.find(s=>s.id==='writer').if=undefined;},
  w=>{w.jobs.publish.steps.find(s=>s.with?.path==='artifacts/writer-previous').with['artifact-ids']='${{ inputs.baseline_artifact_id }}';},
  w=>{w.jobs.publish.steps.find(s=>s.with?.path==='writer-source').with.ref='main';},
  w=>{w.jobs.publish.steps.find(s=>s.with?.path==='writer-source').with['persist-credentials']=true;},
  w=>{w.jobs.publish.steps.find(s=>s.run==='npm ci --ignore-scripts'&&s['working-directory']==='writer-source/frontend').run='npm ci';},
  w=>{w.jobs.publish.steps.find(s=>s.run?.includes('writer-fixture-cli.mjs produce'))['continue-on-error']=true;},
  w=>{w.jobs.publish.steps.find(s=>s.run?.includes('writer-fixture-cli.mjs produce')).run+=' || true';},
  w=>{w.jobs.publish.steps.find(s=>s.with?.name==='release-candidate').if='${{ always() }}';},
  w=>{const rows=w.jobs.publish.steps,index=rows.findIndex(s=>s.with?.name==='release-candidate'),[upload]=rows.splice(index,1);rows.unshift(upload);},
 ]){const changed=structuredClone(baseline);mutate(changed);assert.throws(()=>assertWriterHook(changed));}
});
