import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';

// Read-only tooling adapter for backend/storage_receipt.go v2. This is storage,
// not a gameplay interpreter. Never reconstruct an answer from current rows.
export function decodeReceiptStorage(row) {
  if (row.response_version === 1) {
    if(row.payload_hex!=null || row.response_length>0 || row.response_sha256)throw Error('Invalid legacy receipt storage');
    return row.response;
  }
  if (row.response_version !== 2 || !Number.isSafeInteger(row.response_length) || row.response_length < 1 || row.response_length > 64*1024*1024 || !/^[a-f0-9]{64}$/.test(row.response_sha256) || typeof row.payload_hex !== 'string' || !/^(?:[a-f0-9]{2})+$/.test(row.payload_hex) || row.payload_hex.length > 128*1024*1024) throw Error('Invalid receipt storage metadata');
  const raw = gunzipSync(Buffer.from(row.payload_hex,'hex'), {maxOutputLength: row.response_length});
  if (raw.length !== row.response_length || createHash('sha256').update(raw).digest('hex') !== row.response_sha256) throw Error('Receipt storage integrity failed');
  const response = JSON.parse(raw);
  if (!response || Array.isArray(response) || typeof response !== 'object') throw Error('Invalid receipt JSON');
  return response;
}

export async function scanCompactReceipts(database, onResponse) {
  const query = sql => database.query(sql, undefined, {sensitive:true});
  const columns = JSON.parse((await query("SELECT coalesce(json_agg(table_name),'[]'::json) FROM information_schema.columns WHERE table_schema='public' AND column_name='response_version' AND table_name IN ('roguelike_command_receipts','character_runtime_commands');")).trim());
  for (const table of columns) {
    // Each page is bounded to avoid collecting all historical response bodies.
    const key = table === 'roguelike_command_receipts' ? 'id::text' : "user_id::text || ':' || command_id::text";
    let cursor = '';
    for (;;) {
      if (!/^[a-f0-9:-]*$/.test(cursor)) throw Error('Invalid receipt scan cursor');
      const rows = JSON.parse((await query(`SELECT coalesce(json_agg(row_to_json(r)),'[]'::json) FROM (SELECT ${key} AS key, response_version,response_length,response_sha256,octet_length(response_payload) AS payload_bytes,CASE WHEN octet_length(response_payload)<=262144 THEN encode(response_payload,'hex') END AS payload_hex FROM ${table} WHERE (response_version <> 1 OR response_payload IS NOT NULL OR response_sha256 <> '' OR response_length <> 0) AND ${key} > '${cursor}' ORDER BY ${key} LIMIT 16) r;`)).trim());
      for (const row of rows) {
        if (!/^[a-f0-9:-]+$/.test(row.key) || !Number.isSafeInteger(row.payload_bytes) || row.payload_bytes<1 || row.payload_bytes>64*1024*1024) throw Error('Invalid receipt payload bounds');
        if (row.payload_hex === null) {
          const chunks=[];
          for(let offset=1;offset<=row.payload_bytes;offset+=65536) chunks.push((await query(`SELECT encode(substring(response_payload from ${offset} for 65536),'hex') FROM ${table} WHERE ${key}='${row.key}';`)).trim());
          row.payload_hex=chunks.join('');
        }
        if(row.payload_hex.length!==row.payload_bytes*2) throw Error('Receipt payload length mismatch');
        await onResponse(decodeReceiptStorage(row), {...row, table});
      }
      if (rows.length < 16) break;
      cursor = rows.at(-1).key;
    }
  }
}
