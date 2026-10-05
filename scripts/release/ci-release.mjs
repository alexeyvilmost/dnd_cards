#!/usr/bin/env node
// Privilege-free preparation/aggregation. All GitHub metadata is read-only.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {components, inventory, ignorePolicy, copyInputs, checkEmbeddedInputs, validateImagePins} from './measure-local.mjs';
import {createPlan, classifyPath} from './plan-components.mjs';
import {componentInputFingerprint, evidenceHash, compositionFingerprint, validateManifest,validateMigrationSet} from './validate-manifest.mjs';
import {assertOCIMediaDisabled} from './write-build-identity.mjs';
import {selectLatestDeployedRun} from './deployed-baseline.mjs';
import {loadControlRecovery,recoveryFields} from './first-adoption-recovery.mjs';
import {assertSourceContentManifest} from './source-content-manifest.mjs';

const exactSHA = /^[a-f0-9]{40}$/;
const hashPattern = /^sha256:[a-f0-9]{64}$/;
const digestRef = /^[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}$/;
const componentNames = {frontend: 'frontend', backend: 'backend', worker: 'rulesWorker'};
const componentPins = {backend: ['GO_IMAGE', 'ALPINE_IMAGE'], frontend: ['NODE_IMAGE', 'NGINX_IMAGE'], worker: ['NODE_IMAGE']};
const rowBaseImages = (name, config) => Object.fromEntries(componentPins[name].map(key => [key, config.baseImages[key]]));
const rowBuildArguments = (name, config) => name === 'frontend' ? {VITE_API_URL: config.frontendApiUrl, VITE_MEDIA_VARIANTS: '0'} : {};
const read = file => JSON.parse(readFileSync(file, 'utf8'));
const git = (repo, args) => execFileSync('git', args, {cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
export function validateBuildConfig(config) {
  if (config.schemaVersion !== 1 || config.enabled !== true) throw Error('Release builds disabled; reviewed build configuration required');
  const fields = ['schemaVersion', 'enabled', 'platform', 'baseImages', 'buildkitImage', 'frontendApiUrl', 'contentManifestHash', 'migrationSet', 'frontendMediaVariants'];
  if (Object.keys(config).some(key => !fields.includes(key)) || config.frontendMediaVariants !== undefined && config.frontendMediaVariants !== false) throw Error('Unknown release configuration or unsupported enabled media bundle; schema v1 supports originals only');
  validateImagePins(config.baseImages);
  if (!digestRef.test(config.buildkitImage) || config.platform !== 'linux/amd64'
    || typeof config.frontendApiUrl !== 'string' || /[\r\n\0]/.test(config.frontendApiUrl)
    || !hashPattern.test(config.contentManifestHash) || !Array.isArray(config.migrationSet)) throw Error('Incomplete immutable release build configuration');
  validateMigrationSet(config.migrationSet);
  return config;
}
export function verifyRun(run, {repository, candidate, kind}) {
  const workflow = {verification: '.github/workflows/ci.yml', deployment: '.github/workflows/deploy.yml', release: '.github/workflows/release.yml'}[kind];
  if (!/^\w[\w.-]*\/[\w.-]+$/.test(repository) || !workflow
    || !Number.isSafeInteger(run?.id) || run.id <= 0 || run.status !== 'completed' || run.conclusion !== 'success'
    || run.path !== workflow || run.head_branch !== 'main' || !(kind === 'verification' ? ['push', 'workflow_dispatch'] : ['push', 'workflow_dispatch', 'workflow_run']).includes(run.event)
    || run.repository?.full_name !== repository || run.head_repository?.full_name !== repository
    || !exactSHA.test(run.head_sha) || kind==='release'&&candidate || kind!=='release'&&candidate&&run.head_sha!==candidate) throw Error('Untrusted or unsuccessful workflow run; release control SHA is not candidate SHA');
  return {id: run.id, workflow, repository, ...(kind==='verification'?{sourceCommit:run.head_sha}:{controlCommit:run.head_sha}), event: run.event};
}
export function requiredVerificationTier(plan) {
  if(plan?.schema_version!==1||!exactSHA.test(plan.baseline?.sha??'')||plan.full_fallback!==false||!Array.isArray(plan.changed_files)
    ||plan.components?.worker===true||plan.components?.backend===true||plan.components?.infrastructure===true)return 'extended';
  for(const file of plan.changed_files){
    let rule;try{rule=classifyPath(file);}catch{return 'extended';}
    if(!['frontend-ui','frontend-build','frontend-docs','documentation'].includes(rule.rule))return 'extended';
  }
  return 'core';
}
export function verifySuiteReport(report, candidate, {requiredTier='extended'}={}) {
  if (report?.shard) throw Error('A partial shard cannot authorize release; aggregate every required shard first');
  if (report?.schema_version !== 1 || report.status !== 'passed' || !['core', 'extended'].includes(report.suite)
    || report.candidate?.sha !== candidate || report.ci_source?.clean_checkout!==true || report.component_plan?.mode !== 'ci' || report.component_plan?.candidate?.sha !== candidate
    || !Array.isArray(report.checks) || report.checks.some(check => typeof check.id !== 'string' || check.status !== 'passed')
    || new Set(report.checks.map(check => check.id)).size !== report.checks.length) throw Error('CI suite report is not a passing exact-source report');
  if(!['core','extended'].includes(requiredTier)||requiredTier==='extended'&&report.suite!=='extended')throw Error('Critical changes require an extended exact-source report');
  for (const id of ['source-hygiene', 'source-stability', 'local-api-spine', 'local-browser-flows']) {
    if (!report.checks?.some(check => check.id === id && check.status === 'passed')) throw Error(`Mandatory verification missing: ${id}`);
  }
  const stable=report.checks.find(check=>check.id==='source-stability').result;
  if(!/^[a-f0-9]{64}$/.test(report.source_snapshot?.sha256??'')||!Number.isSafeInteger(report.source_snapshot.files)||report.source_snapshot.files<1
    ||stable?.unchanged!==true||stable.sha256!==report.source_snapshot.sha256||stable.files!==report.source_snapshot.files||report.source_drift)throw Error('CI source snapshot changed or source-stability proof is missing');
  if (report.cleanup?.status !== 'stopped' || report.cleanup?.errors?.length) throw Error('Verification stack cleanup incomplete');
  return {reportHash: evidenceHash(report), candidate, suite: report.suite, requiredTier, sourceSnapshot:report.source_snapshot, checks: report.checks.map(check => check.id)};
}
export function verifyBaseline(manifest, receipt, run) {
  validateManifest(manifest);
  if (receipt?.releaseCommit !== manifest.releaseCommit || receipt.controlCommit !== run.controlCommit || receipt.schemaVersion !== 1 || receipt.status !== 'succeeded'
    || receipt.manifestHash !== evidenceHash(manifest) || receipt.releaseId !== manifest.releaseId) throw Error('Baseline is not an attested successful deployment');
  return manifest;
}

export function prepareBuildPlan({repo, candidate, repository, controlCommit, releaseRunId, config, verification, suiteReport, baseline, baselineReceipt, baselineRun, baselineFile, firstAdoptionRecovery, environment = process.env}) {
  validateBuildConfig(config);
  if(firstAdoptionRecovery) {
    loadControlRecovery({id:firstAdoptionRecovery.id,reference:firstAdoptionRecovery,controlRoot:path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),controlCommit,repository});
    if(baseline||baselineRun||baselineReceipt||candidate!==controlCommit)throw Error('Recovery cannot reuse a deployment baseline');
  }
  assertOCIMediaDisabled(environment);
  if(!exactSHA.test(controlCommit??'')||!Number.isSafeInteger(releaseRunId)||releaseRunId<1)throw Error('Exact release control commit and workflow run identity required');
  if (!exactSHA.test(candidate) || git(repo, ['rev-parse', 'HEAD']) !== candidate
    || git(repo, ['status', '--porcelain', '--untracked-files=all'])) throw Error('Build source must be an exact clean checked-out commit');
  assertSourceContentManifest(repo,config);
  git(repo, ['merge-base', '--is-ancestor', candidate, 'refs/remotes/origin/main']);
  if (verification.sourceCommit !== candidate || verification.repository !== repository) throw Error('Verification source mismatch');
  if (baseline) {
    verifyBaseline(baseline, baselineReceipt, baselineRun);
    if (!baselineFile || evidenceHash(read(baselineFile)) !== evidenceHash(baseline)) throw Error('Baseline file mismatch');
  }
  const selection = baseline ? createPlan({repo, mode: 'deploy', candidate, deployedManifest: baselineFile}) : createPlan({repo, mode: 'ci', candidate, full: true});
  const matrix = [];
  for (const [name, spec] of Object.entries(components)) {
    const root = path.resolve(repo, spec.context);
    const files = inventory(root, ignorePolicy(readFileSync(path.join(repo, spec.ignore), 'utf8')));
    copyInputs(readFileSync(path.join(repo, spec.dockerfile), 'utf8'), files);
    if (name === 'backend') checkEmbeddedInputs(root, files);
    const sourceFingerprint = `sha256:${createHash('sha256').update(files.map(file => `${file.path}\0${file.sha256}`).join('\n')).digest('hex')}`;
    const baseImages = rowBaseImages(name, config);
    const buildArguments = rowBuildArguments(name, config);
    const component = componentNames[name];
    const inputFingerprint = componentInputFingerprint({component, sourceFingerprint, baseImages, platform: config.platform, buildArguments});
    const old = baseline?.components[component];
    const reuse = Boolean(old && !selection.components[name] && old.inputFingerprint === inputFingerprint);
    matrix.push({name, component, context: spec.context, dockerfile: spec.dockerfile, sourceFingerprint,
      inputFingerprint, sourceCommit: reuse ? old.sourceCommit : candidate, operation: reuse ? 'reuse' : 'build',
      imageDigest: reuse ? old.imageDigest : null, imageRepository: `ghcr.io/${repository.toLowerCase()}/${name}`,
      baseImages, buildArguments, platform: config.platform});
  }
  const baselineIdentity = baseline ? {releaseId: baseline.releaseId, manifestHash: evidenceHash(baseline)} : null;
  const requiredTier=requiredBuildVerificationTier({selection,matrix,config,previousManifest:baseline});
  const evidence=verifySuiteReport(suiteReport,candidate,{requiredTier});
  return {schemaVersion: 1, status: 'build-planned', candidate, controlCommit, releaseRunId, repository, config, matrix, selection, verification,
    verificationEvidence: evidence, previousManifest: baseline ?? null, baselineIdentity,...recoveryFields(firstAdoptionRecovery),
    planHash: evidenceHash({candidate, controlCommit, releaseRunId, selection, matrix, config, verification: evidence, baselineIdentity,...recoveryFields(firstAdoptionRecovery)})};
}
function requiredBuildVerificationTier(plan){
  if(!plan.previousManifest||evidenceHash(plan.previousManifest.migrationSet)!==evidenceHash(plan.config.migrationSet)
    ||plan.matrix.some(row=>['backend','worker'].includes(row.name)&&row.operation==='build'))return 'extended';
  return requiredVerificationTier(plan.selection);
}

export function validateComponentRecord(plan, row, record) {
  if (record?.schemaVersion !== 1 || record.status !== 'verified-image' || record.planHash !== plan.planHash
    || record.component !== row.component || record.sourceCommit !== row.sourceCommit
    || record.inputFingerprint !== row.inputFingerprint || !/^sha256:[a-f0-9]{64}$/.test(record.imageId)) throw Error('Component record source mismatch');
  const identity = record.identity;
  if (identity?.component !== row.component || identity.identitySchemaVersion !== 1 || identity.provenance !== 'baked'
    || identity.sourceCommit !== row.sourceCommit || identity.source_commit !== row.sourceCommit || identity.inputFingerprint !== row.inputFingerprint
    || identity.apiProtocolVersion !== 1) throw Error('Baked component identity mismatch');
  if (row.operation === 'reuse' && record.imageDigest !== row.imageDigest) throw Error('Reused image digest mismatch');
  if (row.component === 'rulesWorker' && (!hashPattern.test(identity.artifactHash) || identity.workerProtocolVersion !== 1
    || identity.workerRuntime?.name !== 'node' || !/^\d+\.\d+\.\d+$/.test(identity.workerRuntime.version))) throw Error('Worker compatibility identity missing');
  return record;
}

export function validateBuildPlan(plan) {
  validateBuildConfig(plan.config);
  if (plan.schemaVersion !== 1 || plan.status !== 'build-planned' || !exactSHA.test(plan.candidate)
    ||!exactSHA.test(plan.controlCommit??'')||!Number.isSafeInteger(plan.releaseRunId)||plan.releaseRunId<1
    || !/^[\w.-]+\/[\w.-]+$/.test(plan.repository) || plan.matrix?.length !== 3
    || new Set(plan.matrix.map(row => row.name)).size !== 3) throw Error('Invalid immutable build plan');
  if (plan.planHash !== evidenceHash({candidate: plan.candidate, controlCommit:plan.controlCommit, releaseRunId:plan.releaseRunId, selection:plan.selection, matrix: plan.matrix, config: plan.config, verification: plan.verificationEvidence, baselineIdentity: plan.baselineIdentity,...recoveryFields(plan.firstAdoptionRecovery)})) throw Error('Build plan hash mismatch');
  if(plan.verificationEvidence?.requiredTier!==requiredBuildVerificationTier(plan)
    ||plan.verificationEvidence.requiredTier==='extended'&&plan.verificationEvidence.suite!=='extended')throw Error('Build verification tier does not satisfy critical path policy');
  if(plan.firstAdoptionRecovery) {
    loadControlRecovery({id:plan.firstAdoptionRecovery.id,reference:plan.firstAdoptionRecovery,controlRoot:path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),controlCommit:plan.controlCommit,repository:plan.repository});
    if(plan.candidate!==plan.controlCommit||plan.previousManifest||plan.baselineIdentity||plan.matrix.some(row=>row.operation!=='build')||plan.verificationEvidence?.suite!=='extended')throw Error('Recovery requires an initial full extended build');
  }
  if (plan.previousManifest) validateManifest(plan.previousManifest);
  const baselineIdentity = plan.previousManifest ? {releaseId: plan.previousManifest.releaseId, manifestHash: evidenceHash(plan.previousManifest)} : null;
  if (evidenceHash(plan.baselineIdentity) !== evidenceHash(baselineIdentity)
    || plan.verification?.sourceCommit !== plan.candidate || plan.verification.repository !== plan.repository
    || plan.verificationEvidence?.candidate !== plan.candidate) throw Error('Build provenance contract mismatch');
  for (const row of plan.matrix) {
    const spec = components[row.name];
    if (!spec || row.component !== componentNames[row.name] || row.context !== spec.context || row.dockerfile !== spec.dockerfile
      || row.imageRepository !== `ghcr.io/${plan.repository.toLowerCase()}/${row.name}`
      || row.platform !== plan.config.platform || evidenceHash(row.baseImages) !== evidenceHash(rowBaseImages(row.name, plan.config))
      || evidenceHash(row.buildArguments) !== evidenceHash(rowBuildArguments(row.name, plan.config))
      || !exactSHA.test(row.sourceCommit) || !['build', 'reuse'].includes(row.operation)
      || row.operation === 'build' && row.sourceCommit !== plan.candidate
      || row.operation === 'reuse' && !digestRef.test(row.imageDigest)
      || row.inputFingerprint !== componentInputFingerprint({component: row.component, sourceFingerprint: row.sourceFingerprint,
        baseImages: row.baseImages, platform: row.platform, buildArguments: row.buildArguments})) throw Error('Component input contract mismatch');
    const old = plan.previousManifest?.components[row.component];
    if (row.operation === 'reuse' && (!old || old.imageDigest !== row.imageDigest || old.sourceCommit !== row.sourceCommit
      || old.inputFingerprint !== row.inputFingerprint)) throw Error('Reused component does not match successful baseline');
  }
  return plan;
}

