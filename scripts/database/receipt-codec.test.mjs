import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {decodeReceiptStorage,scanCompactReceipts} from './receipt-codec.mjs';

test('storage tooling keeps exact immutable JSON and rejects corruption and bombs', () => {
  const response={revision:3,run:{text:'КД '.repeat(1000),avatar_url:'https://example.test/past.png'}};
  const raw=Buffer.from(JSON.stringify(response));
  const row={response_version:2,response_length:raw.length,response_sha256:createHash('sha256').update(raw).digest('hex'),payload_hex:gzipSync(raw).toString('hex')};
  assert.deepEqual(decodeReceiptStorage(row),response);
  assert.deepEqual(decodeReceiptStorage({response_version:1,response}),response);
  assert.throws(()=>decodeReceiptStorage({response_version:1,response,payload_hex:'abcd'}));
  for(const patch of [{response_version:3},{response_length:1},{response_length:64*1024*1024+1},{response_sha256:'a'.repeat(64)},{payload_hex:'invalid'}]) assert.throws(()=>decodeReceiptStorage({...row,...patch}));
});

test('legacy schema scan does not query absent receipt columns', async()=>{
  let queries=0;
  await scanCompactReceipts({query:async sql=>{queries++;assert.match(sql,/information_schema/);return '[]';}},()=>assert.fail('unexpected receipt'));
  assert.equal(queries,1);
});
