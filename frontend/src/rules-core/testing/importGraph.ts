/** Test-only architecture analysis; never imported by the executable rules artifact. */
import {readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {build, type Metafile} from 'esbuild';
import ts from 'typescript';

const normalize = (value: string) => value.replaceAll('\\', '/');
const isTestSource = (file: string) => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file);
const isSupportSource = (file: string) => /\/(?:testing|coverage)\//.test(file);

export function runtimeSourceFiles(directory: string): string[] {
  return readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return ['testing', 'coverage'].includes(entry.name) ? [] : runtimeSourceFiles(file);
    return /\.tsx?$/.test(file) && !isTestSource(file) ? [file] : [];
  }).sort();
}

export interface SourceDependency {specifier: string; typeOnly: boolean; line: number; symbols: string[]}
export function sourceDependencies(file: string, source: string): SourceDependency[] {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const dependencies: SourceDependency[] = [];
  const add = (node: ts.Node, specifier: string, typeOnly: boolean, symbols: string[] = []) => {
    dependencies.push({specifier, typeOnly, symbols, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1});
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const named = clause?.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements : undefined;
      add(node, node.moduleSpecifier.text, Boolean(clause?.isTypeOnly || (!clause?.name && named?.length && named.every(item => item.isTypeOnly))),
        [...(clause?.name ? ['default'] : []), ...(clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings) ? ['*'] : []),
          ...(named?.map(item => (item.propertyName ?? item.name).text) ?? [])]);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const named = node.exportClause && ts.isNamedExports(node.exportClause) ? node.exportClause.elements : undefined;
      add(node, node.moduleSpecifier.text, Boolean(node.isTypeOnly || (named?.length && named.every(item => item.isTypeOnly))),
        named?.map(item => (item.propertyName ?? item.name).text) ?? ['*']);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      add(node, node.argument.literal.text, true);
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
      || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      const first = node.arguments[0];
      add(node, first && ts.isStringLiteral(first) ? first.text : '<computed-runtime-import>', false);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return dependencies;
}

export function directBoundaryIssues(file: string, source: string): string[] {
  const name = normalize(file);
  const isCore = name.startsWith('src/rules-core/');
  const isPrimitive = name.startsWith('src/rules-primitives/');
  if ((!isCore && !isPrimitive) || isTestSource(name) || isSupportSource(name)) return [];
  return sourceDependencies(name, source).flatMap(dependency => {
    const target = dependency.specifier.startsWith('.')
      ? path.posix.normalize(path.posix.join(path.posix.dirname(name), dependency.specifier)).replace(/\.tsx?$/, '')
      : dependency.specifier;
    const at = `${name}:${dependency.line} -> ${dependency.specifier}`;
    if (dependency.specifier === '<computed-runtime-import>') return [`Computed dependency: ${at}`];
    // Active shared type contracts do not execute the old runtime.
    if (target.startsWith('src/mvp/') && !(target === 'src/mvp/contracts' && dependency.typeOnly)) return [`MVP runtime dependency: ${at}`];
    if (isCore && target.startsWith('src/engine/') && name !== 'src/rules-core/legacy/engineAdapter.ts') return [`Legacy operation bypasses adapter: ${at}`];
    if (isPrimitive && (target.startsWith('src/engine/') || target.startsWith('src/rules-core/'))) return [`Primitive depends on orchestration: ${at}`];
    if (name === 'src/rules-core/legacy/engineAdapter.ts' && dependency.symbols.includes('*')) return [`Unreviewed adapter wildcard: ${at}`];
    return [];
  });
}

export function runtimeCycles(inputs: Metafile['inputs']): string[][] {
  let index = 0;
  const indices = new Map<string, number>(), low = new Map<string, number>(), stack: string[] = [], active = new Set<string>();
  const cycles: string[][] = [];
  const visit = (file: string) => {
    indices.set(file, index); low.set(file, index++); stack.push(file); active.add(file);
    for (const dependency of inputs[file].imports) {
      const target = dependency.path;
      if (!inputs[target] || dependency.external) continue;
      if (!indices.has(target)) {visit(target); low.set(file, Math.min(low.get(file)!, low.get(target)!));}
      else if (active.has(target)) low.set(file, Math.min(low.get(file)!, indices.get(target)!));
    }
    if (low.get(file) !== indices.get(file)) return;
    const group: string[] = [];
    let item: string;
    do {item = stack.pop()!; active.delete(item); group.push(item);} while (item !== file);
    if (group.length > 1 || inputs[file].imports.some(dependency => dependency.path === file)) cycles.push(group.sort());
  };
  for (const file of Object.keys(inputs).sort()) if (!indices.has(file)) visit(file);
  return cycles.sort((left, right) => left[0].localeCompare(right[0]));
}

