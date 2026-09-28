// Read-only snapshot for local editorial work. Never writes to the API.
import fs from 'node:fs/promises';

const base = process.env.CONTENT_SOURCE_API || 'https://bagofholding.ru';
const target = process.argv[2];
if (!target) throw new Error('Pass an output JSON path');
const catalogs = ['spells', 'feats', 'actions', 'effects', 'concepts'];
const keep = [
  'id', 'card_number', 'concept_id', 'name', 'name_en', 'description',
  'detailed_description', 'upcast_description', 'condition_description',
  'casting_time', 'level', 'category', 'action_type', 'effect_type', 'type',
  'resource', 'resources', 'recharge', 'damage', 'is_healing', 'heal_dice',
  'mechanics', 'properties', 'related_actions', 'related_effects',
  'prerequisite', 'ability_increase', 'show_detailed_description',
  'source', 'updated_at',
];
const data = { source: base, fetched_at: new Date().toISOString(), catalogs: {} };
for (const catalog of catalogs) {
  const rows = [];
  for (let page = 1; ; page++) {
    const response = await fetch(`${base}/api/${catalog}?page=${page}&limit=100`, {
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`${catalog} page ${page}: HTTP ${response.status}`);
    const body = await response.json();
    const chunk = body[catalog];
    if (!Array.isArray(chunk)) throw new Error(`${catalog} page ${page}: missing array`);
    rows.push(...chunk.map((row) => Object.fromEntries(keep.filter((key) => key in row).map((key) => [key, row[key]]))));
    if (rows.length >= body.total) break;
    if (!chunk.length) throw new Error(`${catalog}: pagination ended at ${rows.length}/${body.total}`);
  }
  data.catalogs[catalog] = rows;
  console.log(`${catalog}: ${rows.length}`);
}
await fs.writeFile(target, `${JSON.stringify(data, null, 2)}\n`, { flag: 'wx' });
