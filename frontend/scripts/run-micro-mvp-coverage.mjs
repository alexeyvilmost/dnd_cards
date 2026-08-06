import { randomUUID, createHash } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(scriptDirectory, '..');
const descriptorPath = resolve(frontendRoot, 'micro-mvp-evidence.config.json');
const descriptorSource = await readFile(descriptorPath, 'utf8');
const descriptor = JSON.parse(descriptorSource);
if (descriptor.manifestRelativePath !== '.micro-mvp-evidence/execution-manifest.json') {
  throw new Error('Refusing to remove an unexpected evidence manifest target');
}
const manifestPath = resolve(frontendRoot, descriptor.manifestRelativePath);
const vitestEntry = resolve(frontendRoot, 'node_modules/vitest/vitest.mjs');
const runId = randomUUID();
const startedAt = new Date().toISOString();
const configHasher = createHash('sha256');
for (const relativePath of descriptor.hashInputs) {
  const source = await readFile(resolve(frontendRoot, relativePath));
  configHasher.update(relativePath).update('\0').update(String(source.byteLength)).update('\0').update(source);
}
const configHash = `sha256:${configHasher.digest('hex')}`;
const childEnvironment = {
  ...process.env,
  MICRO_MVP_EVIDENCE_CONFIG_HASH: configHash,
  MICRO_MVP_EVIDENCE_MANIFEST_PATH: manifestPath,
  MICRO_MVP_EVIDENCE_RUN_ID: runId,
  MICRO_MVP_EVIDENCE_RUN_STARTED_AT: startedAt,
};

async function removeStaleManifest() {
  try {
    await unlink(manifestPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

function runVitest(configFile) {
  return new Promise((resolveExitCode, reject) => {
    const child = spawn(process.execPath, [vitestEntry, 'run', '--config', configFile], {
      cwd: frontendRoot,
      env: childEnvironment,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) {
        process.stderr.write(`Vitest was terminated by signal ${signal}.\n`);
        resolveExitCode(1);
        return;
      }
      resolveExitCode(code ?? 1);
    });
  });
}

await removeStaleManifest();
const collectionExitCode = await runVitest('vitest.micro-coverage.config.ts');
if (collectionExitCode !== 0) {
  process.exitCode = collectionExitCode;
} else {
  const gateExitCode = await runVitest(descriptor.gateConfig);
  if (gateExitCode !== 0) process.exitCode = gateExitCode;
}
