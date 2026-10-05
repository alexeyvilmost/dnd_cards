import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {withDockerReadSession} from './docker-read-session.mjs';

function fixture({response=()=>'',startupLost=false,exitCode=0,loseLease=false,limits}={}){
 const name='legacy_inspect_session_test',label=`bagofholding.legacy-inspection=${name}`,client=name+'_stream';
 const calls=[],resources=new Map();let child,forceChecks=0,removed=0,closed=false;
 const command=async args=>{
  calls.push(args);
  if(args[1]==='ls')return [...resources.keys()].join('\n');
  if(args[1]==='inspect')return JSON.stringify([{Config:{Labels:{'bagofholding.legacy-inspection':resources.get(args[2])}}}]);
  if(args[1]==='rm'){assert.equal(resources.get(args.at(-1)),name);resources.delete(args.at(-1));removed++;return '';}
  throw Error('Unexpected simulated cleanup');
 };
 const spawnProcess=(executable,args,options)=>{
  assert.equal(executable,'docker');assert.ok(!args.join(' ').includes('PRIVATE_DSN_CANARY'));assert.equal(options.env.DATABASE_URL,'PRIVATE_DSN_CANARY');
  assert.ok(args.includes('--read-only'));assert.equal(args[args.indexOf('--network')+1],'owned_internal');assert.equal(args[args.indexOf('--name')+1],client);resources.set(client,name);
  if(startupLost)throw Error('Simulated lost startup response');
  child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();
  const end=code=>{if(closed)return;closed=true;child.emit('close',code);};
  child.kill=()=>{queueMicrotask(()=>end(137));return true;};
  child.stdin=new Writable({write(chunk,encoding,callback){
   const text=chunk.toString();calls.push(text);const marker=/\\echo ([^\r\n]+)/.exec(text)?.[1];
   queueMicrotask(()=>{
    if(closed)return;
    if(text.includes('BEGIN'))assert.match(text,/BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET TRANSACTION SNAPSHOT '00000003-0000001B-1'/);
    const output=response(text,{child,end});
    if(output===null)return;
    for(const part of Array.isArray(output)?output:[output])if(part)child.stdout.write(part);
    if(marker&&!closed)child.stdout.write(marker+'\n');
   });callback();
  },final(callback){queueMicrotask(()=>end(exitCode));callback();}});
  return child;
 };
 const input={command,config:{postgresImage:'postgres@sha256:'+'a'.repeat(64),databaseNetwork:'owned_internal'},dsn:'PRIVATE_DSN_CANARY',name,label,snapshot:'00000003-0000001B-1',
  progress:async force=>{if(force){forceChecks++;if(loseLease&&forceChecks===2)throw Error('Snapshot progress lease expired');}},spawnProcess,limits};
 return {input,calls,resources,get removed(){return removed;},get forceChecks(){return forceChecks;}};
}

test('persistent reader preserves split UTF-8, exact snapshot and terminal lease check; metadata and rows use one process',async()=>{
 const bytes=Buffer.from('["Ж😀"]\n');
 const f=fixture({response:sql=>sql.includes('FETCH')?[bytes.subarray(0,3),bytes.subarray(3,6),bytes.subarray(6)]:sql.includes('SELECT 1')?'1\n':''});
 const result=await withDockerReadSession(f.input,async db=>{assert.equal(await db.query('SELECT 1;'),'1');const rows=[];await db.rows('FETCH FORWARD 1 FROM c;',line=>rows.push(JSON.parse(line)));return rows;});
 assert.deepEqual(result,[['Ж😀']]);assert.equal(f.forceChecks,2);assert.equal(f.removed,1);assert.equal(f.resources.size,0);assert.ok(f.calls.some(x=>typeof x==='string'&&x.includes('ROLLBACK')));
});

test('lost startup and final lease loss both refuse success and independently remove the owned client',async()=>{
 for(const options of [{startupLost:true},{loseLease:true}]){const f=fixture(options);await assert.rejects(withDockerReadSession(f.input,async()=>({complete:true})));assert.equal(f.removed,1);assert.equal(f.resources.size,0);}
});

test('row, metadata, callback and subprocess failures never return a complete result',async()=>{
 for(const mode of ['row','metadata','callback','exit','timeout']){
  const f=fixture({exitCode:mode==='exit'?1:0,limits:{maxLineBytes:128,maxMetadataBytes:16,statementMilliseconds:mode==='timeout'?10:70000},response:sql=>sql.includes('SELECT value')?mode==='row'?'x'.repeat(129)+'\n':mode==='metadata'?'x'.repeat(17)+'\n':mode==='timeout'?null:'value\n':''});
  await assert.rejects(withDockerReadSession(f.input,async db=>{if(mode==='exit')return {complete:true};if(mode==='callback')return db.rows('SELECT value;',()=>{throw Error('PRIVATE_ROW_CANARY');});return db.query('SELECT value;');}));
  assert.equal(f.removed,1);assert.equal(f.resources.size,0);
 }
});

test('malformed and truncated UTF-8 are rejected rather than replaced, including partial final output',async()=>{
 for(const truncated of [false,true]){
  const f=fixture({response:(sql,{child,end})=>{
   if(!sql.includes('SELECT value'))return '';
   if(truncated){child.stdout.write(Buffer.from([0xe2,0x82]));end(0);return null;}
   return Buffer.from([0xc3,0x28,0x0a]);
  }});
  await assert.rejects(withDockerReadSession(f.input,db=>db.query('SELECT value;')),error=>error.code==='CURSOR_INVALID_UTF8');
  assert.equal(f.removed,1);assert.equal(f.resources.size,0);
 }
});

test('unframed trailing output and mismatched owner cannot become successful cleanup',async()=>{
 const f=fixture({response:(sql,{child})=>{if(sql.includes('SELECT value')){child.stdout.write('partial-without-newline');return '';}return '';},limits:{statementMilliseconds:10}});
 await assert.rejects(withDockerReadSession(f.input,db=>db.query('SELECT value;')));assert.equal(f.removed,1);
 const owner=fixture();
 await assert.rejects(withDockerReadSession(owner.input,async()=>{owner.resources.set('legacy_inspect_session_test_stream','someone_else');return true;}),/cleanup failed/);
 assert.equal(owner.removed,0);assert.equal(owner.resources.size,1);
});
