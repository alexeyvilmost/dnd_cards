#!/usr/bin/env node
// Source estimates and repeatable local build measurements. No deploy/push/prune.
import {createHash, randomUUID} from 'node:crypto';
import {execFileSync, spawnSync} from 'node:child_process';
import {copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const components = {
  backend: {context: 'backend', dockerfile: 'backend/Dockerfile', ignore: 'backend/.dockerignore'},
  frontend: {context: '.', dockerfile: 'frontend/Dockerfile', ignore: 'frontend/Dockerfile.dockerignore'},
  worker: {context: '.', dockerfile: 'infra/Dockerfile.rules-worker', ignore: 'infra/Dockerfile.rules-worker.dockerignore'},
};
const portable = value => value.replaceAll('\\', '/');
const sha = value => createHash('sha256').update(value).digest('hex');
const forbidden = /(^|\/)(?:\.git|\.env(?:\.[^/]*)?|node_modules|dist|tmp|outputs?|backups|\.local-postgres)(\/|$)/;

export function glob(pattern) {
  if (/[\[\]\\]/.test(pattern)) throw Error(`Unsupported ignore syntax; update scanner before relying on estimates: ${pattern}`);
  let expression = '^';
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === '*' && pattern[i + 1] === '*') {
      i++;
      if (pattern[i + 1] === '/') { i++; expression += '(?:.*/)?'; } else expression += '.*';
    } else if (pattern[i] === '*') expression += '[^/]*';
    else if (pattern[i] === '?') expression += '[^/]';
    else expression += pattern[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`${expression}$`);
}

export function ignorePolicy(text) {
  const rules = text.replace(/^\uFEFF/, '').split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#')).map(line => {
    const include = line.startsWith('!');
    const pattern = (include ? line.slice(1) : line).replace(/^\/+|\/+$/g, '');
    if (!pattern || pattern.split('/').includes('..')) throw Error('Invalid ignore pattern');
    return {include, pattern, regex: glob(pattern), prefix: pattern.split(/[?*]/)[0]};
  });
  return {
    includes(file) {
      const parts = portable(file).split('/');
      const ancestors = parts.map((_, i) => parts.slice(0, i + 1).join('/'));
      let included = true;
      for (const rule of rules) if (ancestors.some(item => rule.regex.test(item))) included = rule.include;
      return included;
    },
    descend(directory) {
      if (this.includes(directory)) return true;
      const prefix = `${directory}/`;
      return rules.some(rule => rule.include && (rule.prefix.startsWith(prefix) || prefix.startsWith(rule.prefix)));
    },
  };
}

export function inventory(root, policy) {
  const files = [];
  function visit(directory, prefix = '') {
    for (const item of readdirSync(directory, {withFileTypes: true})) {
      const relative = prefix + item.name;
      const absolute = path.join(directory, item.name);
      if (item.isSymbolicLink()) {
        if (policy.includes(relative) || policy.descend(relative)) throw Error(`Symlink not allowed in measured source: ${relative}`);
      } else if (item.isDirectory()) {
        if (forbidden.test(relative)) {
          if (policy.includes(relative)) throw Error(`Unsafe context directory: ${relative}`);
        } else if (policy.descend(relative)) visit(absolute, `${relative}/`);
      } else if (item.isFile() && policy.includes(relative)) {
        if (forbidden.test(relative)) throw Error(`Unsafe context input: ${relative}`);
        const bytes = readFileSync(absolute);
        files.push({path: relative, bytes: bytes.length, sha256: sha(bytes)});
      }
    }
  }
  visit(root);
  return files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
}

