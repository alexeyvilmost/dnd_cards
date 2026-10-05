import {test} from 'node:test';
import assert from 'node:assert/strict';
import {databaseSchemaLedgerProof} from './database-schema-proof.mjs';
import {evidenceHash} from './validate-manifest.mjs';

test('metadata proof is one consistent query and cannot claim reference completeness',async()=>{
 const structure={columns:[{table:'history',column:'payload',type:'jsonb'}],constraints:[],indexes:[]},calls=[];
 const proof=await databaseSchemaLedgerProof({query:async(...args)=>{calls.push(args);return JSON.stringify({migrations:['001','297'],structure,artifactInventoryComplete:true,artifactHashes:['untrusted']});}});
 assert.deepEqual(proof,{scope:'schema-and-ledger',migrations:['001','297'],schemaFingerprint:evidenceHash(structure)});
 assert.equal(calls.length,1);assert.deepEqual(calls[0][2],{sensitive:true});
 assert.ok(calls[0][0].includes('schema_migrations'));assert.ok(calls[0][0].includes('information_schema.columns'));
 assert.ok(!/WITH page|jsonb_path_query|response_payload|FROM public\."history"/.test(calls[0][0]));
 assert.equal('artifactInventoryComplete' in proof,false);assert.equal('sourceReleaseReferences' in proof,false);
});

test('malformed metadata is rejected and database failures retain their original cause',async()=>{
 for(const value of ['',null,{}, {migrations:[1],structure:{columns:[],constraints:[],indexes:[]}}, {migrations:[],structure:{columns:null,constraints:[],indexes:[]}}]){
  await assert.rejects(databaseSchemaLedgerProof({query:async()=>typeof value==='string'?value:JSON.stringify(value)}));
 }
 const failure=Error('owned database disconnected');await assert.rejects(databaseSchemaLedgerProof({query:async()=>{throw failure;}}),error=>error===failure);
});

test('schema and ledger drift remain observable independently of user data',async()=>{
 const structure={columns:[],constraints:[],indexes:[]},rows=['297'];
 const read=()=>databaseSchemaLedgerProof({query:async()=>JSON.stringify({migrations:rows,structure})});
 const before=await read();rows.push('999_unapproved');const ledger=await read();assert.notDeepEqual(ledger.migrations,before.migrations);assert.equal(ledger.schemaFingerprint,before.schemaFingerprint);
 structure.columns.push({table:'history',column:'unexpected',type:'text'});assert.notEqual((await read()).schemaFingerprint,before.schemaFingerprint);
});
