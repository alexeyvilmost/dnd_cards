import {test} from 'node:test';
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {startOwnedBrowserRelay} from './owned-browser-relay.mjs';
test('loopback transport preserves upstream HTTP status and bytes, never substitutes a fixture success',async()=>{
 const bytes=Buffer.from([0,255,13,10,42]);let received;
 const relay=await startOwnedBrowserRelay(async input=>{received=input;return {status:418,headers:{'content-type':'application/octet-stream','x-owned-proof':'upstream'},bodyBase64:bytes.toString('base64')};});
 try{const result=await fetch(relay.origin+'/api/images/jobs/test',{method:'POST',body:'literal body',headers:{'content-type':'text/plain','x-owned-request':'same'}});assert.equal(result.status,418);assert.deepEqual(Buffer.from(await result.arrayBuffer()),bytes);assert.equal(result.headers.get('x-owned-proof'),'upstream');assert.equal(received.path,'/api/images/jobs/test');assert.equal(received.method,'POST');assert.equal(Buffer.from(received.bodyBase64,'base64').toString(),'literal body');assert.equal(received.headers['x-owned-request'],'same');assert.equal(received.headers.host,new URL(relay.origin).host);}finally{await relay.close();}
});
test('same-origin authority survives forwarding and a foreign Host never reaches upstream',async()=>{
 let calls=0;const relay=await startOwnedBrowserRelay(async input=>{calls++;return {status:input.headers.origin==='http://'+input.headers.host?202:403,headers:{},bodyBase64:''};});
 try{
  assert.equal((await fetch(relay.origin+'/api/images/jobs/test',{method:'POST',headers:{origin:relay.origin}})).status,202);
  const status=await new Promise((resolve,reject)=>{const req=request(relay.origin+'/api/images/jobs/test',{headers:{host:'foreign.invalid'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end();});
  assert.equal(status,502);assert.equal(calls,1);
 }finally{await relay.close();}
});
test('malformed or failed actual upstream remains a transport failure',async()=>{
 for(const forward of [async()=>{throw Error('private upstream payload');},async()=>({status:200,headers:{},bodyBase64:'invalid'})]){const relay=await startOwnedBrowserRelay(forward);try{const response=await fetch(relay.origin+'/asset');assert.equal(response.status,502);assert.equal(await response.text(),'');}finally{await relay.close();}}
});
