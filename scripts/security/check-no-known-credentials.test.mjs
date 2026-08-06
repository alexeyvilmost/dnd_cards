import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync, mkdtempSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const scanner = fileURLToPath(new URL('./check-no-known-credentials.mjs', import.meta.url));

function runScanner(files) {
  const repository = mkdtempSync(join(tmpdir(), 'dnd-credential-policy-'));
  try {
    const init = spawnSync('git', ['init', '--quiet'], {
      cwd: repository,
      encoding: 'utf8',
    });
    assert.equal(init.status, 0, init.stderr);

    for (const [path, source] of Object.entries(files)) {
      const absolutePath = join(repository, path);
      mkdirSync(dirname(absolutePath), { recursive: true });
      writeFileSync(absolutePath, source, 'utf8');
    }

    return spawnSync(process.execPath, [scanner], {
      cwd: repository,
      encoding: 'utf8',
    });
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
}

test('accepts the explicit content-admin environment contract', () => {
  const result = runScanner({
    'scripts/tool.mjs': [
      'const token = process.env.API_TOKEN;',
      'const user = process.env.CONTENT_ADMIN_USERNAME;',
      'const pass = process.env.CONTENT_ADMIN_PASSWORD;',
      'void [token, user, pass];',
    ].join('\n'),
  });
  assert.equal(result.status, 0, result.stderr);
});

test('rejects a repository-known credential literal in executable source', () => {
  const knownPassword = ['admin', '123'].join('');
  const result = runScanner({
    'scripts/tool.py': `password = ${JSON.stringify(knownPassword)}\n`,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /repository-known credential literal/);
});

test('rejects a JWT literal even in a test or documentation file', () => {
  const jwt = [
    'eyJhbGciOiJIUzI1NiJ9',
    'eyJzdWIiOiJpbXBvcnRlciJ9',
    'abcdefghijklmnopqrstuvwxyz0123456789ABCDE',
  ].join('.');
  for (const path of ['scripts/tool.test.mjs', 'docs/runbook.md']) {
    const result = runScanner({ [path]: `expired example: ${jwt}\n` });
    assert.equal(result.status, 1, `${path}: ${result.stderr}`);
    assert.match(result.stderr, /JWT literal/);
  }
});

test('rejects credential-bearing database URLs but permits explicit placeholders', () => {
  const scheme = ['post', 'gresql'].join('');
  const leaked = `${scheme}://service-user:high-entropy-secret-value@database.example/prod`;
  const rejected = runScanner({ 'config/deploy.toml': `dsn = ${JSON.stringify(leaked)}\n` });
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /credential-bearing database URL/);

  const placeholder = `${scheme}://user:password@host:5432/database`;
  const accepted = runScanner({ 'docs/setup.md': `DATABASE_URL=${placeholder}\n` });
  assert.equal(accepted.status, 0, accepted.stderr);
});

test('rejects implicit registration from a service script', () => {
  const registrationPath = ['/api/auth', 'register'].join('/');
  const result = runScanner({
    'scripts/tool.mjs': `await fetch(${JSON.stringify(registrationPath)});\n`,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must never auto-register/);
});

test('allows the dedicated registration smoke test without weakening credential checks', () => {
  const registrationPath = ['/api/auth', 'register'].join('/');
  const result = runScanner({
    'scripts/test_backend.py': `endpoint = ${JSON.stringify(registrationPath)}\n`,
  });
  assert.equal(result.status, 0, result.stderr);
});
