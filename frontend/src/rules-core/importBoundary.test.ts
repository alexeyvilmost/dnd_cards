import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = dirname(fileURLToPath(import.meta.url));
const BANNED_IMPORTS = [
  /from ['"]react(?:\/|['"])/,
  /from ['"]axios(?:\/|['"])/,
  /from ['"]\.\.\/api(?:\/|['"])/,
  /from ['"]\.\.\/components(?:\/|['"])/,
  /from ['"]\.\.\/pages(?:\/|['"])/,
  /from ['"]\.\.\/contexts(?:\/|['"])/,
];
const LITERAL_ENTITY_UUID = /(?<![0-9a-f])[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![0-9a-f])/i;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) return [];
    return [path];
  });
}

describe('rules-core import boundary', () => {
  it('does not import React, HTTP, UI or storage layers', () => {
    const violations = sourceFiles(ROOT).flatMap((path) => {
      const source = readFileSync(path, 'utf8');
      return BANNED_IMPORTS.filter((pattern) => pattern.test(source)).map((pattern) => `${path}: ${pattern}`);
    });
    expect(violations).toEqual([]);
  });

  it('keeps all legacy engine imports inside the anti-corruption adapter', () => {
    const violations = sourceFiles(ROOT).flatMap((path) => {
      if (path.endsWith(join('legacy', 'engineAdapter.ts')) || path.endsWith('domain.ts')) return [];
      const source = readFileSync(path, 'utf8');
      return /from ['"]\.\.\/(?:\.\.\/)?(?:engine|mvp)\//.test(source) ? [path] : [];
    });
    expect(violations).toEqual([]);
  });

  it('does not select production behavior through literal entity UUIDs', () => {
    const nonRuntimeRoots = [join(ROOT, 'testing'), join(ROOT, 'coverage')];
    const violations = sourceFiles(ROOT)
      .filter((path) => !nonRuntimeRoots.some((directory) => path.startsWith(`${directory}${sep}`)))
      .filter((path) => LITERAL_ENTITY_UUID.test(readFileSync(path, 'utf8')));
    expect(violations).toEqual([]);
  });
});
