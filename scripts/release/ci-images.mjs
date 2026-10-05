#!/usr/bin/env node
// Explicit CI build/registry phase, never called by ordinary local tests.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {components, inventory, ignorePolicy} from './measure-local.mjs';
import {validateBuildPlan, validateComponentRecord, assembleCandidateManifest} from './ci-release.mjs';
import {assertOCIMediaDisabled} from './write-build-identity.mjs';

const read = file => JSON.parse(readFileSync(file, 'utf8'));
const docker = args => execFileSync('docker', args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024}).trim();
export async function fileHash(file) {const h = createHash('sha256'); for await (const chunk of createReadStream(file)) h.update(chunk); return `sha256:${h.digest('hex')}`;}
const localTag = (plan, row) => `bagofholding-candidate:${plan.candidate}-${row.name}-${row.inputFingerprint.slice(7, 19)}`;
const publicationTag = (plan, row) => `${row.imageRepository}:${plan.candidate}-${row.inputFingerprint.slice(7, 19)}`;
function rowFor(plan, name) {validateBuildPlan(plan); const row = plan.matrix.find(item => item.name === name); if (!row) throw Error('Unknown component'); return row;}
function save(file, data) {writeFileSync(file, JSON.stringify(data, null, 2) + '\n', {flag: 'wx'});}
function assertCurrentInputs(repo, plan, row) {
  const git = args => execFileSync('git', args, {cwd: repo, encoding: 'utf8'}).trim();
  if (git(['rev-parse', 'HEAD']) !== plan.candidate || git(['status', '--porcelain', '--untracked-files=all'])) throw Error('Candidate checkout drifted');
  const spec = components[row.name];
  const files = inventory(path.resolve(repo, spec.context), ignorePolicy(readFileSync(path.join(repo, spec.ignore), 'utf8')));
  const actual = `sha256:${createHash('sha256').update(files.map(file => `${file.path}\0${file.sha256}`).join('\n')).digest('hex')}`;
  if (actual !== row.sourceFingerprint) throw Error('Build context drifted since verified plan');
}

// Executes only constant inspection programs with no external network or DB.
// Full application startup is a separate mandatory candidate gate in REL-05.
export function inspectIdentity(image, plan, row, {command = docker, containerName, ownershipLabel} = {}) {
  const releaseId = plan.releaseId ?? 'image-contract';
  const args = ['run', '--rm', '--network', 'none', '--read-only', '--tmpfs', '/tmp:rw,nosuid,nodev,size=32m',
    '-e', `RELEASE_COMMIT=${plan.candidate}`, '-e', `RELEASE_ID=${releaseId}`, '-e', `SOURCE_COMMIT=${'0'.repeat(40)}`];
  if(containerName) {
    if(!/^boh-registry-[a-f0-9-]+-[a-z]+$/.test(containerName)||!/^bagofholding\.registry-rehearsal=[a-f0-9-]+$/.test(ownershipLabel??''))throw Error('Invalid owned image probe identity');
    args.push('--name',containerName,'--label',ownershipLabel);
  }
  if (row.name === 'backend') args.push(image, '--build-info');
  else if (row.name === 'frontend') args.push('--entrypoint', '/bin/sh', image, '-c', '/write-build-info.sh /opt/bagofholding/component-identity.json /tmp/build-info.json && cat /tmp/build-info.json');
  else args.push('--entrypoint', 'node', image, '--input-type=module', '-e',
    `import {createRulesWorker,loadWorkerBuildIdentity} from './server.mjs';
const server=await createRulesWorker({artifactFile:'./artifact.cjs',artifactsDirectory:'/tmp/artifacts',token:'ci-image-contract-token-000000000000',buildIdentity:await loadWorkerBuildIdentity('./component-identity.json'),releaseCommit:process.env.RELEASE_COMMIT,releaseId:process.env.RELEASE_ID});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try { const response=await fetch('http://127.0.0.1:'+server.address().port+'/health');if(!response.ok)throw Error('Worker health failed');console.log(JSON.stringify(await response.json())); } finally {await new Promise(r=>server.close(r));}`);
  const identity = JSON.parse(command(args));
  if (identity.releaseCommit !== plan.candidate || identity.releaseId !== releaseId) throw Error('Runtime release identity missing');
  return identity;
}

