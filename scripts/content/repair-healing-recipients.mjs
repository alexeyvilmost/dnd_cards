import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

export const healingRecipientRepair = JSON.parse(fs.readFileSync(new URL('./healing-recipient-repair.json', import.meta.url), 'utf8'));
const literal = value => "'" + value.replaceAll("'", "''") + "'";

/** Exact, reviewed catalog correction; frozen encounters and their history are excluded. */
export function healingRecipientRepairSql({apply = false} = {}) {
  const checks = healingRecipientRepair.spells.map(row => {
    const before = literal(JSON.stringify(row.before)), after = literal(JSON.stringify(row.after));
    return `IF NOT EXISTS (SELECT 1 FROM spells WHERE id=${literal(row.id)} AND card_number=${literal(row.card_number)} AND mechanics::jsonb IN (${before}::jsonb,${after}::jsonb)) THEN RAISE EXCEPTION 'Healing recipient preimage changed: ${row.id}'; END IF;`;
  });
  const updates = apply ? healingRecipientRepair.spells.map(row => `UPDATE spells SET mechanics=${literal(JSON.stringify(row.after))}::jsonb, updated_at=NOW() WHERE id=${literal(row.id)} AND mechanics::jsonb=${literal(JSON.stringify(row.before))}::jsonb;`).join('\n') : '';
  return `BEGIN;\nSELECT id FROM spells WHERE id IN (${healingRecipientRepair.spells.map(row=>literal(row.id)).join(',')}) ORDER BY id${apply ? ' FOR UPDATE' : ''};\nDO $repair$ BEGIN\n${checks.join('\n')}\nEND $repair$;\n${updates}\nCOMMIT;`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const apply = process.argv.includes('--apply');
  if (!process.env.DATABASE_URL) throw Error('DATABASE_URL is required');
  const url = new URL(process.env.DATABASE_URL);
  const result = spawnSync(process.env.PSQL_BIN || 'psql', ['-w','-X','-v','ON_ERROR_STOP=1'], {
    input: healingRecipientRepairSql({apply}), encoding:'utf8', windowsHide:true,
    env:{...process.env,PGHOST:url.hostname,PGPORT:url.port||'5432',PGDATABASE:decodeURIComponent(url.pathname.slice(1)),
      PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGSSLMODE:url.searchParams.get('sslmode')||'require'},
  });
  // Diagnostics must not print the database DSN or passwords.
  if (result.status !== 0) throw Error('Recipient correction failed; transaction rolled back');
  console.log(apply ? 'Reviewed healing recipients applied (idempotent).' : 'Reviewed healing recipient preimages match. Use --apply to write.');
}
