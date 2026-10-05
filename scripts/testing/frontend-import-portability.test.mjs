import assert from 'node:assert/strict';
import test from 'node:test';
import {inspectFrontendImports, inspectFrontendTree} from './frontend-import-portability.mjs';

const file = 'frontend/src/engine/example.test.ts';
test('frontend static source dependencies never require local outputs, credentials or installed package paths', () => {
  assert.deepEqual(inspectFrontendTree(), []);
});
test('all static import forms reject ignored data even when it exists on the developer machine', () => {
  const sources = [
    "import cards from '../../../outputs/catalog-completion-20260929/cards.json';",
    "export {data} from '../../../outputs/private.json';",
    "import data = require('../../../outputs/private.json');",
    "type Data = import('../../../outputs/private.json').Data;",
    "const data = import('../../../outputs/private.json');",
    "const data = require('../../../outputs/private.json');",
    "import '../../node_modules/package/index.js';",
    "import '../../../.env';",
    "import '../../../.env.local?raw';",
    "import './safe/../../../../outputs/private.json';",
  ];
  for (const source of sources) assert.equal(inspectFrontendImports(source, file).length, 1, source);
});
test('tracked fixtures, normal packages and text mentioning imports remain valid', () => {
  const source = `import data from '../testing/fixtures/item-catalog.cards.json';
import {test} from 'vitest';
import type {Thing} from '../types';
// import data from '../../../outputs/private.json';
const message = "import data from '../../../outputs/private.json'";`;
  assert.deepEqual(inspectFrontendImports(source, file), []);
});
