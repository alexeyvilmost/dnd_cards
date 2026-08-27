import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { checkDiceBoxAssets, checkDiceBoxBuild } from './check-dice-box-assets.mjs';

const VERSION = '1.1.4';
const INTEGRITY = 'sha512-W8evh0LlCx/sorPS00cGZJO+/3I8g5eMfDqFAKAIUXF+/XVTP06bhgHSNFOCvLzWbdbEJX5za9QxB0ulDvfxyA==';

function write(root, path, contents) {
  const destination = join(root, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, contents);
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'dice-box-assets-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(root, 'package.json', JSON.stringify({ dependencies: { '@3d-dice/dice-box': '^1.1.4' } }));
  write(root, 'package-lock.json', JSON.stringify({
    packages: {
      'node_modules/@3d-dice/dice-box': { version: VERSION, integrity: INTEGRITY },
    },
  }));
  write(root, 'node_modules/@3d-dice/dice-box/package.json', JSON.stringify({ version: VERSION }));
  const files = {
    'ammo/ammo.wasm.wasm': Buffer.from([0, 1, 2, 3]),
    'themes/default/theme.config.json': '{"name":"default"}\n',
  };
  for (const [path, contents] of Object.entries(files)) {
    write(root, `node_modules/@3d-dice/dice-box/dist/assets/${path}`, contents);
    write(root, `public/assets/dice-box/${path}`, contents);
    write(root, `dist/assets/dice-box/${path}`, contents);
  }
  return root;
}

test('accepts an exact reviewed mirror of the integrity-pinned package assets', (t) => {
  const root = fixture(t);

  assert.deepEqual(checkDiceBoxAssets({ frontendRoot: root }), {
    version: VERSION,
    integrity: INTEGRITY,
    fileCount: 2,
  });
});

test('accepts only the reviewed DiceBox path in the deployable build', (t) => {
  const root = fixture(t);

  assert.equal(checkDiceBoxBuild({ frontendRoot: root }).fileCount, 2);
  write(root, 'dist/assets/themes/default/theme.config.json', '{"duplicate":true}\n');
  assert.throws(
    () => checkDiceBoxBuild({ frontendRoot: root }),
    /unused postinstall dice assets/,
  );
});

test('the runtime requests the reviewed versioned asset root', () => {
  const source = readFileSync(
    new URL('../src/dice/Dice3DOverlay.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /assetPath:\s*['"]\/assets\/dice-box\/['"]/);
  assert.doesNotMatch(source, /assetPath:\s*['"]\/assets\/(?:ammo|themes)/);
});

test('rejects missing, extra, or byte-drifted reviewed assets', async (t) => {
  await t.test('byte drift', (child) => {
    const root = fixture(child);
    write(root, 'public/assets/dice-box/ammo/ammo.wasm.wasm', Buffer.from([9]));
    assert.throws(() => checkDiceBoxAssets({ frontendRoot: root }), /assets differ/);
  });
  await t.test('extra file', (child) => {
    const root = fixture(child);
    write(root, 'public/assets/dice-box/themes/default/extra.json', '{}');
    assert.throws(() => checkDiceBoxAssets({ frontendRoot: root }), /assets differ/);
  });
  await t.test('missing file', (child) => {
    const root = fixture(child);
    rmSync(join(root, 'public/assets/dice-box/ammo/ammo.wasm.wasm'));
    assert.throws(() => checkDiceBoxAssets({ frontendRoot: root }), /assets differ/);
  });
});

test('rejects symlinked assets and an installed version outside the lock', async (t) => {
  await t.test('symlink', (child) => {
    const root = fixture(child);
    const path = join(root, 'public/assets/dice-box/themes');
    rmSync(path, { recursive: true });
    symlinkSync(
      join(root, 'node_modules/@3d-dice/dice-box/dist/assets/themes'),
      path,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    assert.throws(() => checkDiceBoxAssets({ frontendRoot: root }), /symbolic link/);
  });
  await t.test('version mismatch', (child) => {
    const root = fixture(child);
    write(root, 'node_modules/@3d-dice/dice-box/package.json', JSON.stringify({ version: '9.9.9' }));
    assert.throws(() => checkDiceBoxAssets({ frontendRoot: root }), /version differs/);
  });
});
