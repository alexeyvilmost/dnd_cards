import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {startTestStack} from './stack.mjs';
import {execute, repositoryRoot} from './runtime.mjs';
import {verifyPlaywrightResult} from './suites.mjs';

const mode=process.argv[2]??'all';
if(!['all','--maps-only','--fixtures-only'].includes(mode)||process.argv.length>3)throw Error('Usage: check-media-real.mjs [--maps-only|--fixtures-only]');
const stack = await startTestStack({profile: 'integration', reuseBuild: true});
const evidence = {runId: stack.registry.runId, uiBuild: stack.registry.uiBuild, fixture: stack.registry.fixture.profile};
const output = path.join(stack.registry.directory, 'acceptance', 'media-real.json');
try {
  console.log(JSON.stringify({snapshotReady: true, ...evidence}));
  if(mode==='all') {
    const files = ['access', 'combat', 'forge', 'main-flows'].map(name => `frontend/e2e-local/${name}.spec.ts`);
    await execute(process.execPath, ['frontend/node_modules/@playwright/test/cli.js', 'test', '--config=frontend/playwright.local.config.ts', ...files], {
      cwd: repositoryRoot, env: stack.env, log: path.join(stack.registry.directory, 'media-main-flows.log'), timeout: 1_200_000, signal: stack.signal,
    });
    evidence.mainFlows = verifyPlaywrightResult(JSON.parse(await readFile(path.join(stack.registry.directory, 'acceptance/playwright.json'), 'utf8')), files);
  } else evidence.mainFlows={status:'not_run',reason:'Explicit focused diagnostic; see separate whole browser receipt'};
  // The visual proof uses this same owned build and the canonical API fixture.
  const {checkMediaMap,checkExtendedMediaBrowser} = await import(pathToFileURL(path.join(repositoryRoot, 'scripts/testing/media-map-scenario.mjs')).href);
  if(mode!=='--fixtures-only')evidence.map = await checkMediaMap(stack);
  if(mode!=='--maps-only')evidence.extendedBrowser = await checkExtendedMediaBrowser(stack);
  evidence.status = 'passed';
} catch (error) {
  evidence.status = 'failed'; evidence.error = error.message;
  throw error;
} finally {
  await stack.cleanup(); evidence.cleanup = stack.registry.status;
  await writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({status: evidence.status, output, cleanup: evidence.cleanup, error: evidence.error}));
}
