import {readFileSync, existsSync} from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {repositoryRoot} from './runtime.mjs';

export const manifestPath = path.join(repositoryRoot, 'tests/suites.json');
export const hash = value => createHash('sha256').update(value).digest('hex');
export function matches(file, glob) {
  let pattern = '^';
  for (let i = 0; i < glob.length; i++) {
    if (glob[i] === '*' && glob[i + 1] === '*') {
      i++; if (glob[i + 1] === '/') {pattern += '(?:.*/)?'; i++;} else pattern += '.*';
    } else if (glob[i] === '*') pattern += '[^/]*';
    else pattern += glob[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(pattern + '$').test(file);
}
export function readSuites(file = manifestPath) {
  const bytes = readFileSync(file), manifest = JSON.parse(bytes);
  if (manifest.schema_version !== 1 || !Array.isArray(manifest.groups) || !manifest.groups.length) throw Error('Invalid test suite manifest');
  const ids = [...manifest.groups, ...manifest.legacy_manual].map(group => group.id);
  if (ids.some(id => !/^[a-z][a-z0-9-]+$/.test(id)) || new Set(ids).size !== ids.length) throw Error('Suite IDs must be unique');
  for (const group of manifest.groups) {
    if (!['node', 'vitest', 'go', 'script', 'playwright'].includes(group.runner) || group.tier !== 'core' || !group.contract || !group.owner) throw Error(`Invalid suite ${group.id}`);
    if (['node', 'vitest', 'playwright'].includes(group.runner) && (!Array.isArray(group.files) || !group.files.length)) throw Error(`Empty required selector ${group.id}`);
    if (group.runner === 'go' && (!group.package || !group.prefixes?.length || group.prefixes.some(p => !/^Test[A-Za-z0-9_]+$/.test(p)))) throw Error(`Invalid Go selector ${group.id}`);
    for (const relative of [...(group.files ?? []), ...(group.file ? [group.file] : [])]) {
      if (relative.includes('\\') || relative.split('/').includes('..') || path.isAbsolute(relative) || !existsSync(path.join(repositoryRoot, relative))) throw Error(`Missing required test file ${relative}`);
    }
  }
  const goCases = [...manifest.legacy_manual.flatMap(group => group.go_cases ?? []), ...(manifest.dedicated_go_routes ?? [])];
  if (new Set(goCases.map(row=>`${row.package}:${row.test}`)).size !== goCases.length) throw Error('Duplicate explicit manual Go case');
  for (const row of goCases) {
    if (!/^Test[A-Za-z0-9_]+$/.test(row.test) || !row.reason || !row.file?.startsWith('backend/')) throw Error('Invalid manual Go case');
    if (!readFileSync(path.join(repositoryRoot,row.file),'utf8').includes(`func ${row.test}(`)) throw Error(`Missing manual Go case ${row.test}`);
  }
  for (const route of manifest.dedicated_go_routes ?? []) {
    const gate=(manifest.extended_gates??[]).find(gate=>gate.id===route.gate);
    if (route.tier !== 'extended' || !gate || route.script !== gate.script
      || !existsSync(path.join(repositoryRoot, route.script))) throw Error('Invalid dedicated Go route');
  }
  const gateIDs=new Set();
  for(const gate of manifest.extended_gates??[]) {
    if(!/^[a-z][a-z0-9-]+$/.test(gate.id)||gateIDs.has(gate.id)||!/^scripts\/performance\/check-[a-z-]+\.mjs$/.test(gate.script)
      ||!/^check[A-Za-z]+$/.test(gate.export)||!gate.contract||!existsSync(path.join(repositoryRoot,gate.script)))throw Error('Invalid required extended gate');
    gateIDs.add(gate.id);
  }
  return {manifest, hash: hash(bytes)};
}
export function selectGroups(manifest, componentPlan, {suite = 'core', select} = {}) {
  if (!manifest.tiers.includes(suite)) throw Error(`Unknown suite tier ${suite}`);
  if (suite === 'legacy-manual') {
    const group = manifest.legacy_manual.find(group => group.id === select);
    if (!group) throw Error('legacy-manual requires one explicit known --select ID');
    if (['quarantined', 'external-disabled'].includes(group.runner)) throw Error(`Suite ${group.id} is unavailable in the local runner: ${group.reason}`);
    return {selected: [{...group, selection_reason: 'explicit-legacy-diagnostic'}], omitted: []};
  }
  if (select) throw Error('--select is only valid for legacy-manual');
  const hasCode = Object.values(componentPlan.components).some(Boolean);
  const selected = [], omitted = [];
  for (const group of manifest.groups) {
    const reason = group.always ? 'always' : suite === 'extended' ? 'extended-includes-core' : !hasCode ? null
      : group.always_for_code ? 'mandatory-code-invariant'
      : group.components?.some(component => componentPlan.components[component]) ? 'affected-component' : null;
    (reason ? selected : omitted).push({...group, selection_reason: reason ?? (hasCode ? 'unaffected-component' : 'documentation-only')});
  }
  if (!selected.length) throw Error('No mandatory suites selected');
  return {selected, omitted};
}
export function resolveGoTests(names, prefixes) {
  if (!prefixes?.length || prefixes.some(prefix => !/^Test[A-Za-z0-9_]+$/.test(prefix))) throw Error('Empty or invalid Go selector');
  const tests = names.filter(name => /^Test[A-Za-z0-9_]+$/.test(name));
  for (const prefix of prefixes) if (!tests.some(name => name.startsWith(prefix))) throw Error(`Required Go selector matched zero tests: ${prefix}`);
  return [...new Set(tests.filter(name => prefixes.some(prefix => name.startsWith(prefix))))].sort();
}
export function verifyVitestResult(report, files) {
  if (!files?.length || !report.success || !(report.numTotalTests > 0) || report.numFailedTests || report.numPendingTests || report.numTodoTests) throw Error('Required Vitest suite failed, skipped tests or collected zero tests');
  const normalize = file => path.resolve(file).replaceAll('\\', '/').toLowerCase();
  const actual = new Map(report.testResults?.map(result => [normalize(result.name), result]) ?? []);
  for (const file of files) {
    const result = actual.get(normalize(path.join(repositoryRoot, file)));
    if (!result?.assertionResults?.length || result.assertionResults.some(assertion => assertion.status !== 'passed')) throw Error(`Required test file was missing, empty or skipped: ${file}`);
  }
  return {tests: report.numTotalTests, passed: report.numPassedTests, skipped: 0};
}
export function verifyNodeResult(output) {
  const read = name => Number(output.match(new RegExp(`^# ${name} (\\d+)\\s*$`, 'm'))?.[1] ?? NaN);
  const tests = read('tests'), passed = read('pass'), failed = read('fail'), skipped = read('skipped'), cancelled = read('cancelled'), todo = read('todo');
  if (!(tests > 0) || passed !== tests || failed !== 0 || skipped !== 0 || cancelled !== 0 || todo !== 0) throw Error('Required Node suite failed, skipped tests or collected zero tests');
  return {tests, passed, skipped};
}
export function verifyPlaywrightResult(report, files, repo=repositoryRoot) {
  const collected=[];
  const visit=suite=>{
    for(const spec of suite.specs??[]) for(const test of spec.tests??[]) collected.push({file:spec.file??suite.file,test});
    for(const child of suite.suites??[]) visit(child);
  };
  visit(report);
  if (!files.length || !collected.length || report.errors?.length || report.stats?.unexpected || report.stats?.skipped || report.stats?.flaky
    || collected.some(({test})=>test.status!=='expected' || test.expectedStatus!=='passed' || test.results?.length!==1 || test.results[0].status!=='passed')) {
    throw Error('Required browser suite failed, retried, skipped or collected zero tests');
  }
  const normalize=file=>path.resolve(file).replaceAll('\\','/').toLowerCase();
  const actual=new Set(collected.map(({file})=>normalize(path.resolve(report.config.rootDir,file))));
  for(const file of files) if(!actual.has(normalize(path.join(repo,file)))) throw Error(`Required browser file missing: ${file}`);
  return {tests:collected.length,passed:collected.length,skipped:0,projects:report.config.projects.map(project=>project.name)};
}
export function catalogTests(manifest, repo = repositoryRoot) {
  const names = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024}).split('\0');
  const core = new Map(manifest.groups.flatMap(group => (group.files ?? []).map(file => [file, group])));
  return [...new Set(names)].filter(file => /^(frontend|backend|scripts)\//.test(file) && (/(?:\.test\.[cm]?[jt]sx?|\.spec\.[jt]sx?|_test\.go)$/.test(file) || /(?:^|\/)test_[^/]+\.py$/.test(file)))
    .filter(file => existsSync(path.join(repo, file))).sort().map(file => {
      const group = core.get(file), legacy = manifest.legacy_manual.find(row => row.patterns.some(pattern => matches(file, pattern)));
      const runner = file.endsWith('_test.go') ? 'go' : file.endsWith('.py') ? 'python' : /(?:^|\/)e2e(?:-[a-z]+)?\//.test(file) ? 'playwright' : file.endsWith('.mjs') ? 'node' : 'vitest';
      return {file, runner, tier: group ? 'core' : legacy ? 'legacy-manual' : 'extended', suite: group?.id ?? legacy?.id ?? null,
        owner: group?.owner ?? (runner === 'go' ? 'backend' : runner === 'playwright' ? 'product-e2e' : 'module-owner'),
        selection_note: group?.contract ?? legacy?.reason ?? (runner === 'go' ? 'Case-level core selection resolves exact names; all remaining local tests belong to extended' : 'Current local regression; not retired by directory name or age'),
        network: group?.network ?? (legacy?.runner === 'external-disabled' ? 'external-not-authorized' : runner === 'go' ? 'owned-postgresql-and-loopback-http' : runner === 'python' ? 'quarantined' : runner === 'playwright' ? file.startsWith('frontend/e2e-local/') ? 'owned-real-fullstack' : 'owned-preview-and-mocked-api' : 'local-fixtures-or-mocked-transport'),
        manual_cases: manifest.legacy_manual.flatMap(row=>row.go_cases??[]).filter(row=>row.file===file),
        dedicated_cases: (manifest.dedicated_go_routes ?? []).filter(row=>row.file===file), cost: 'measure-on-run'};
    });
}
