/**
 * Audit-only full PHB 2024 condition catalog.
 *
 * Safe default is a read-only plan:
 *   node scripts/content/update-conditions-2024-full.mjs
 * Production writes are delegated to the single versioned CAS/preimage/
 * rollback content migrator. This file exports canonical rows and can compare
 * them with an API, but intentionally cannot mutate data on its own.
 *
 * Existing records keep non-rule presentation fields. Missing Exhaustion and
 * Petrified rows are created with stable card_numbers. Every rule below is
 * data consumed by generic engine primitives; the script contains no runtime.
 */
import { readFileSync } from 'node:fs';

const BASE = process.env.API_URL || 'https://bagofholding.ru';
const REQUESTED_APPLY = process.argv.includes('--apply');

const contentPatch = JSON.parse(readFileSync(new URL(
  '../../frontend/src/canon/data/micro-mvp-l1-content-patch.v1.json',
  import.meta.url,
), 'utf8'));

/** Canonical rows are owned by the central versioned patch. */
export const PHB_2024_CONDITION_ROWS = contentPatch.conditionPatches.map((patch) => ({
  card_number: patch.cardNumber,
  ...patch.fields,
}));

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function same(left, right) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

async function fetchConditions() {
  const response = await fetch(`${BASE}/api/effects?effect_type=condition&limit=200`);
  if (!response.ok) throw new Error(`GET effects: ${response.status} ${await response.text()}`);
  const data = await response.json();
  return data.effects ?? [];
}

async function main() {
  if (REQUESTED_APPLY) {
    throw new Error('Direct condition writes are disabled; use the central versioned CAS/preimage/rollback content migrator.');
  }
  const before = await fetchConditions();
  const byNumber = new Map(before.map((row) => [row.card_number, row]));
  const operations = PHB_2024_CONDITION_ROWS.flatMap((row) => {
    const current = byNumber.get(row.card_number);
    if (!current) return [{ operation: 'create', row }];
    if (current.name === row.name
      && current.name_en === row.name_en
      && current.description === row.description
      && same(current.mechanics, row.mechanics)
      && current.repeatable === (row.card_number === 'COND-exhaustion')) return [];
    return [{ operation: 'update', row, current }];
  });

  console.log(`AUDIT ${BASE}: ${operations.length} operation(s)`);
  for (const planned of operations) console.log(`${planned.operation.toUpperCase()} ${planned.row.card_number}`);
  console.log(`CATALOG ${PHB_2024_CONDITION_ROWS.length}/15 condition rows; no writes performed`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error(error); process.exit(1); });
}
