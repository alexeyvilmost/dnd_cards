import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withLegacyReadSnapshot,readDockerSchemaLedgerProof} from './read-snapshot.mjs';
test('snapshot exporter awaits async commands and cleans owned resources after cancellation or lease loss',async t=>{
 let now=0;t.mock.method(Date,'now',()=>now);
 for(const failure of ['cancelled','expired',null]){
  const name='legacy_inspect_async',label=`bagofholding.legacy-inspection=${name}`,calls=[];let cancelled=false,running=true,removed=false;
  const raw=async(args,options)=>{await Promise.resolve();calls.push(args);if(args[0]==='run'){assert.equal(options.env.DATABASE_URL,'private-dsn');assert.ok(!args.join(' ').includes('private-dsn'));return 'created';}if(args[0]==='exec')return args.includes('cat')?'00000003-0000001B-1':'';if(args[1]==='ls')return name+'_snapshot';if(args[1]==='inspect')return JSON.stringify([{State:{Running:running},Config:{Labels:{'bagofholding.legacy-inspection':name}}}]);if(args[1]==='rm'){removed=true;return '';}throw Error('unexpected');};
  const input={command:async(...args)=>{if(cancelled)throw Error('cancelled');return raw(...args);},cleanupCommand:raw,config:{databaseNetwork:'owned_net',postgresImage:'postgres@sha256:'+'a'.repeat(64),snapshotLease:{idleSeconds:2,totalSeconds:4,renewSeconds:1}},dsn:'private-dsn',name,label};
  const run=()=>withLegacyReadSnapshot(input,async(snapshot,progress)=>{assert.equal(snapshot,'00000003-0000001B-1');now+=1100;await progress();assert.ok(calls.some(args=>args[0]==='exec'&&args.includes('touch')));now+=1100;if(failure==='cancelled')cancelled=true;if(failure==='expired')running=false;await progress();return 'complete';});
  if(failure)await assert.rejects(run,failure==='cancelled'?/cancelled/:/expired/);else assert.equal(await run(),'complete');assert.equal(removed,true);assert.deepEqual(calls.at(-1),['container','rm','--force',name+'_snapshot']);
 }
});

test('metadata wrapper preserves one imported read-only snapshot and cleanup on malformed replies',async()=>{
 for(const malformed of [false,true]){
  const resources=new Map(),queries=[];let label,name;
  const command=async(args,options={})=>{
   await Promise.resolve();
   if(args[0]==='run'){
    name=args[args.indexOf('--name')+1];label=args[args.indexOf('--label')+1];resources.set(name,true);
    assert.equal(options.env.DATABASE_URL,'private-owned-dsn');assert.ok(!args.join(' ').includes('private-owned-dsn'));
    if(args.includes('-d'))return 'created';
    queries.push(options.input);resources.delete(name);return malformed?'broken-json':JSON.stringify({migrations:['297'],structure:{columns:[],constraints:[],indexes:[]}});
   }
   if(args[0]==='exec')return '00000003-0000001B-1';
   if(args[1]==='ls')return [...resources.keys()].join('\n');
   if(args[1]==='inspect')return JSON.stringify([{State:{Running:true},Config:{Labels:{'bagofholding.legacy-inspection':label.split('=')[1]}}}]);
   if(args[1]==='rm'){resources.delete(args.at(-1));return '';}
   throw Error('Unexpected owned boundary');
  };
  const promise=readDockerSchemaLedgerProof({command,postgresImage:'postgres@sha256:'+'a'.repeat(64),databaseNetwork:'owned',dsn:'private-owned-dsn'});
  if(malformed)await assert.rejects(promise);else {const proof=await promise;assert.equal(proof.scope,'schema-and-ledger');assert.equal('artifactInventoryComplete' in proof,false);}
  assert.equal(queries.length,1);assert.match(queries[0],/BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;SET TRANSACTION SNAPSHOT '00000003-0000001B-1'/);assert.match(queries[0],/statement_timeout='60s'/);assert.ok(!queries[0].includes('WITH page'));assert.equal(resources.size,0);
 }
});
