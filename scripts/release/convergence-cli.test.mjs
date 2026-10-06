import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,readFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';
import {withExclusiveDispatchMarker} from './convergence-cli.mjs';
test('an unknown accepted POST retains a local attempt marker; repeating the CLI cannot send again',async t=>{
  const root=mkdtempSync(path.join(tmpdir(),'convergence-unit-'));t.after(()=>{assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.ok(path.basename(root).startsWith('convergence-unit-'));rmSync(root,{recursive:true,force:true});});
  const file=path.join(root,'attempt.json'),request={source:'a'.repeat(40),key:`sha256:${'b'.repeat(64)}`};let calls=0;
  const send=async()=>{calls++;throw Error('response lost after request accepted');};
  await assert.rejects(withExclusiveDispatchMarker(file,request,send),/response lost/);
  assert.deepEqual(JSON.parse(readFileSync(file,'utf8')),{status:'dispatch-attempt-started',...request});
  await assert.rejects(withExclusiveDispatchMarker(file,request,send),error=>error.code==='EEXIST');assert.equal(calls,1);
});
test('a marker write failure prevents the network call',async()=>{
  let called=false;await assert.rejects(withExclusiveDispatchMarker(import.meta.filename,{source:'a',key:'b'},async()=>{called=true;}),error=>error.code==='EEXIST');assert.equal(called,false);
});