export function copyInputs(dockerfile, files) {
  const instructions = [];
  let stage = '';
  for (const [index, line] of dockerfile.replace(/\\\r?\n\s*/g, ' ').split(/\r?\n/).entries()) {
    if (/^FROM /i.test(line)) { stage = line.split(/\s+/).at(-1); continue; }
    if (!/^COPY /i.test(line) || /--from=/.test(line)) continue;
    const tokens = line.trim().split(/\s+/).slice(1).filter(token => !token.startsWith('--'));
    if (tokens.some(token => /["'\[\]$]/.test(token))) throw Error('Scanner supports literal unquoted COPY sources only');
    const sources = tokens.slice(0, -1);
    if (!sources.length || sources.some(source => source.startsWith('/') || source.split('/').includes('..'))) throw Error('Unsafe COPY source');
    const selected = new Map();
    for (const source of sources) {
      const normalized = source.replace(/^\.\//, '').replace(/\/$/, '');
      const matcher = glob(normalized);
      const matches = files.filter(file => normalized === '.' || matcher.test(file.path) || file.path.startsWith(`${normalized}/`));
      if (!matches.length) throw Error(`COPY input missing from clean context at line ${index + 1}: ${source}`);
      for (const file of matches) selected.set(file.path, file);
    }
    const inputs = [...selected.values()].sort((a, b) => a.path.localeCompare(b.path, 'en'));
    instructions.push({stage, line: index + 1, sources, destination: tokens.at(-1), files: inputs.map(file => file.path),
      estimated_bytes: inputs.reduce((sum, file) => sum + file.bytes, 0), fingerprint: sha(inputs.map(file => `${file.path}\0${file.sha256}`).join('\n'))});
  }
  return instructions;
}

export function checkEmbeddedInputs(root, files) {
  const paths = new Set(files.map(file => file.path));
  const embeds = [];
  for (const file of files.filter(file => file.path.endsWith('.go'))) {
    const source = readFileSync(path.join(root, file.path), 'utf8');
    for (const match of source.matchAll(/^\/\/go:embed\s+(.+)$/gm)) {
      for (const value of match[1].trim().split(/\s+/)) {
        const pattern = path.posix.join(path.posix.dirname(file.path), value.replace(/^all:/, '').replace(/^"|"$/g, ''));
        const matches = [...paths].filter(candidate => glob(pattern).test(candidate) || candidate.startsWith(`${pattern}/`));
        if (!matches.length) throw Error(`Go embed missing from context: ${file.path} -> ${pattern}`);
        embeds.push({source: file.path, pattern, files: matches});
      }
    }
  }
  return embeds;
}

function git(repo, args) { return execFileSync('git', ['-C', repo, ...args], {encoding: 'utf8', maxBuffer: 32 << 20}); }
function baselineTracked(repo, ref, component) {
  const spec = components[component];
  const oldIgnore = component === 'backend' ? spec.ignore : '.dockerignore';
  const policy = ignorePolicy(git(repo, ['show', `${ref}:${oldIgnore}`]));
  const prefix = spec.context === '.' ? '' : `${spec.context}/`;
  const files = git(repo, ['ls-tree', '-r', '-l', '-z', ref]).split('\0').filter(Boolean).map(line => {
    const [metadata, file] = line.split('\t');
    const bytes = Number(metadata.trim().split(/\s+/).at(-1));
    return {path: file.slice(prefix.length), bytes, belongs: file.startsWith(prefix)};
  }).filter(file => file.belongs && policy.includes(file.path));
  return {ref, policy: oldIgnore, estimated_source_bytes: files.reduce((sum, file) => sum + file.bytes, 0), files: files.length,
    basis: 'committed Git blob sizes with that revision ignore policy; not Docker transferred bytes'};
}

function cleanEnvironment() {
  return Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'COMSPEC', 'PATHEXT'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
}
function execute(executable, args, cwd, timeout = 30_000) {
  const started = performance.now();
  const result = spawnSync(executable, args, {cwd, env: cleanEnvironment(), encoding: 'utf8', windowsHide: true, timeout, maxBuffer: 64 << 20});
  return {status: result.status, duration_ms: Math.round(performance.now() - started), stdout: result.stdout ?? '', stderr: result.stderr ?? '', error: result.error?.code};
}

export function validateImagePins(pins) {
  const allowed = ['GO_IMAGE', 'ALPINE_IMAGE', 'NODE_IMAGE', 'NGINX_IMAGE'];
  if (!pins || Object.keys(pins).some(key => !allowed.includes(key))) throw Error('Only public runtime image pin keys are allowed');
  for (const name of allowed) {
    if (typeof pins[name] !== 'string' || !/^[a-zA-Z0-9._/:@-]+@sha256:[a-f0-9]{64}$/.test(pins[name])) throw Error(`A digest-pinned ${name} is required for repeatable builds`);
  }
  return pins;
}

function dockerChecks(repo, directory, executable) {
  const version = execute(executable, ['--version'], repo);
  if (version.status !== 0) return {status: 'awaiting_environment', reason: 'docker_cli_unavailable'};
  const emptyEnv = path.join(directory, 'empty.env');
  writeFileSync(emptyEnv, '# Deliberately empty; do not load application .env\n');
  const compose = [];
  for (const file of ['docker-compose.yml', 'docker-compose.local.yml', 'docker-compose.prod.yml', 'infra/compose.prod.yml', 'infra/compose.test.yml']) {
    const result = execute(executable, ['compose', '--env-file', emptyEnv, '-f', path.join(repo, file), 'config', '--no-env-resolution', '--no-interpolate', '--format', 'json'], repo);
    if (result.status !== 0) throw Error(`Compose configuration did not parse: ${file}`);
    const config = JSON.parse(result.stdout);
    const builds = Object.entries(config.services).filter(([, service]) => service.build).map(([service, value]) => {
      const build = typeof value.build === 'string' ? {context: value.build, dockerfile: 'Dockerfile'} : value.build;
      const expected = components[service === 'rules-worker' ? 'worker' : service];
      if (expected && (path.resolve(build.context) !== path.resolve(repo, expected.context) || path.resolve(build.context, build.dockerfile) !== path.resolve(repo, expected.dockerfile))) throw Error(`Wrong build context in ${file}:${service}`);
      return {service, context: portable(path.relative(repo, build.context)) || '.', dockerfile: build.dockerfile};
    });
    compose.push({file, status: 'passed_configuration_only', builds});
  }
  const endpoint = execute(executable, ['context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}'], repo);
  if (endpoint.status !== 0 || !/^(?:"npipe:\/\/|"unix:\/\/)/.test(endpoint.stdout.trim())) return {status: 'awaiting_environment', reason: 'local_docker_endpoint_required', version: version.stdout.trim(), compose};
  const info = execute(executable, ['info', '--format', '{{json .ServerVersion}}'], repo, 15_000);
  const localContext = execute(executable, ['context', 'show'], repo).stdout.trim();
  return {status: info.status === 0 ? 'available' : 'awaiting_environment', reason: info.status === 0 ? undefined : 'docker_daemon_unavailable', version: version.stdout.trim(), server: info.status === 0 ? JSON.parse(info.stdout) : null, local_context: localContext, compose};
}

export async function main(argv = process.argv.slice(2)) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (['--prepare', '--build'].includes(key)) options[key.slice(2)] = true;
    else if (['--repo', '--output', '--docker', '--baseline', '--images', '--builder', '--platform'].includes(key) && argv[i + 1] && !argv[i + 1].startsWith('--')) options[key.slice(2)] = argv[++i];
    else throw Error(`Unknown or incomplete argument: ${key}`);
  }
  const repo = path.resolve(options.repo ?? fileURLToPath(new URL('../..', import.meta.url)));
  const runID = `rel02-${randomUUID()}`;
  const directory = path.resolve(options.output ?? path.join(repo, 'outputs/release-measure', runID));
  const relative = path.relative(path.join(repo, 'outputs/release-measure'), directory);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || existsSync(directory)) throw Error('Output must be a new child of outputs/release-measure; existing results are never overwritten');
  mkdirSync(directory, {recursive: true});
  const report = {schema_version: 1, run_id: runID, created_at: new Date().toISOString(), git_head: git(repo, ['rev-parse', 'HEAD']).trim(),
    source_basis: 'clean snapshot of currently allowed working-tree inputs, including authorized untracked source; not a committed git archive',
    metric_warning: 'estimated source/context payload bytes; excludes Docker metadata/tar/protocol overhead. Actual transfer/cache/timing requires Docker.',
    components: {}, docker: null, builds: null};
  for (const [component, spec] of Object.entries(components)) {
    const root = path.resolve(repo, spec.context);
    const policy = ignorePolicy(readFileSync(path.join(repo, spec.ignore), 'utf8'));
    const files = inventory(root, policy);
    const dockerfile = readFileSync(path.join(repo, spec.dockerfile), 'utf8');
    const copies = copyInputs(dockerfile, files);
    const embeds = component === 'backend' ? checkEmbeddedInputs(root, files) : [];
    const snapshot = path.join(directory, 'source', component);
    if (options.prepare || options.build) {
      for (const file of files) {
        const target = path.join(snapshot, file.path);
        mkdirSync(path.dirname(target), {recursive: true}); copyFileSync(path.join(root, file.path), target);
        if (sha(readFileSync(target)) !== file.sha256) throw Error(`Source changed while preparing snapshot: ${file.path}; rerun into a new output directory`);
      }
      // Context policy itself is needed when BuildKit re-reads the snapshot.
      const ignoreDestination = path.join(snapshot, path.relative(root, path.join(repo, spec.ignore)));
      mkdirSync(path.dirname(ignoreDestination), {recursive: true}); copyFileSync(path.join(repo, spec.ignore), ignoreDestination);
    }
    report.components[component] = {context: spec.context, dockerfile: spec.dockerfile, ignore: spec.ignore,
      estimated_source_bytes: files.reduce((sum, file) => sum + file.bytes, 0), file_count: files.length,
      source_fingerprint: sha(files.map(file => `${file.path}\0${file.sha256}`).join('\n')), files, copies, embeds,
      baseline_tracked: baselineTracked(repo, options.baseline ?? 'HEAD', component), snapshot: options.prepare || options.build ? snapshot : null};
  }
  const docker = options.docker ?? (process.platform === 'win32' && process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs/DockerDesktop/resources/bin/docker.exe') : 'docker');
  report.docker = dockerChecks(repo, directory, docker);
  // Preserve source/configuration evidence even if a requested benchmark later
  // fails its builder/image-pin preflight.
  writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  if (options.build && report.docker.status === 'available') {
    if (!options.images || !options.builder) throw Error('--build requires --images digest manifest and --builder dedicated local Buildx builder');
    const builder = execute(docker, ['buildx', 'inspect', options.builder], repo);
    const endpoints = [...builder.stdout.matchAll(/^Endpoint:\s+(\S+)\s*$/gm)].map(match => match[1]);
    if (builder.status !== 0 || !/^Driver:\s+docker(?:-container)?\s*$/m.test(builder.stdout) || !endpoints.length
        || endpoints.some(endpoint => endpoint !== report.docker.local_context && !/^(?:npipe|unix):\/\//.test(endpoint))) throw Error('Benchmark requires a Docker-backed builder with only local endpoints');
    const pins = validateImagePins(JSON.parse(readFileSync(options.images, 'utf8')));
    report.builds = [];
    report.image_pins = pins;
    report.platform = options.platform ?? 'linux/amd64';
    for (const [component, spec] of Object.entries(components)) {
      const snapshot = report.components[component].snapshot;
      const cacheScope = `${runID}-${component}`;
      const imageTag = `bagofholding-rel02:${runID}-${component}`;
      for (const mode of ['cold', 'warm-1', 'warm-2']) {
        const args = ['buildx', 'build', '--builder', options.builder, '--load', '--progress=plain', '--platform', report.platform, '-t', imageTag,
          '-f', path.join(snapshot, path.relative(path.resolve(repo, spec.context), path.join(repo, spec.dockerfile))), '--build-arg', `BUILD_CACHE_SCOPE=${cacheScope}`];
        for (const [key, value] of Object.entries(pins)) args.push('--build-arg', `${key}=${value}`);
        if (mode === 'cold') args.push('--no-cache');
        args.push(snapshot);
        const result = execute(docker, args, repo, 1_800_000);
        const log = `${component}-${mode}.log`;
        writeFileSync(path.join(directory, log), result.stdout + result.stderr);
        const image = result.status === 0 ? execute(docker, ['image', 'inspect', imageTag, '--format', '{{json .}}'], repo) : null;
        const imageInfo = image?.status === 0 ? JSON.parse(image.stdout) : null;
        report.builds.push({component, mode, status: result.status === 0 ? 'passed' : 'failed', duration_ms: result.duration_ms,
          cached_steps: (result.stderr.match(/^#\d+ CACHED$/gm) ?? []).length, image_id: imageInfo?.Id ?? null, image_bytes: imageInfo?.Size ?? null, log});
        writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
        if (result.status !== 0) throw Error(`Docker ${component} ${mode} failed; see ${log}`);
      }
    }
  }
  writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({report: path.join(directory, 'report.json'), docker: report.docker.status,
    components: Object.fromEntries(Object.entries(report.components).map(([key, item]) => [key, {estimated_source_bytes: item.estimated_source_bytes, files: item.file_count}]))}, null, 2));
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