export function assembleCandidateManifest(plan, records, published) {
  validateBuildPlan(plan);
  const components = {};
  for (const row of plan.matrix) {
    const record = validateComponentRecord(plan, row, records[row.component]);
    const imageDigest = row.operation === 'reuse' ? record.imageDigest : published?.[row.component];
    if (!digestRef.test(imageDigest) || imageDigest.split('@')[0] !== row.imageRepository && row.operation !== 'reuse') throw Error('Published immutable component digest required');
    components[row.component] = {sourceCommit: row.sourceCommit, inputFingerprint: row.inputFingerprint, imageDigest};
  }
  const worker = records.rulesWorker.identity;
  const manifest = {schemaVersion: 1, releaseId: `candidate-${plan.candidate.slice(0, 12)}-${plan.planHash.slice(7, 19)}`,
    releaseCommit: plan.candidate, previousReleaseId: plan.previousManifest?.releaseId ?? null, createdAt: new Date().toISOString(), components,
    rulesArtifactHash: worker.artifactHash, contentManifestHash: plan.config.contentManifestHash,
    apiProtocolVersion: 1, workerProtocolVersion: worker.workerProtocolVersion, workerRuntime: worker.workerRuntime,
    supportedWorldSchemaVersions: worker.supportedWorldSchemaVersions, capabilities: worker.capabilities,
    migrationSet: plan.config.migrationSet, validationEvidence: [{gate: 'core', status: 'passed',
      reportHash: evidenceHash(plan.verificationEvidence), inputFingerprint: `sha256:${'0'.repeat(64)}`, completedAt: new Date().toISOString()}]};
  validateManifest(manifest);
  const fingerprint = compositionFingerprint(manifest);
  const coreReport = {status: 'passed', compositionFingerprint: fingerprint, ci: plan.verification,
    sourceVerification: plan.verificationEvidence, imageRecordsHash: evidenceHash(records)};
  manifest.validationEvidence[0].reportHash = evidenceHash(coreReport);
  manifest.validationEvidence[0].inputFingerprint = fingerprint;
  const provenance={schemaVersion:1,releaseRunId:plan.releaseRunId,controlCommit:plan.controlCommit,sourceCommit:plan.candidate,planHash:plan.planHash,manifestHash:evidenceHash(manifest),...recoveryFields(plan.firstAdoptionRecovery)};
  return {status: 'candidate-only', deployable: false, manifest, provenance, reports: {core: coreReport},
    missingGates: ['full-candidate-health', 'image-contract', 'complete-historical-inventory', 'pinned-artifacts']};
}

