import {readFileSync, realpathSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {assertRunId, assertOwnedPath} from './guards.mjs';
import {runsRoot, repositoryRoot} from './runtime.mjs';

// Standalone worker tests retain the ordinary distribution. Shards can select
// only the private distribution belonging to their live, runner-owned stack.
export function workerTestBuild(environment = process.env) {
  if (!environment.TEST_WORKER_BUILD_DIRECTORY) return pathToFileURL(path.join(repositoryRoot, 'frontend/worker/dist/'));
  const runId = assertRunId(environment.TEST_RUN_ID);
  const directory = assertOwnedPath(runsRoot, environment.TEST_RUN_DIRECTORY);
  if (path.basename(directory) !== runId || realpathSync(directory) !== directory) throw Error('Worker build ownership mismatch');
  const registry = JSON.parse(readFileSync(path.join(directory, 'registry.json'), 'utf8'));
  const expected = path.join(directory, 'worker-build');
  if (registry.runId !== runId || registry.status !== 'ready' || registry.directory !== directory
    || path.resolve(environment.TEST_WORKER_BUILD_DIRECTORY) !== expected || realpathSync(expected) !== expected) throw Error('Worker build does not belong to this ready stack');
  return pathToFileURL(expected + path.sep);
}
