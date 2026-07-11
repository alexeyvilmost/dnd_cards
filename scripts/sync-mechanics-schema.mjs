#!/usr/bin/env node
/**
 * Синхронизирует схему механик. КАНОН — frontend/src/schemas/mechanics.schema.json
 * (её импортируют движок, валидатор и линт; вся работа конструктора идёт туда).
 * docs/mechanics.schema.json — человекочитаемое ЗЕРКАЛО, генерируемое из канона.
 *
 * ВАЖНО: направление frontend → docs. Раньше было docs → frontend, и это откатывало
 * более новую боевую схему (мина). Редактируй frontend-копию, затем прогони этот скрипт.
 *
 * Запуск: node scripts/sync-mechanics-schema.mjs
 */
import { copyFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'frontend/src/schemas/mechanics.schema.json');
const dst = join(root, 'docs/mechanics.schema.json');

// Санитарная проверка: канон — валидный JSON, иначе не затираем зеркало.
JSON.parse(readFileSync(src, 'utf8'));

copyFileSync(src, dst);
console.log('mechanics.schema.json: frontend/src/schemas/ → docs/ (зеркало обновлено)');
