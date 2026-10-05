import {readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import {directBoundaryIssues, inspectRuntimeGraph, runtimeSourceFiles, sourceDependencies} from './testing/importGraph';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CORE = path.join(ROOT, 'src/rules-core');
const PRIMITIVES = path.join(ROOT, 'src/rules-primitives');
const runtimeFiles = [...runtimeSourceFiles(CORE), ...runtimeSourceFiles(PRIMITIVES)];
const relative = (file: string) => path.relative(ROOT, file).replaceAll('\\', '/');
const LITERAL_ENTITY_UUID = /(?<![0-9a-f])[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![0-9a-f])/i;

describe('rules-core import boundary', () => {
  it('keeps legacy operations in the explicit adapter and permits shared type-only contracts', () => {
    expect(runtimeFiles.flatMap(file => directBoundaryIssues(relative(file), readFileSync(file, 'utf8')))).toEqual([]);
  });

  it('has no transitive UI, HTTP, storage or runtime dependency cycle', async () => {
    const graph = await inspectRuntimeGraph(ROOT, runtimeFiles.map(relative));
    expect(graph.forbidden).toEqual([]);
    expect(graph.environment).toEqual([]);
    expect(graph.direct).toEqual([]);
    expect(graph.cycles).toEqual([]);
  });

  it('does not select production behavior through literal entity UUIDs', () => {
    expect(runtimeFiles.filter(file => LITERAL_ENTITY_UUID.test(readFileSync(file, 'utf8'))).map(relative)).toEqual([]);
  });

  it('rejects bypasses through re-exports, dynamic imports and adapter wildcards', () => {
    for (const source of ["export {pay} from '../engine/cost';", "const cost = import('../engine/cost');",
      "const cost = require('../engine/cost');", "const cost = import(target);"]) {
      expect(directBoundaryIssues('src/rules-core/newPolicy.ts', source)).not.toEqual([]);
    }
    expect(directBoundaryIssues('src/rules-core/newPolicy.ts', "import {RuntimeState} from '../mvp/contracts';")).not.toEqual([]);
    expect(directBoundaryIssues('src/rules-core/legacy/engineAdapter.ts', "export * from '../../engine/execute';")).not.toEqual([]);
    expect(directBoundaryIssues('src/rules-core/legacy/engineAdapter.ts', "import * as engine from '../../engine/execute';")).not.toEqual([]);
    expect(directBoundaryIssues('src/rules-primitives/newPolicy.ts', "import {pay} from '../engine/cost';")).not.toEqual([]);
    expect(directBoundaryIssues('src/rules-core/newPolicy.ts', "import type {RuntimeState} from '../mvp/contracts';")).toEqual([]);
    expect(sourceDependencies('types.ts', "type T = import('../mvp/contracts').RuntimeState;")[0].typeOnly).toBe(true);
  });

  it('detects a forbidden transitive module, browser storage and a real cycle in temporary fixtures', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'rules-boundary-'));
    const put = (file: string, source: string) => {
      const target = path.join(directory, file); mkdirSync(path.dirname(target), {recursive: true}); writeFileSync(target, source);
    };
    try {
      put('src/rules-core/entry.ts', "import '../shared/a';");
      put('src/shared/a.ts', "import './b'; import '../api/transport'; export const a=1;");
      put('src/shared/b.ts', "import './a'; export const load=()=>localStorage.getItem('key');");
      put('src/api/transport.ts', "import 'node:fs'; export const transport=1;");
      const rejected = await inspectRuntimeGraph(directory, ['src/rules-core/entry.ts']);
      expect(rejected.forbidden).toContain('src/api/transport.ts');
      expect(rejected.forbidden).toContain('src/api/transport.ts -> node:fs');
      expect(rejected.environment.some(issue => issue.includes('localStorage'))).toBe(true);
      expect(rejected.cycles).toContainEqual(['src/shared/a.ts', 'src/shared/b.ts']);
      // Type-only mutual references are not executable cycles.
      put('src/shared/a.ts', "import type {B} from './b'; export interface A {b?:B}; export const a=1;");
      put('src/shared/b.ts', "import type {A} from './a'; export interface B {a?:A};");
      const accepted = await inspectRuntimeGraph(directory, ['src/rules-core/entry.ts']);
      expect(accepted.forbidden).toEqual([]); expect(accepted.environment).toEqual([]); expect(accepted.cycles).toEqual([]);
      put('src/rules-primitives/primitive.ts', "import '../shared/legacy';");
      put('src/shared/legacy.ts', "import '../engine/operation';");
      put('src/engine/operation.ts', 'export const operation=1;');
      const hiddenLegacy = await inspectRuntimeGraph(directory, ['src/rules-primitives/primitive.ts']);
      expect(hiddenLegacy.direct.some(issue => issue.startsWith('Primitive reaches orchestration:'))).toBe(true);
    } finally {
      expect(path.dirname(directory)).toBe(tmpdir());
      expect(path.basename(directory).startsWith('rules-boundary-')).toBe(true);
      rmSync(directory, {recursive: true, force: true});
    }
  });
});
