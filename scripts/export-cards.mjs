#!/usr/bin/env node
/**
 * Выгрузка всех предметов (cards) в JSON.
 * Запуск: node scripts/export-cards.mjs
 * Переменные: API_URL, OUT_FILE
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchAll, apiUrl } from './content/api.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_FILE = process.env.OUT_FILE || resolve(__dirname, '../data/cards-all.json');

async function main() {
  console.log(`API: ${apiUrl()}`);
  const cards = await fetchAll('/api/cards', 'cards', { limit: 200 });
  const payload = {
    exported_at: new Date().toISOString(),
    source: apiUrl(),
    total: cards.length,
    cards,
  };
  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`Сохранено ${cards.length} предметов → ${OUT_FILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
