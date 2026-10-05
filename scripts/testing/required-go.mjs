import path from 'node:path';
import {assertRequiredGoResults, assertTestDsn} from './guards.mjs';
import {execute, repositoryRoot, resolveTool} from './runtime.mjs';

export async function runRequiredGo(stack, {tests, packagePath = '.', go = process.env.TEST_GO} = {}) {
  if (!Array.isArray(tests) || !tests.length || tests.some(name => !/^Test[A-Za-z0-9_]+$/.test(name))) throw new Error('A nonempty exact Go test selection is required');
  if (!/^\.(?:\/[A-Za-z0-9_-]+)*$/.test(packagePath)) throw new Error('Expected a local Go package path');
  assertTestDsn(stack.env.CANONICAL_RUNTIME_TEST_DSN, stack.registry);
  assertTestDsn(stack.env.CONTENT_MIGRATION_TEST_DSN, stack.registry);
  const marker = (await stack.database.query('SELECT run_id FROM test_run_ownership;')).trim();
  if (marker !== stack.registry.runId) throw new Error('PostgreSQL ownership marker is missing');
  const race=stack.env.TEST_GO_RACE==='1';
  if(race&&process.platform!=='linux')throw Error('The supported Go race profile requires Linux');
  const output = await execute(resolveTool('go', go), ['test', packagePath, ...(race?['-race']:[]), '-json', '-count=1', '-run', `^(${tests.join('|')})$`], {
    cwd: path.join(repositoryRoot, 'backend'), env: stack.env, log: path.join(stack.registry.directory, 'required-go.jsonl'), signal: stack.signal, timeout:race?900_000:300_000,
  });
  return assertRequiredGoResults(output, tests);
}
