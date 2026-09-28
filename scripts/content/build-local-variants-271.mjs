// Compatibility patch for a local catalog whose feat prose predates the
// read-only public snapshot. Keeps that local wording while formatting it.
import fs from 'node:fs/promises';
import path from 'node:path';
import { formatText, summary } from './build-readable-catalog.mjs';

const root = process.cwd();
const out = path.join(root, 'output/content-readability-20260927');
const source = JSON.parse(await fs.readFile(path.join(out, 'source.json'), 'utf8')).catalogs;
const local = JSON.parse(await fs.readFile(path.join(out, 'local-after-migration.json'), 'utf8'));
const preview = JSON.parse(await fs.readFile(path.join(out, 'preview.json'), 'utf8')).catalogs;
const patch = { schema_version: 1, snapshot: 'local-2026-09-27-after-270', catalogs: {} };

for (const kind of ['spells', 'feats', 'actions', 'effects']) {
  const ids = new Map(source[kind].map((row) => [row.card_number, row.id]));
  const targets = new Map(preview[kind].map((row) => [row.card_number, row]));
  const fields = kind === 'spells'
    ? ['description', 'detailed_description', 'upcast_description', 'name_en', 'source']
    : ['description', 'detailed_description', 'name_en', 'source'];
  patch.catalogs[kind] = [];
  for (const row of local[kind]) {
    const target = targets.get(row.card_number);
    if (!target) throw new Error(`No target for ${kind}/${row.card_number}`);
    const updated = Object.fromEntries(fields.map((field) => [field, row[field] ?? null]));
    if (kind === 'feats') {
      let description = row.description || '';
      let detailed = row.detailed_description || null;
      if (description.length > 400) {
        if (!detailed) detailed = description;
        description = summary(description, 390);
      }
      updated.description = formatText(description);
      updated.detailed_description = formatText(detailed);
    }
    if (kind === 'spells' && row.card_number === 'teleport') {
      updated.detailed_description = formatText(row.detailed_description);
    }
    if ((kind === 'actions' || kind === 'effects') && !row.name_en?.trim()) {
      updated.name_en = target.name_en;
    }
    if (fields.every((field) => (row[field] ?? null) === updated[field])) continue;
    patch.catalogs[kind].push({
      id: ids.get(row.card_number),
      card_number: row.card_number,
      old: Object.fromEntries(fields.map((field) => [field, row[field] ?? null])),
      updated,
    });
  }
}
await fs.writeFile(path.join(root, 'backend/migrations/readable_catalog_271.json'), `${JSON.stringify(patch)}\n`);
console.log(Object.fromEntries(Object.entries(patch.catalogs).map(([name, rows]) => [name, rows.length])));