export function assertPublicationInput(plan, row, record, archiveHash) {
  validateBuildPlan(plan); validateComponentRecord(plan, row, record);
  if (row.operation === 'build' && (!/^sha256:[a-f0-9]{64}$/.test(record.archiveHash) || record.archiveHash !== archiveHash)) throw Error('Image archive missing or changed');
  return publicationTag(plan, row);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assertOCIMediaDisabled(process.env);
  const [mode, planFile, ...rest] = process.argv.slice(2), plan = validateBuildPlan(read(planFile));
  if (mode === 'outputs') {
    const [name, repo] = rest, row = rowFor(plan, name); assertCurrentInputs(repo, plan, row);
    const buildArgs = {...row.baseImages, ...row.buildArguments, COMPONENT_SOURCE_COMMIT: row.sourceCommit, COMPONENT_INPUT_FINGERPRINT: row.inputFingerprint};
    const safePath = value => {if (/[\r\n]/.test(value)) throw Error('Invalid path'); return value.replaceAll('\\', '/');};
    process.stdout.write(`operation=${row.operation}\ncontext=${safePath(path.resolve(repo, row.context))}\ndockerfile=${safePath(path.resolve(repo, row.dockerfile))}\ntag=${localTag(plan, row)}\nplatform=${row.platform}\nbuild_args<<BUILD_ARGS_END\n${Object.entries(buildArgs).map(([key, value]) => `${key}=${value}`).join('\n')}\nBUILD_ARGS_END\n`);
  } else if (mode === 'verify') {
    const [name, repo, output] = rest, row = rowFor(plan, name); assertCurrentInputs(repo, plan, row);
    mkdirSync(output, {recursive: true});
    const recordFile = path.join(output, 'record.json'), archive = path.join(output, 'image.tar');
    if (existsSync(recordFile)) {
      const record = read(recordFile); assertPublicationInput(plan, row, record, row.operation === 'build' ? await fileHash(archive) : undefined);
      process.stdout.write('Existing matching verified component record retained\n');
    } else {
      if (existsSync(archive)) throw Error('Partial output exists; use a fresh run directory');
      const image = row.operation === 'reuse' ? row.imageDigest : localTag(plan, row);
      if (row.operation === 'reuse') docker(['pull', '--platform', row.platform, image]);
      const info = JSON.parse(docker(['image', 'inspect', image]));
      if (info.length !== 1) throw Error('Ambiguous image identity');
      if (`${info[0].Os}/${info[0].Architecture}` !== row.platform) throw Error('Image platform mismatch');
      const identity = inspectIdentity(image, plan, row);
      const record = {schemaVersion: 1, status: 'verified-image', planHash: plan.planHash, component: row.component,
        sourceCommit: row.sourceCommit, inputFingerprint: row.inputFingerprint, imageId: info[0].Id, identity,
        imageDigest: row.operation === 'reuse' ? row.imageDigest : null};
      validateComponentRecord(plan, row, record);
      if (row.operation === 'build') {docker(['save', '-o', archive, image]); record.archiveHash = await fileHash(archive);}
      assertCurrentInputs(repo, plan, row); save(recordFile, record);
    }
  } else if (mode === 'publish') {
    // Credentials/configuration must be enabled explicitly in GitHub environment.
    if (process.env.RELEASE_PUBLICATION_ENABLED !== 'true') throw Error('Registry publication is disabled');
    if(process.env.GITHUB_SHA!==plan.controlCommit||Number(process.env.GITHUB_RUN_ID)!==plan.releaseRunId)throw Error('Publication control run differs from verified build plan');
    const [directory, output] = rest;
    const records = {}, published = {};
    // Validate every component before the first registry mutation.
    for (const row of plan.matrix) {
      const record = read(path.join(directory, row.name, 'record.json'));
      assertPublicationInput(plan, row, record, row.operation === 'build' ? await fileHash(path.join(directory, row.name, 'image.tar')) : undefined);
      records[row.component] = record;
    }
    for (const row of plan.matrix) {
      if (row.operation === 'reuse') {docker(['pull', '--platform', row.platform, row.imageDigest]); published[row.component] = row.imageDigest; continue;}
      const record = records[row.component], tag = publicationTag(plan, row);
      docker(['load', '-i', path.join(directory, row.name, 'image.tar')]);
      const actual = JSON.parse(docker(['image', 'inspect', localTag(plan, row)]))[0];
      if (actual.Id !== record.imageId) throw Error('Loaded image differs from verified archive');
      docker(['tag', record.imageId, tag]); docker(['push', tag]);
      const inspected = JSON.parse(docker(['image', 'inspect', tag]))[0];
      const refs = inspected.RepoDigests.filter(ref => ref.startsWith(`${row.imageRepository}@sha256:`));
      if (refs.length !== 1) throw Error('Published digest cannot be identified unambiguously');
      published[row.component] = refs[0];
    }
    const result = assembleCandidateManifest(plan, records, published);
    mkdirSync(output, {recursive: true}); save(path.join(output, 'candidate.json'), result);
    save(path.join(output, 'manifest.json'), result.manifest); save(path.join(output, 'core-report.json'), result.reports.core);
  } else throw Error('Expected outputs, verify or publish command');
}
