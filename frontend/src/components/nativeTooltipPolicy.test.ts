import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import ts from 'typescript';

/** `title` on custom components can be an actual visible heading. Only DOM
 * attributes (and router links forwarding DOM props) are native tooltips. */
function nativeTooltips(text: string, file = 'component.tsx'): number[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const lines: number[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      if (/^[a-z]/.test(tag) || tag === 'Link' || tag === 'NavLink') {
        for (const prop of node.attributes.properties) {
          if (ts.isJsxAttribute(prop) && prop.name.getText(source) === 'title') {
            lines.push(source.getLineAndCharacterOfPosition(prop.getStart(source)).line + 1);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return lines;
}

describe('site-wide native-tooltip policy', () => {
  it('distinguishes native attributes from visible dialog titles and accessible descriptions', () => {
    expect(nativeTooltips('<button title="Native"/>')).toEqual([1]);
    expect(nativeTooltips('<Link to="/" title="Native"/>')).toEqual([1]);
    expect(nativeTooltips('<Modal title="Heading"/><button aria-label="Open" aria-description="Details"/>')).toEqual([]);
  });
  it('uses canonical previews, never HTML title hover bubbles, in application JSX', () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const violations: string[] = [];
    const walk = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (path.endsWith('.tsx') && !/\.(test|generated)\./.test(path)) {
          for (const line of nativeTooltips(readFileSync(path, 'utf8'), path)) violations.push(`${relative(root, path)}:${line}`);
        }
      }
    };
    walk(root);
    expect(violations).toEqual([]);
  });
});