async function githubRun(runId, repository, candidate, kind) {
  if (!/^[1-9]\d*$/.test(runId) || !/^[\w.-]+\/[\w.-]+$/.test(repository)) throw Error('Invalid GitHub identity');
  if (!process.env.GITHUB_TOKEN) throw Error('Read-only GitHub token required');
  const get = async route => {
    const response = await fetch(`https://api.github.com/repos/${repository}/${route}`, {headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'}, signal: AbortSignal.timeout(15000)});
    if (!response.ok) throw Error(`GitHub metadata unavailable (${response.status})`);
    return response.json();
  };
  const run = verifyRun(await get(`actions/runs/${runId}`), {repository, candidate, kind});
  if (kind === 'deployment') {
    const latest = await selectLatestDeployedRun(get, {repository});
    if (latest?.id !== run.id || latest.controlCommit !== run.controlCommit) throw Error('Baseline must be the latest successful deployed manifest');
  }
  return run;
}
function save(file, value) {mkdirSync(path.dirname(file), {recursive: true}); writeFileSync(file, JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === 'verify-run') {
    const [runId, repository, candidate, kind, output] = args;
    save(output, await githubRun(runId, repository, candidate === '-' ? undefined : candidate, kind));
  } else if (mode === 'plan') {
    const [repo, candidate, repository, configFile, verificationFile, reportFile, baselineDirectory, output, requestFile] = args;
    const baselineFile = path.join(baselineDirectory, 'manifest.json');
    if (existsSync(baselineFile) !== existsSync(path.join(path.dirname(baselineDirectory), 'verified-baseline-run.json'))) throw Error('Verified baseline artifact is missing or incomplete');
    const plan = prepareBuildPlan({repo, candidate, repository, controlCommit:process.env.GITHUB_SHA,releaseRunId:Number(process.env.GITHUB_RUN_ID),config: read(configFile), ...recoveryFields(requestFile?read(requestFile).firstAdoptionRecovery:undefined), verification: read(verificationFile), suiteReport: read(reportFile),
      ...(existsSync(baselineFile) ? {baselineFile, baseline: read(baselineFile), baselineReceipt: read(path.join(baselineDirectory, 'deployment.json')), baselineRun: read(path.join(path.dirname(baselineDirectory), 'verified-baseline-run.json'))} : {})});
    save(output, plan);
    process.stdout.write(`matrix=${JSON.stringify({include: plan.matrix.map(row => ({name: row.name}))})}\nbuildkit_image=${plan.config.buildkitImage}\n`);
  } else throw Error('Expected verify-run or plan command');
}