function runtimeEnvironmentIssues(file: string, ast: ts.SourceFile, checker: ts.TypeChecker): string[] {
  const globals = new Set(['window', 'document', 'localStorage', 'sessionStorage', 'indexedDB', 'fetch', 'XMLHttpRequest', 'WebSocket']);
  const issues: string[] = [];
  const visit = (node: ts.Node): void => {
    const localBinding = ts.isIdentifier(node) && checker.getSymbolAtLocation(node)?.declarations
      ?.some(declaration => !declaration.getSourceFile().isDeclarationFile);
    if (ts.isIdentifier(node) && globals.has(node.text) && !localBinding
      && ((ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node)
        || (ts.isCallExpression(node.parent) && node.parent.expression === node)
        || (ts.isNewExpression(node.parent) && node.parent.expression === node))) {
      issues.push(`${file}:${ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1}: ${node.text}`);
    }
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)
      && ['globalThis', 'self'].includes(node.expression.text) && globals.has(node.name.text)) {
      issues.push(`${file}:${ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1}: ${node.getText(ast)}`);
    }
    if (!ts.isTypeNode(node)) ts.forEachChild(node, visit);
  };
  visit(ast);
  return issues;
}

export async function inspectRuntimeGraph(root: string, entries: string[]) {
  const result = await build({absWorkingDir: root, stdin: {contents: entries.map(file => `import ${JSON.stringify(`./${normalize(file)}`)};`).join('\n'),
    resolveDir: root, loader: 'ts'}, bundle: true, write: false, metafile: true, treeShaking: false, platform: 'node', format: 'esm', logLevel: 'silent'});
  const inputs = result.metafile!.inputs;
  // Bind locals without loading browser libraries. A local reaction `window`
  // is not the global Window; type-only declarations never execute either.
  const sourcePaths = Object.keys(inputs).filter(file => /^src\/.*\.tsx?$/.test(normalize(file))).map(file => path.resolve(root, file));
  const program = ts.createProgram(sourcePaths, {noResolve: true, noLib: true, types: [], noEmit: true, target: ts.ScriptTarget.ESNext});
  const checker = program.getTypeChecker();
  const forbidden: string[] = [], environment: string[] = [], direct: string[] = [];
  for (const file of Object.keys(inputs)) {
    const name = normalize(file);
    if (name === '<stdin>') continue;
    if (/node_modules\/(?:react(?:-dom)?|axios|@tanstack\/react-query)\//.test(name)
      || /^src\/(?:api|components|pages|contexts|hooks|mobile|paper-sheet|audio|dice|rules-session)\//.test(name)
      || /^src\/(?:character\/api|utils\/resources|settings)\.tsx?$/.test(name)) forbidden.push(name);
    for (const dependency of inputs[file].imports) {
      if (dependency.external && /^(?:node:)?(?:fs|http|https|net|tls|child_process)(?:\/|$)/.test(dependency.path)) {
        forbidden.push(`${name} -> ${dependency.path}`);
      }
    }
    if (/^src\/.*\.tsx?$/.test(name)) {
      const source = readFileSync(path.resolve(root, file), 'utf8');
      environment.push(...runtimeEnvironmentIssues(name, program.getSourceFile(path.resolve(root, file))!, checker));
      direct.push(...directBoundaryIssues(name, source));
    }
  }
  for (const primitive of Object.keys(inputs).filter(file => file.startsWith('src/rules-primitives/'))) {
    const visited = new Set<string>();
    const visit = (file: string) => {
      if (visited.has(file)) return;
      visited.add(file);
      for (const dependency of inputs[file]?.imports ?? []) {
        if (dependency.external || !inputs[dependency.path]) continue;
        if (/^src\/(?:engine|rules-core)\//.test(dependency.path)) {
          direct.push(`Primitive reaches orchestration: ${primitive} -> ${dependency.path}`);
        } else visit(dependency.path);
      }
    };
    visit(primitive);
  }
  return {inputs, forbidden: forbidden.sort(), environment: environment.sort(), direct: direct.sort(), cycles: runtimeCycles(inputs)};
}
