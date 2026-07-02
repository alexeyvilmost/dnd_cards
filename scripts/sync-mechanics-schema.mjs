#!/usr/bin/env node
/** Синхронизирует docs/mechanics.schema.json → frontend/src/schemas/ */
import { copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
copyFileSync(
  join(root, 'docs/mechanics.schema.json'),
  join(root, 'frontend/src/schemas/mechanics.schema.json'),
);
console.log('mechanics.schema.json → frontend/src/schemas/');
