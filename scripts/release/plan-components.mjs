import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync, mkdirSync, appendFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const manifestFile = fileURLToPath(new URL('./component-dependencies.json', import.meta.url));
const exactSHA = /^[a-f0-9]{40}$/;

export function readDependencyManifest(file = manifestFile) {
  const manifest = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  if (manifest.schema_version !== 1 || !Array.isArray(manifest.components) || !manifest.components.length
      || new Set(manifest.components).size !== manifest.components.length || !Array.isArray(manifest.rules)) {
    throw Error('Invalid component dependency manifest');
  }
  for (const rule of [...manifest.rules, {id: 'fallback', patterns: ['**'], components: manifest.fallback_components}]) {
    if (!rule.id || !Array.isArray(rule.patterns) || !rule.patterns.length || !Array.isArray(rule.components)
        || rule.patterns.some(pattern => typeof pattern !== 'string' || !pattern)
        || rule.components.some(component => !manifest.components.includes(component))) throw Error('Invalid dependency rule');
  }
  if (manifest.components.some(component => !manifest.fallback_components.includes(component))) throw Error('Fallback must include every component');
  if (new Set(manifest.rules.map(rule => rule.id)).size !== manifest.rules.length) throw Error('Dependency rule IDs must be unique');
  return manifest;
}

function normalizePath(file) {
  const normalized = file.replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)
      || normalized.split('/').some(part => part === '..' || part === '.')) throw Error(`Invalid repository path: ${file}`);
  return normalized;
}

function matches(file, pattern) {
  let expression = '^';
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];
    if (char === '*' && pattern[index + 1] === '*') {
      index++;
      if (pattern[index + 1] === '/') { expression += '(?:.*/)?'; index++; }
      else expression += '.*';
    } else if (char === '*') expression += '[^/]*';
    else if (char === '?') expression += '[^/]';
    else expression += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`${expression}$`).test(file);
}

export function classifyPath(file, manifest = readDependencyManifest()) {
  const normalized = normalizePath(file);
  const rule = manifest.rules.find(candidate => candidate.patterns.some(pattern => matches(normalized, pattern)));
  return {path: normalized, rule: rule?.id || 'unknown-safe-fallback', components: rule?.components || manifest.fallback_components};
}

export function assertWorkerInputsCovered(inputs, manifest = readDependencyManifest()) {
  const uncovered = inputs.map(file => classifyPath(file, manifest)).filter(result => !result.components.includes('worker'));
  if (uncovered.length) throw Error(`Worker inputs missing worker dependency: ${uncovered.map(item => `${item.path} (${item.rule})`).join(', ')}`);
}

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], {encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']});
}

function resolveCommit(repo, ref) {
  if (!ref || ref.startsWith('-')) throw Error('Commit reference is required');
  const sha = git(repo, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).trim();
  if (!exactSHA.test(sha)) throw Error('Expected SHA-1 repository commit');
  return sha;
}

// --no-renames deliberately reports both old and new paths. A move across a
// component boundary must check both consumers, not only the destination.
function diffPaths(repo, args, source) {
  const fields = git(repo, ['diff', '--name-status', '-z', '--no-renames', '--diff-filter=ACDMRTUXB', ...args, '--']).split('\0');
  const changes = [];
  for (let index = 0; index < fields.length - 1; index += 2) {
    const status = fields[index];
    const file = fields[index + 1];
    if (!status || !file) throw Error('Malformed Git diff output');
    changes.push({path: normalizePath(file), status, source});
  }
  return changes;
}

