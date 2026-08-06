#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

const repositoryRoot = execFileSync(
  'git',
  ['rev-parse', '--show-toplevel'],
  { encoding: 'utf8' },
).trim();

// Include untracked files locally so the check also protects work before it is
// staged. In CI this is equivalent to scanning the complete checked-out tree.
const sourcePaths = [
  ...new Set(
    execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      { cwd: repositoryRoot, encoding: 'utf8' },
    )
      .split('\0')
      .filter(Boolean),
  ),
];

const executableExtensions = new Set([
  '.bat',
  '.cjs',
  '.go',
  '.js',
  '.mjs',
  '.ps1',
  '.py',
  '.sh',
  '.sql',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
]);
const textExtensions = new Set([
  ...executableExtensions,
  '.conf',
  '.css',
  '.env',
  '.graphql',
  '.html',
  '.ini',
  '.json',
  '.md',
  '.properties',
  '.toml',
  '.txt',
  '.xml',
]);
const scannerPath = 'scripts/security/check-no-known-credentials.mjs';
const explicitRegistrationTest = 'scripts/test_backend.py';
const knownCredentialLiterals = [
  ['admin', '123'].join(''),
  ['password', '123'].join(''),
  ['testuser', '123'].join(''),
];
const legacyCredentialVariables = [
  ['AUTH', 'USER'].join('_'),
  ['AUTH', 'PASS'].join('_'),
];
const credentialPatterns = [
  {
    reason: 'JWT literal',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  },
  {
    reason: 'credential-bearing database URL',
    pattern: /\b(?:mariadb|mongodb(?:\+srv)?|mysql|postgres(?:ql)?|redis):\/\/([^\s/:@]+):([^\s/@]+)@/gi,
  },
  {
    reason: 'OpenAI-style API key literal',
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    reason: 'GitHub token literal',
    pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  },
  {
    reason: 'AWS access key literal',
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  {
    reason: 'private key material',
    pattern: /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/g,
  },
];

function isExecutableSource(path) {
  if (path === scannerPath) return false;
  if (basename(path).toLowerCase().startsWith('dockerfile')) return true;
  return executableExtensions.has(extname(path).toLowerCase());
}

function isScannableSource(path) {
  if (path === scannerPath) return false;
  if (isExecutableSource(path)) return true;
  const name = basename(path).toLowerCase();
  return textExtensions.has(extname(name)) || /^\.env(?:\..+)?$/.test(name);
}

function isUnitTest(path) {
  return (
    path.endsWith('_test.go')
    || /\.(?:spec|test)\.[cm]?[jt]sx?$/.test(path)
  );
}

function isDocumentedDatabasePlaceholder(match) {
  const username = (match[1] ?? '').toLowerCase();
  const password = (match[2] ?? '').toLowerCase();
  return (
    (username === 'user' && password === 'password')
    || (username === 'postgres' && password === 'test')
  );
}

function lineNumberAt(text, offset) {
  return text.slice(0, offset).split('\n').length;
}

const violations = [];

for (const path of sourcePaths) {
  if (!isScannableSource(path)) continue;
  const absolutePath = join(repositoryRoot, path);
  if (!existsSync(absolutePath)) continue;
  const source = readFileSync(absolutePath, 'utf8');

  for (const { pattern, reason } of credentialPatterns) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      if (reason === 'credential-bearing database URL' && isDocumentedDatabasePlaceholder(match)) {
        continue;
      }
      violations.push({
        path,
        line: lineNumberAt(source, match.index ?? 0),
        reason,
      });
    }
  }

  for (const literal of knownCredentialLiterals) {
    let offset = source.indexOf(literal);
    while (offset !== -1) {
      violations.push({
        path,
        line: lineNumberAt(source, offset),
        reason: 'repository-known credential literal',
      });
      offset = source.indexOf(literal, offset + literal.length);
    }
  }

  if (path.startsWith('scripts/')) {
    for (const variable of legacyCredentialVariables) {
      const offset = source.indexOf(variable);
      if (offset !== -1) {
        violations.push({
          path,
          line: lineNumberAt(source, offset),
          reason: `legacy ${variable} bypasses the content-admin auth contract`,
        });
      }
    }
  }

  if (
    path.startsWith('scripts/')
    && !isUnitTest(path)
    && path !== explicitRegistrationTest
    && /\/(?:api\/)?auth\/register\b/.test(source)
  ) {
    const offset = source.search(/\/(?:api\/)?auth\/register\b/);
    violations.push({
      path,
      line: lineNumberAt(source, offset),
      reason: 'service script must never auto-register a user',
    });
  }
}

if (violations.length > 0) {
  process.stderr.write(
    [
      'Known credentials or implicit user registration found in the source tree:',
      ...violations.map(({ path, line, reason }) => `- ${path}:${line}: ${reason}`),
      '',
      'Use API_TOKEN or CONTENT_ADMIN_USERNAME plus CONTENT_ADMIN_PASSWORD.',
      '',
    ].join('\n'),
  );
  process.exitCode = 1;
} else {
  process.stdout.write('No repository-known credentials or implicit script registration found.\n');
}
