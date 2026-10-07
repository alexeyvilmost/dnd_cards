import{test}from'node:test';import assert from'node:assert/strict';
import{pair}from'./writer-policy-unit-fixture.mjs';import{evidenceHash}from'./validate-manifest.mjs';import{hostedWriterProvenance,cleanupWriterBrowserCase}from'./produce-writer-browser-proof.mjs';
import{createHash}from'node:crypto';
import{assertEmptyRetirementPreimages,fixtureRetirementIdentity,retireEmptyWriterFixture}from'./retire-empty-writer-fixture.mjs';
function fixture(){const {candidate:manifest}=pair();return {candidate:{manifest,provenance:{schemaVersion:1,releaseRunId:9,controlCommit:'c'.repeat(40),sourceCommit:manifest.releaseCommit,planHash:'sha256:'+'d'.repeat(64),manifestHash:evidenceHash(manifest)}},environment:{GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'owner/project',GITHUB_REF:'refs/heads/main',GITHUB_WORKFLOW_REF:'owner/project/.github/workflows/release.yml@refs/heads/main',GITHUB_SHA:'c'.repeat(40),GITHUB_RUN_ID:'9',GITHUB_RUN_ATTEMPT:'2'}};}
test('producer binds actual running main control attempt without pretending workflow success',()=>{const f=fixture(),p=hostedWriterProvenance(f.candidate,f.environment);assert.equal(p.runAttempt,2);assert.equal(p.releaseRunId,9);assert.ok(!('conclusion'in p));assert.ok(!('verifiedReleaseRun'in p));});
test('wrong fork/workflow/source/control/attempt cannot produce a publishable fixture',()=>{
 for(const change of [f=>f.candidate.frontendVerification={},f=>f.environment.GITHUB_ACTIONS='false',f=>f.environment.GITHUB_REF='refs/pull/1/merge',f=>f.environment.GITHUB_WORKFLOW_REF='fork/project/.github/workflows/release.yml@refs/heads/main',f=>f.environment.GITHUB_RUN_ID='10',f=>f.environment.GITHUB_RUN_ATTEMPT='0',f=>f.environment.GITHUB_SHA='d'.repeat(40),f=>f.candidate.provenance.manifestHash='sha256:'+'0'.repeat(64),f=>f.candidate.provenance.sourceCommit='f'.repeat(40)]){const f=fixture();change(f);assert.throws(()=>hostedWriterProvenance(f.candidate,f.environment));}
});

test('failed executable rehash cannot suppress either independent owned cleanup',async()=>{const calls=[];await assert.rejects(cleanupWriterBrowserCase({assertUnchanged:async()=>{calls.push('hash');throw Error('changed');},cleanup:async()=>{calls.push('browser');throw Error('browser cleanup');}},{cleanup:async()=>{calls.push('apps');return{status:'stopped'};}}),error=>error instanceof AggregateError&&error.errors.length===2);assert.deepEqual(calls,['hash','browser','apps']);});

test('fixture setup refuses legacy data in each independently protected category',()=>{
 const empty='sha256:'+createHash('sha256').update('').digest('hex');
 const original=Object.fromEntries(['characters','characters_v2','retired_inventories','retired_items'].map(name=>[name,{rows:0,sha256:empty}]));
 assertEmptyRetirementPreimages(original);
 for(const name of Object.keys(original))for(const change of [{rows:1,sha256:empty},{rows:0,sha256:'sha256:'+'0'.repeat(64)}]){const p=structuredClone(original);p[name]=change;assert.throws(()=>assertEmptyRetirementPreimages(p));}
 assert.throws(()=>assertEmptyRetirementPreimages({...original,unknown:{rows:0,sha256:empty}}));
});
test('only the exact canonical retirement checksum can request fixture setup',()=>{
 const checksum='sha256:'+'a'.repeat(64),row={id:'302_retire_legacy_characters',checksum};
 assert.equal(fixtureRetirementIdentity([{id:'301_character_lifecycle'}],checksum),null);
 assert.deepEqual(fixtureRetirementIdentity([row],checksum),row);
 for(const target of [[{...row,checksum:'sha256:'+'b'.repeat(64)}],[row,row],[{...row,kind:'observed-id-only'}]])assert.throws(()=>fixtureRetirementIdentity(target,checksum));
});
test('a serialized ownership flag or substitute adapter cannot execute fixture retirement',async()=>{
 const {readFile}=await import('node:fs/promises'),bytes=await readFile(new URL('../../backend/migrations/data/retire-legacy-characters-302.sql',import.meta.url));
 let touched=false;const adapter={owner:'compact_'+'a'.repeat(24),execution:'docker',assertOwned:async()=>{touched=true;},query:async()=>{touched=true;}};
 await assert.rejects(retireEmptyWriterFixture(adapter,[{id:'302_retire_legacy_characters',checksum:'sha256:'+createHash('sha256').update(bytes).digest('hex')}],{}),/Live owned compact adapter required/);assert.equal(touched,false);
});
