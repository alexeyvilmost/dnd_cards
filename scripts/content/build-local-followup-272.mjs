// Applies only when migrations 270/271 were already run before the local
// empty-string and long-feat compatibility fixes were discovered.
import fs from 'node:fs/promises';
import path from 'node:path';
import { formatText, summary } from './build-readable-catalog.mjs';

const root = process.cwd();
const out = path.join(root, 'output/content-readability-20260927');
const source = JSON.parse(await fs.readFile(path.join(out, 'source.json'), 'utf8')).catalogs;
const local = JSON.parse(await fs.readFile(path.join(out, 'local-after-271.json'), 'utf8'));
const preview = JSON.parse(await fs.readFile(path.join(out, 'preview.json'), 'utf8')).catalogs;
const patch = { schema_version: 1, snapshot: 'local-2026-09-27-after-271', catalogs: {} };

for (const kind of ['spells', 'feats', 'actions', 'effects']) {
  patch.catalogs[kind] = [];
  const ids = new Map(source[kind].map((row) => [row.card_number, row.id]));
  const targets = new Map(preview[kind].map((row) => [row.card_number, row]));
  const fields = kind === 'spells'
    ? ['description', 'detailed_description', 'upcast_description', 'name_en', 'source']
    : ['description', 'detailed_description', 'name_en', 'source'];
  for (const row of local[kind]) {
    const updated = Object.fromEntries(fields.map((field) => [field, row[field] ?? null]));
    if (kind === 'feats' && row.description.length > 400) {
      if (!row.detailed_description) updated.detailed_description = row.description;
      updated.description = formatText(summary(row.description, 360));
    }
    if ((kind === 'actions' || kind === 'effects') && !row.name_en?.trim()) {
      updated.name_en = targets.get(row.card_number)?.name_en;
    }
    if (fields.every((field) => (row[field] ?? null) === updated[field])) continue;
    patch.catalogs[kind].push({
      id: ids.get(row.card_number), card_number: row.card_number,
      old: Object.fromEntries(fields.map((field) => [field, row[field] ?? null])), updated,
    });
  }
}
await fs.writeFile(path.join(root, 'backend/migrations/readable_catalog_272.json'), `${JSON.stringify(patch)}\n`);
console.log(Object.fromEntries(Object.entries(patch.catalogs).map(([name, rows]) => [name, rows.length])));
