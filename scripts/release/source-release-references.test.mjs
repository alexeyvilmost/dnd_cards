import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {startTestStack} from '../testing/stack.mjs';
import {databaseRecoveryInventory} from './artifact-references.mjs';
import {assertSourceReleaseCoverage} from './source-release-references.mjs';
test('real PostgreSQL distinguishes canonical source-release identities from executable references without ignoring equal hashes',{timeout:120000},async()=>{
 const stack=await startTestStack({dbOnly:true}),hash=c=>'sha256:'+c.repeat(64),manifest={artifactVersion:'1.0.0',releaseId:'synthetic-source',source:'synthetic-owned-only'},bytes=JSON.stringify(manifest),manifestHash='sha256:'+createHash('sha256').update(bytes).digest('hex');
 const proof={schemaVersion:1,kind:'typed-rule-reference-inventory',status:'running',runId:stack.registry.runId};
 try{
  await stack.database.query(`CREATE TABLE schema_migrations(version text);INSERT INTO schema_migrations VALUES('fixture');CREATE TABLE ruleset_releases(id uuid PRIMARY KEY,rules_artifact_hash text,content_hash text,manifest_hash text,manifest_canonical_bytes bytea,manifest jsonb,artifact_version text,serializer_version text);
  INSERT INTO ruleset_releases VALUES('00000000-0000-4000-8000-000000000001','${hash('a')}','${hash('b')}','${manifestHash}',decode('${Buffer.from(bytes).toString('hex')}','hex'),'${bytes}','synthetic-source','canonical-v1');
  CREATE TABLE game_sessions(id int,ruleset_release_id uuid,rules_artifact_hash text,payload jsonb);INSERT INTO game_sessions VALUES(1,'00000000-0000-4000-8000-000000000001','${hash('a')}','{"nested":{"rulesArtifactHash":"${hash('a')}"}}');
  CREATE TABLE roguelike_events(payload jsonb);INSERT INTO roguelike_events VALUES('{"artifactHash":"${hash('c')}"}');`);
  const first=await databaseRecoveryInventory(stack.database);assert.equal(first.referenceInventoryVersion,2);assert.deepEqual(first.artifactHashes,[hash('c')]);assert.deepEqual(first.allDetectedRuleHashes,[hash('a'),hash('c')]);assert.equal(first.sourceReleaseReferences.length,1);
  const row=first.sourceReleaseReferences[0],certificate={kind:'historical-source-release',executable:false,releaseHash:hash('a'),releaseId:'synthetic-source',contentHash:hash('b'),databaseBinding:{rulesetReleaseId:row.rulesetReleaseId,manifestHash,manifestCanonicalBytesSha256:manifestHash,serializerVersion:'canonical-v1',manifest}};
  assertSourceReleaseCoverage(first.sourceReleaseReferences,[certificate]);assert.throws(()=>assertSourceReleaseCoverage(first.sourceReleaseReferences,[]));
  assert.throws(()=>assertSourceReleaseCoverage(first.sourceReleaseReferences,[{...certificate,contentHash:hash('d')}]));
  await stack.database.query(`UPDATE game_sessions SET payload='{"nested":{"rulesArtifactHash":"${hash('d')}"}}';`);await assert.rejects(()=>databaseRecoveryInventory(stack.database),/Invalid reference page kind/);
  await stack.database.query(`UPDATE game_sessions SET payload='{"nested":{"rulesArtifactHash":"${hash('a')}"}}';`);
  await stack.database.query(`INSERT INTO roguelike_events VALUES('{"artifact_hash":"${hash('a')}"}');`);
  assert.deepEqual((await databaseRecoveryInventory(stack.database)).artifactHashes,[hash('a'),hash('c')]);
  await stack.database.query(`UPDATE game_sessions SET payload='{}',rules_artifact_hash='${hash('d')}';`);await assert.rejects(()=>databaseRecoveryInventory(stack.database),/no retained source release|binding differs/);
  await stack.database.query(`UPDATE game_sessions SET payload='{}',rules_artifact_hash='${hash('a')}';UPDATE ruleset_releases SET manifest_canonical_bytes=decode('00','hex');`);await assert.rejects(()=>databaseRecoveryInventory(stack.database),/manifest bytes/);
  proof.status='passed';proof.checks=['canonical-semantic-vs-executable','all-detected-hashes-preserved','same-hash-in-executable-context-not-ignored','exact-certification-binding-required','unknown-or-mismatched-canonical-binding-rejected','changed-canonical-manifest-bytes-rejected'];
 }finally{await stack.cleanup();proof.cleanup={status:stack.registry.status,errors:stack.registry.cleanupErrors};await writeFile(path.join(stack.registry.directory,'typed-reference-inventory.json'),JSON.stringify(proof,null,2)+'\n');}
});
