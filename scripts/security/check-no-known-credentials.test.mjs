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

function runScanner(files, { argumentsList = [], commitPaths = [] } = {}) {
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

    if (commitPaths.length > 0) {
      const commit = spawnSync(
        'git',
        [
          '-c', 'user.name=Release Gate Test',
          '-c', 'user.email=release-gate@example.invalid',
          'commit', '--quiet', '--no-gpg-sign', '-m', 'baseline', '--', ...commitPaths,
        ],
        { cwd: repository, encoding: 'utf8' },
      );
      if (commit.status !== 0) {
        const add = spawnSync('git', ['add', '--', ...commitPaths], {
          cwd: repository,
          encoding: 'utf8',
        });
        assert.equal(add.status, 0, add.stderr);
        const retry = spawnSync(
          'git',
          [
            '-c', 'user.name=Release Gate Test',
            '-c', 'user.email=release-gate@example.invalid',
            'commit', '--quiet', '--no-gpg-sign', '-m', 'baseline',
          ],
          { cwd: repository, encoding: 'utf8' },
        );
        assert.equal(retry.status, 0, retry.stderr);
      }
    }

    return spawnSync(process.execPath, [scanner, ...argumentsList], {
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

test('allows registration only in the loopback-only isolated paper QA service', () => {
  const registrationPath = ['/api/auth', 'register'].join('/');
  const guardedSource = [
    'const paperQAAddress = "127.0.0.1:8082"',
    'const paperQADatabase = "paper_sheet_20261002_qa"',
    'http.DefaultTransport = paperQANoHTTP{}',
    'if original.Hostname() != "localhost" && (ip == nil || !ip.IsLoopback())',
    'Host: fmt.Sprintf("127.0.0.1:%d", *databasePort), Path: "/" + paperQADatabase',
    'database != paperQADatabase || address != "127.0.0.1" || port != *databasePort || transactionMode != mode',
    `authWrite := c.Request.Method == http.MethodPost && (path == "/api/auth/login" || path == "${registrationPath}")`,
    `router.POST("${registrationPath}", authLimit.Handler(), JSONBodyLimitMiddleware(4096), authController.Register)`,
    'server := &http.Server{Addr: paperQAAddress',
  ].join('\n');
  const accepted = runScanner({
    'scripts/paper-sheet/document-qa-main.go': guardedSource,
  });
  assert.equal(accepted.status, 0, accepted.stderr);

  const exposedServer = runScanner({
    'scripts/paper-sheet/document-qa-main.go': guardedSource.replace(
      'server := &http.Server{Addr: paperQAAddress',
      'server := &http.Server{Addr: "0.0.0.0:8082"',
    ),
  });
  assert.equal(exposedServer.status, 1);
  assert.match(exposedServer.stderr, /must never auto-register/);
});

test('changed mode ignores inherited violations in clean tracked files', () => {
  const registrationPath = ['/api/auth', 'register'].join('/');
  const result = runScanner(
    {
      'scripts/legacy.mjs': `await fetch(${JSON.stringify(registrationPath)});\n`,
      'scripts/new.mjs': 'const token = process.env.API_TOKEN;\n',
    },
    {
      argumentsList: ['--changed'],
      commitPaths: ['scripts/legacy.mjs'],
    },
  );
  assert.equal(result.status, 0, result.stderr);
});

test('changed mode rejects violations introduced by an untracked file', () => {
  const registrationPath = ['/api/auth', 'register'].join('/');
  const result = runScanner(
    { 'scripts/new.mjs': `await fetch(${JSON.stringify(registrationPath)});\n` },
    { argumentsList: ['--changed'] },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must never auto-register/);
});
