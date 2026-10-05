#!/usr/bin/env node
import assert from 'node:assert/strict';
import {cp, readFile, writeFile, appendFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {startTestStack} from '../testing/stack.mjs';
import {assertRealOwnedPath} from '../testing/guards.mjs';
import {runsRoot} from '../testing/runtime.mjs';
import {verifyBackup} from './backup-manifest.mjs';
import {restoreOwnedSnapshot} from './native-backup.mjs';
export async function runNegativeRestore({source, go, pgBin, output}) {
  await assertRealOwnedPath(runsRoot, source); await verifyBackup(source);
  const report = {status: 'running', checks: [], sourceBackup: path.basename(path.dirname(source))};
  let target;
  try {
    for (const kind of ['missing-artifact', 'corrupt-dump', 'invalid-manifest', 'schema-mismatch']) {
      const directory = path.join(path.dirname(source), `recovery-negative-${kind}`);
      await cp(source, directory, {recursive: true, errorOnExist: true, force: false, filter: file => kind !== 'missing-artifact' || !file.endsWith('.cjs')});
      const file = path.join(directory, 'backup.json'), manifest = JSON.parse(await readFile(file, 'utf8'));
      if (kind === 'corrupt-dump') await appendFile(path.join(directory, manifest.files.find(file => file.category === 'database').path), 'deliberate-owned-negative-fixture');
      if (kind === 'invalid-manifest') {manifest.schemaVersion = 99; await writeFile(file, JSON.stringify(manifest));}
      if (kind === 'schema-mismatch') {
        manifest.schemaFingerprint = `sha256:${'0'.repeat(64)}`; await writeFile(file, JSON.stringify(manifest));
        target = await startTestStack({dbOnly: true, go, pgBin});
        await assert.rejects(restoreOwnedSnapshot(target.database, target.registry, directory), /Restored schema/);
        await target.cleanup(); report.targetRunId = target.registry.runId; report.cleanup = target.registry.status; target = null;
      } else await assert.rejects(verifyBackup(directory));
      report.checks.push({id: kind, status: 'passed'});
    }
    report.status = 'passed';
  } catch (error) {report.status = 'failed'; throw error;}
  finally {if (target) await target.cleanup(); if (output) await writeFile(output, JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});}
  return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {}; for (let i = 2; i < process.argv.length; i += 2) {const key = {'--source': 'source', '--go': 'go', '--pg-bin': 'pgBin', '--output': 'output'}[process.argv[i]]; if (!key || !process.argv[i + 1]) throw Error('Invalid negative drill arguments'); options[key] = process.argv[i + 1];}
  try {await runNegativeRestore(options); console.log('PASS: missing/corrupt artifact/snapshot, invalid manifest and actual restored-schema mismatch rejected.');}
  catch (error) {console.error(`Negative restore drill failed: ${error.message}`); process.exitCode = 1;}
}
