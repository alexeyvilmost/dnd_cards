#!/usr/bin/env node
// Configuration validation only. Does not start containers or claim readiness.
import {randomBytes, randomUUID} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {repositoryRoot, runsRoot, cleanEnvironment, execute, resolveTool, freePort} from './runtime.mjs';
import {assertOwnedPath} from './guards.mjs';

const runId = `test_${randomBytes(12).toString('hex')}`;
const directory = assertOwnedPath(runsRoot, path.join(runsRoot, runId));
await mkdir(directory, {recursive: true});
const emptyEnvironment = path.join(directory, 'empty.env');
await writeFile(emptyEnvironment, '# Intentionally empty; never read an application .env\n');
const fallback = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs/DockerDesktop/resources/bin/docker.exe');
const executable = resolveTool('docker', process.env.TEST_DOCKER ?? (fallback && existsSync(fallback) ? fallback : undefined));
const env = cleanEnvironment({TEST_RUN_ID: runId, TEST_DB_PASSWORD: randomBytes(24).toString('hex'), TEST_WORKER_TOKEN: randomBytes(24).toString('hex'),
  TEST_JWT_SECRET: randomBytes(24).toString('hex'), TEST_ADMIN_ID: randomUUID(), TEST_BOOTSTRAP_FILE: path.join(repositoryRoot, 'scripts/testing/fixtures/schema.sql')});
for (const service of ['DB', 'WORKER', 'API', 'UI']) env[`TEST_${service}_PORT`] = String(await freePort());
await execute(executable, ['compose', '--env-file', emptyEnvironment, '-f', path.join(repositoryRoot, 'infra/compose.test.yml'), 'config', '--quiet'], {env, log: path.join(directory, 'compose-config.log')});
console.log('PASS: isolated Compose configuration resolves without application .env; container runtime not tested.');
