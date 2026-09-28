// Correct names on the already-migrated development database. Fresh databases
// receive these names from the amended migration 270 patch.
import fs from 'node:fs/promises';
import path from 'node:path';

const out = path.join(process.cwd(), 'output/content-readability-20260927');
const local = JSON.parse(await fs.readFile(path.join(out, 'local-final.json'), 'utf8'));
const desired = JSON.parse(await fs.readFile(path.join(out, 'preview.json'), 'utf8')).catalogs;
const ids = new Set([
  'PUG-SS01', 'PUG-F07', 'PUG-F05', 'PUG-F15',
  'EFFECT-0062', 'EFFECT-0034', 'EFFECT-0011', 'EFFECT-0014',
  'RE-sub-wings', 'RE-aasimar-2', 'asi_ability_choice',
  'EFF-feat-brawler-push', 'RE-human-1', 'tabaxi_unarmed_strike',
  'AUDIT-20260905-recharge',
]);
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const sql = ['BEGIN;'];
for (const kind of ['actions', 'effects']) {
  const target = new Map(desired[kind].map((row) => [row.card_number, row.name_en]));
  for (const row of local[kind]) {
    if (!ids.has(row.card_number) || row.name_en === target.get(row.card_number)) continue;
    sql.push(`UPDATE ${kind} SET name_en=${quote(target.get(row.card_number))} WHERE card_number=${quote(row.card_number)} AND name_en=${quote(row.name_en)};`);
  }
}
sql.push('COMMIT;');
await fs.writeFile(path.join(out, 'local-name-corrections.sql'), `${sql.join('\n')}\n`);
console.log(`${sql.length - 2} guarded corrections`);
