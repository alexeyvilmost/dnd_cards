import {createRequire} from 'node:module';
import {readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const ts = createRequire(new URL('../../frontend/package.json', import.meta.url))('typescript');

/** Static source dependencies must be available in a clean checkout. Package imports are resolved normally. */
export function inspectFrontendImports(source, file) {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const failures = [];
  function inspect(literal) {
    if (!literal || !ts.isStringLiteralLike(literal)) return;
    const specifier = literal.text.replaceAll('\\', '/');
    if (!/^\.{1,2}\//.test(specifier)) return;
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(file.replaceAll('\\', '/')), specifier.split(/[?#]/, 1)[0]));
    if (!target.split('/').some(part => part === 'outputs' || part === 'node_modules' || part === '.env' || part.startsWith('.env.'))) return;
    const {line, character} = sourceFile.getLineAndCharacterOfPosition(literal.getStart(sourceFile));
    failures.push({file, line: line + 1, column: character + 1, target});
  }
  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) inspect(node.moduleSpecifier);
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) inspect(node.moduleReference.expression);
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) inspect(node.argument.literal);
    else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) inspect(node.arguments[0]);
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return failures;
}

export function inspectFrontendTree(root = repository) {
  const failures = [];
  function walk(relative) {
    for (const entry of readdirSync(path.join(root, relative), {withFileTypes: true})) {
      if (entry.isSymbolicLink()) throw Error('Frontend source links are not portable');
      const file = `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(file);
      else if (/\.[cm]?[jt]sx?$/.test(file)) failures.push(...inspectFrontendImports(readFileSync(path.join(root, file), 'utf8'), file));
    }
  }
  walk('frontend/src');
  return failures;
}
