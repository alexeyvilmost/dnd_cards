// Compatibility entry point for the former local acceptance script. Browser
// contracts now run against production assets with the shared owned fixtures;
// the pure mastery compiler contract remains a separately reported unit layer.
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {localAcceptanceContext} from '../testing/acceptance-context.mjs';
import {execute, repositoryRoot} from '../testing/runtime.mjs';

const local = await localAcceptanceContext();
const templatesFile = path.join(local.output, 'templates.json');
let access;
try {access = JSON.parse(await readFile(templatesFile, 'utf8'));}
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  await import('./templates-local-acceptance.mjs');
  access = JSON.parse(await readFile(templatesFile, 'utf8'));
}
assert.equal(access.runId, local.registry.runId, 'Template fixture belongs to another run');
await execute(process.execPath, ['frontend/node_modules/@playwright/test/cli.js', 'test', '--config=frontend/playwright.local.config.ts'], {
  env: process.env, log: path.join(local.output, 'polish-browser.log'), timeout: 600_000,
});
const browser = JSON.parse(await readFile(path.join(local.output, 'playwright.json'), 'utf8'));
assert(browser.stats.expected > 0 && browser.stats.unexpected === 0 && browser.stats.flaky === 0 && browser.stats.skipped === 0,
  'Real browser contracts must all pass without retries/skips');
const masteryReport = path.join(local.output, 'polish-mastery-unit.json');
await execute(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'src/engine/weaponMastery2024.test.ts', '--reporter=json', `--outputFile=${masteryReport}`], {
  cwd: path.join(repositoryRoot, 'frontend'), env: process.env, log: path.join(local.output, 'polish-mastery-unit.log'), timeout: 120_000,
});
const mastery = JSON.parse(await readFile(masteryReport, 'utf8'));
assert(mastery.numPassedTests > 0 && mastery.numFailedTests === 0 && mastery.numPendingTests === 0, 'Generic mastery contracts must pass');
await writeFile(path.join(local.output, 'polish.json'), JSON.stringify({
  runId: local.registry.runId, passed: true,
  browser: {passed: browser.stats.expected, report: 'playwright.json'},
  pureUnit: {passed: mastery.numPassedTests, report: 'polish-mastery-unit.json'},
  contracts: {
    coldModalContrastAndAdminRights: 'S09: actual UI and permissions, contrast ratio instead of obsolete exact palette',
    persistedInfluence: 'S05: real worker/DB, reload, canonical row/preview, one cost/ammunition, lost response retry',
    slow: 'Separate pure compiler unit: exact authored penalty, paid choice, requires damage; second declarations covered. Not claimed as a second full-stack battle.',
  },
}, null, 2));
console.log(`PASS real local browser contracts (${browser.stats.expected}) and separately reported mastery unit contracts (${mastery.numPassedTests})`);
