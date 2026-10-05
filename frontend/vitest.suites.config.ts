import {readFileSync} from 'node:fs';
import path from 'node:path';
import {mergeConfig} from 'vite';
import {configDefaults, defineConfig} from 'vitest/config';
import viteConfig from './vite.config';

// The runner resolves an exact nonempty list before launching Vitest. This
// profile intentionally avoids the historical default directory exclusions:
// generic tests under mvp/canon remain eligible for the extended local tier.
const selection = process.env.TEST_VITEST_SELECTION;
if (!selection) throw Error('Use scripts/testing/run.mjs to supply a verified test selection');
const files: unknown = JSON.parse(readFileSync(selection, 'utf8'));
if (!Array.isArray(files) || !files.length || files.some(file => typeof file !== 'string'
  || file.includes('..') || file.includes('\\') || path.isAbsolute(file) || !/\.(?:test|spec)\.tsx?$/.test(file))) {
  throw Error('Expected exact local frontend test files from the suite manifest');
}
export default mergeConfig(viteConfig, defineConfig({test: {
  include: files as string[], exclude: configDefaults.exclude, maxWorkers: 2, testTimeout: 30_000, hookTimeout: 60_000,
}}));
