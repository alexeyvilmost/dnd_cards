import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import path from 'node:path';
import {databaseRecoveryInventory} from './artifact-references.mjs';
import {databaseSchemaLedgerProof} from './database-schema-proof.mjs';
import {startTestStack} from '../testing/stack.mjs';
import {normalizeMediaReference,normalizeMediaReferences} from './reference-values.mjs';

test('bounded real PostgreSQL inventory preserves every nested/text/compact reference and rejects concurrent drift',{timeout:120000},async()=>{
  const stack=await startTestStack({dbOnly:true});const hash=char=>'sha256:'+char.repeat(64),proof={schemaVersion:1,kind:'bounded-reference-inventory',runId:stack.registry.runId,status:'running'};
  try{
    const raw=Buffer.from(JSON.stringify({run:{catalog:[{artifact_hash:hash('d'),imageUrl:'https://example.invalid/compressed.png'}]}}));
    await stack.database.query(`CREATE TABLE schema_migrations(version text PRIMARY KEY);INSERT INTO schema_migrations VALUES('297_fixture');
      CREATE TABLE reference_fixture(id int PRIMARY KEY,payload jsonb,other json,image_url_spent text,rules_artifact_hash text);
      INSERT INTO reference_fixture SELECT n,jsonb_build_object('array',jsonb_build_array(jsonb_build_object('deep',jsonb_build_object('artifactHash','${hash('a')}','image_url','https://example.invalid/'||n))), 'scalars',jsonb_build_array(1,null,'ignore'),'ignored','${hash('f')}'),json_build_object('nested',json_build_object('artifact_hash','${hash('b')}','tokenUrl','https://example.invalid/token')),NULL,NULL FROM generate_series(1,130) n;
      UPDATE reference_fixture SET image_url_spent='https://example.invalid/spent',rules_artifact_hash='${hash('c')}' WHERE id=130;
      CREATE TABLE roguelike_command_receipts(id uuid PRIMARY KEY,response_version int,response jsonb,response_payload bytea,response_length int,response_sha256 text);
      INSERT INTO roguelike_command_receipts VALUES('00000000-0000-4000-8000-000000000001',2,'{}',decode('${gzipSync(raw).toString('hex')}','hex'),${raw.length},'${createHash('sha256').update(raw).digest('hex')}');`);
    const inline='data:image/svg+xml;base64,Ж'+'a'.repeat(20*1024*1024),long='https://example.invalid/'+'x'.repeat(9000);
    await stack.database.query(`INSERT INTO reference_fixture(id,payload,other) VALUES(131,jsonb_build_object('image_url','data:image/svg+xml;base64,Ж'||repeat('a',${20*1024*1024})),json_build_object('token_url','https://example.invalid/'||repeat('x',9000)));`);
    let maxQueryBytes=0,maxResponseBytes=0;const observed={query:async(...args)=>{maxQueryBytes=Math.max(maxQueryBytes,Buffer.byteLength(args[0]));const result=await stack.database.query(...args);maxResponseBytes=Math.max(maxResponseBytes,Buffer.byteLength(result));return result;}};
    const fine=await databaseRecoveryInventory(observed,{pageRows:7,columnsPerBatch:1});let limited=false,smaller=false;
    const adaptive={query:async(...args)=>{if(args[0].includes('WITH page AS MATERIALIZED')){if(!limited){limited=true;throw Object.assign(Error('simulated transport bound'),{code:'ENOBUFS'});}if(args[0].includes('LIMIT 32)'))smaller=true;}return observed.query(...args);}};
    const coarse=await databaseRecoveryInventory(adaptive,{pageRows:64,columnsPerBatch:4});assert.equal(smaller,true);
    assert.deepEqual(fine.artifactHashes,['a','b','c','d'].map(hash));assert.deepEqual(fine.artifactHashes,coarse.artifactHashes);assert.deepEqual(fine.mediaReferences,coarse.mediaReferences);
    assert.equal(fine.mediaReferences.length,135);assert.equal(fine.schemaFingerprint,coarse.schemaFingerprint);assert.ok(fine.scan.pages>coarse.scan.pages);assert.ok(maxQueryBytes<6000);assert.ok(maxResponseBytes<16*1024);
    const metadataCalls=[],metadataDatabase={query:async(...args)=>{metadataCalls.push(args[0]);return stack.database.query(...args);}};
    const metadata=await databaseSchemaLedgerProof(metadataDatabase);assert.equal(metadata.schemaFingerprint,fine.schemaFingerprint);assert.deepEqual(metadata.migrations,fine.migrations);assert.equal(metadataCalls.length,1);assert.ok(!metadataCalls[0].includes('WITH page'));assert.equal('artifactInventoryComplete' in metadata,false);
    assert.ok(fine.mediaReferences.some(row=>JSON.stringify(row)===JSON.stringify(normalizeMediaReference(inline))));assert.ok(fine.mediaReferences.some(row=>JSON.stringify(row)===JSON.stringify(normalizeMediaReference(long))));
    assert.deepEqual(normalizeMediaReferences([inline,long]),normalizeMediaReferences([normalizeMediaReference(inline),normalizeMediaReference(long)]));
    let attempts=0;await assert.rejects(()=>databaseRecoveryInventory({query:async(...args)=>{if(args[0].includes('WITH page AS MATERIALIZED')){attempts++;throw Object.assign(Error('one-row still too large'),{code:'ENOBUFS'});}return observed.query(...args);}}),/one-row still too large/);assert.equal(attempts,7);
    let changed=false;const changing={query:async(...args)=>{const result=await stack.database.query(...args);if(!changed&&args[0].includes('WITH page AS MATERIALIZED')){changed=true;await stack.database.query("UPDATE reference_fixture SET image_url_spent='https://example.invalid/changed' WHERE id=1;");}return result;}};
    await assert.rejects(()=>databaseRecoveryInventory(changing),/visibility snapshot changed/);
    // A reference-only change is intentionally outside metadata scope. The
    // retained full scanner still sees it; metadata must not certify coverage.
    assert.deepEqual(await databaseSchemaLedgerProof(metadataDatabase),metadata);
    await stack.database.query('ALTER TABLE reference_fixture ADD COLUMN new_schema_field text;');
    assert.notEqual((await databaseSchemaLedgerProof(metadataDatabase)).schemaFingerprint,metadata.schemaFingerprint);
    await stack.database.query("INSERT INTO schema_migrations VALUES('999_unknown_owned_probe');");assert.notDeepEqual((await databaseSchemaLedgerProof(metadataDatabase)).migrations,metadata.migrations);
    await stack.database.query("UPDATE reference_fixture SET payload=jsonb_build_object('artifactHash','unknown-format') WHERE id=1;");
    await assert.rejects(()=>databaseRecoveryInventory(stack.database),/unrecognized artifact/);
    proof.status='passed';proof.checks=['all-pages-all-columns','nested-array-and-alias-keys','text-and-compact-storage','same-results-different-page-sizes','adaptive-bound-same-cursor','one-row-limit-fail-closed','20MiB-inline-byte-fingerprint-no-body-export','old-literal-media-dual-read','concurrent-mutation-fail-closed','unknown-reference-fail-closed'];proof.maxQueryBytes=maxQueryBytes;proof.maxResponseBytes=maxResponseBytes;proof.pages={fine:fine.scan.pages,coarse:coarse.scan.pages};
  }finally{await stack.cleanup();proof.cleanup={status:stack.registry.status,errors:stack.registry.cleanupErrors};await writeFile(path.join(stack.registry.directory,'bounded-reference-inventory.json'),JSON.stringify(proof,null,2)+'\n');}
});
