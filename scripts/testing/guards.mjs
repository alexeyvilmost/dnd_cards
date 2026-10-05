import path from 'node:path';
import {lstat, realpath} from 'node:fs/promises';

export const RUN_ID = /^test_[a-f0-9]{24}$/;
export function assertRunId(id) {
  if (!RUN_ID.test(id ?? '')) throw new Error('A runner-issued test_<24 hex> ID is required');
  return id;
}
export function assertLocalOrigin(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !url.port) {
    throw new Error('Expected an explicit loopback HTTP origin with a port');
  }
  return url.origin;
}
export function assertTestDsn(value, registry) {
  if (!value) throw new Error('Required PostgreSQL DSN is missing');
  assertRunId(registry?.runId);
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1'
    || Number(url.port) !== registry.ports.database || url.pathname !== `/${registry.runId}`
    || url.username !== 'test_runner' || url.hash || [...url.searchParams.keys()].some(key => key !== 'sslmode')
    || url.searchParams.getAll('sslmode').length !== 1 || url.searchParams.get('sslmode') !== 'disable') {
    throw new Error('DSN does not belong to this disposable test run');
  }
  return value;
}
export function assertOwnedPath(root, target) {
  const absoluteRoot = path.resolve(root), absoluteTarget = path.resolve(target);
  const relative = path.relative(absoluteRoot, absoluteTarget);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error('Refusing a path outside the owned test directory');
  }
  return absoluteTarget;
}
export async function assertRealOwnedPath(root, target) {
  assertOwnedPath(root, target);
  if ((await lstat(target)).isSymbolicLink()) throw new Error('Refusing a symlink test directory');
  return assertOwnedPath(await realpath(root), await realpath(target));
}
export async function localFetch(origin, resource, options = {}) {
  const expected = assertLocalOrigin(origin);
  const url = new URL(resource, `${expected}/`);
  if (url.origin !== expected) throw new Error('Request escaped the local test origin');
  const response = await fetch(url, {...options, redirect: 'error', signal: options.signal ?? AbortSignal.timeout(15_000)});
  if (new URL(response.url).origin !== expected) throw new Error('Response escaped the local test origin');
  return response;
}
export function assertRequiredGoResults(output, requiredTests) {
  if (!Array.isArray(requiredTests) || requiredTests.length === 0) throw new Error('Required Go test selection is empty');
  const terminal = new Map();
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event.Test && ['pass', 'fail', 'skip'].includes(event.Action)) terminal.set(event.Test, event.Action);
  }
  const missing = requiredTests.filter(name => terminal.get(name) !== 'pass');
  for (const [name, action] of terminal) {
    if (action !== 'pass' && requiredTests.some(required => name.startsWith(`${required}/`))) missing.push(name);
  }
  if (missing.length) throw new Error(`Required PostgreSQL tests did not pass (missing/skipped/failed): ${missing.join(', ')}`);
  return {required: requiredTests.length, passed: requiredTests.length};
}
