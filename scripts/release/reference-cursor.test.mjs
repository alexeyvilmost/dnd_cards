import test from 'node:test';
import assert from 'node:assert/strict';
import {collectReferences} from './reference-cursor.mjs';
import {normalizeMediaReference} from './reference-values.mjs';
const h=x=>'sha256:'+x.repeat(64),fresh=()=>({artifactSet:new Set(),sourceReleaseSet:new Set(),mediaSet:new Set()});
test('nested arrays, both executable keys and Unicode/inline media preserve exact classification',()=>{
 const refs=fresh(),inline='data:image/svg+xml;utf8,😀Ж'+ 'x'.repeat(20*1024*1024);
 collectReferences({array:[null,1,{artifactHash:h('a'),inner:[{artifact_hash:h('b'),imageUrl:inline}]}],token_url:'https://example.invalid/Ж'},refs);
 assert.deepEqual([...refs.artifactSet].sort(),[h('a'),h('b')]);assert.equal(refs.sourceReleaseSet.size,0);
 assert.ok(refs.mediaSet.has(JSON.stringify(normalizeMediaReference(inline))));assert.ok(refs.mediaSet.has(JSON.stringify('https://example.invalid/Ж')));
});
test('semantic classification requires exact canonical row binding, never suppresses identical executable reference',()=>{
 const refs=fresh();collectReferences({rulesArtifactHash:h('a'),other:{rules_artifact_hash:h('a'),artifactHash:h('a')}},{...refs,canonical:true,releaseHash:h('a')});
 assert.deepEqual([...refs.sourceReleaseSet],[h('a')]);assert.deepEqual([...refs.artifactSet],[h('a')]);
 for(const bad of [h('b'),''])assert.throws(()=>collectReferences({rulesArtifactHash:bad},{...fresh(),canonical:true,releaseHash:h('a')}),/binding/);
 const generic=fresh();collectReferences({artifactHash:h('a')},generic);assert.deepEqual([...generic.artifactSet],[h('a')]);assert.equal(generic.sourceReleaseSet.size,0);
});