export function createPlan({repo = process.cwd(), mode = 'local', base, candidate = 'HEAD', deployedManifest,
  full = false, workerInputs, dependencyManifest = readDependencyManifest()} = {}) {
  if (!['local', 'ci', 'deploy'].includes(mode)) throw Error(`Unknown planning mode: ${mode}`);
  const candidateSHA = resolveCommit(repo, candidate);
  if (mode === 'local' && resolveCommit(repo, 'HEAD') !== candidateSHA) throw Error('Local candidate must match HEAD before including worktree changes');
  const warnings = [];
  let baselineSHA = null;
  let baselineSource = base ? 'explicit-base' : 'unavailable';
  if (mode === 'deploy') {
    if (base) throw Error('Deploy baseline must come from the last successful deployed manifest, not --base');
    if (!deployedManifest) throw Error('Deploy requires --deployed-manifest from the last successful deployment');
    if (!exactSHA.test(candidate)) throw Error('Deploy candidate must be an exact 40-character SHA');
    const deployed = JSON.parse(readFileSync(deployedManifest, 'utf8').replace(/^\uFEFF/, ''));
    const identityKeys = ['releaseCommit', 'release_sha', 'source_commit'].filter(key => Object.hasOwn(deployed, key));
    if (identityKeys.length !== 1) throw Error('Deployed manifest needs one unambiguous releaseCommit (or legacy release_sha/source_commit)');
    const identityKey = identityKeys[0];
    const deployedSHA = deployed[identityKey];
    if (!exactSHA.test(deployedSHA || '')) throw Error('Deployed manifest needs an exact release commit SHA');
    if (Object.hasOwn(deployed, 'deploymentStatus') && Object.hasOwn(deployed, 'deployment_status')) throw Error('Ambiguous deployment status');
    const deploymentStatus = deployed.deploymentStatus ?? deployed.deployment_status;
    if (deploymentStatus && deploymentStatus !== 'succeeded') throw Error('Manifest is not a successful deployment');
    baselineSHA = resolveCommit(repo, deployedSHA);
    baselineSource = identityKey === 'releaseCommit' ? 'deployed-manifest' : `legacy-deployed-manifest:${identityKey}`;
    if (git(repo, ['status', '--porcelain', '--untracked-files=no']).trim()) {
      throw Error('Deploy planning requires a clean tracked checkout of the candidate');
    }
    if (resolveCommit(repo, 'HEAD') !== candidateSHA) throw Error('Deploy checkout HEAD must equal candidate SHA');
  } else if (base && !/^0+$/.test(base)) {
    try { baselineSHA = resolveCommit(repo, base); }
    catch { warnings.push('Baseline is unavailable locally; selecting all components. Fetch it before narrowing checks.'); }
  } else {
    warnings.push('No explicit baseline; selecting all components. Supply --base for a focused local/CI plan.');
  }
  const changes = baselineSHA ? diffPaths(repo, [baselineSHA, candidateSHA], 'committed') : [];
  if (mode === 'local') {
    changes.push(...diffPaths(repo, ['--cached'], 'staged'), ...diffPaths(repo, [], 'unstaged'));
    for (const file of git(repo, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean)) {
      changes.push({path: normalizePath(file), status: '?', source: 'untracked'});
    }
  }
  const graph = workerInputs ? JSON.parse(readFileSync(workerInputs, 'utf8')) : null;
  if (graph && (graph.schema_version !== 1 || !Array.isArray(graph.inputs))) throw Error('Invalid worker input evidence');
  const graphPaths = new Set((graph?.inputs || []).map(normalizePath));
  const changedFiles = [...new Set(changes.map(change => change.path))].sort();
  const reasons = changedFiles.map(file => {
    const matched = classifyPath(file, dependencyManifest);
    const components = new Set(matched.components);
    if (graphPaths.has(file)) components.add('worker');
    return {...matched, components: [...components], worker_graph_input: graphPaths.has(file)};
  });
  const forceAll = full || !baselineSHA;
  const selected = new Set(forceAll ? dependencyManifest.fallback_components : reasons.flatMap(reason => reason.components));
  const components = Object.fromEntries(dependencyManifest.components.map(component => [component, selected.has(component)]));
  return {
    schema_version: 1, mode, baseline: {sha: baselineSHA, source: baselineSource}, candidate: {sha: candidateSHA},
    full_fallback: forceAll, full_reason: full ? 'explicit-full' : !baselineSHA ? 'missing-baseline' : null,
    components, changed_files: changedFiles, changes, reasons, warnings,
    worker_graph: graph ? {provided: true, source_sha: graph.source_sha || null, additive_only: true} : {provided: false},
  };
}

function parseArguments(argv) {
  const options = {};
  const names = {'--repo': 'repo', '--mode': 'mode', '--base': 'base', '--candidate': 'candidate',
    '--deployed-manifest': 'deployedManifest', '--worker-inputs': 'workerInputs', '--output': 'output', '--github-output': 'githubOutput'};
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--full') { options.full = true; continue; }
    const name = names[argv[index]];
    if (!name || !argv[index + 1] || argv[index + 1].startsWith('--')) throw Error(`Unknown or incomplete argument: ${argv[index]}`);
    options[name] = argv[++index];
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const plan = createPlan(options);
    const json = `${JSON.stringify(plan, null, 2)}\n`;
    if (options.output) { mkdirSync(path.dirname(options.output), {recursive: true}); writeFileSync(options.output, json); }
    if (options.githubOutput) appendFileSync(options.githubOutput, Object.entries(plan.components).map(([name, selected]) => `${name}=${selected}\n`).join(''));
    process.stdout.write(json);
  } catch (error) {
    process.stderr.write(`Component planning failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
