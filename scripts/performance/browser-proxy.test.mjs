import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request} from 'node:http';
import {browserPerformanceProxy} from './browser-proxy.mjs';

test('performance proxy permits only the owned loopback origins and preserves caching',async()=>{
  let calls=0;
  const target=createServer((_request,response)=>{calls++;response.writeHead(200,{'cache-control':'public,max-age=31536000,immutable'});response.end('local');});
  await new Promise(resolve=>target.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${target.address().port}`,proxy=await browserPerformanceProxy([origin]);
  const through=path=>new Promise((resolve,reject)=>{
    const client=request(proxy.server,{path},response=>{response.resume();response.on('end',()=>resolve({status:response.statusCode,cache:response.headers['cache-control']}));});
    client.on('error',reject);client.end();
  });
  try {
    const local=await through(origin+'/asset.js');assert.equal(local.status,200);assert.match(local.cache,/immutable/);
    assert.equal((await through('https://example.invalid/private')).status,403);
    assert.equal((await through('http://127.0.0.1:1/private')).status,403);
    assert.equal((await through(origin.replace('http://','http://user:secret@'))).status,403);
    const connectStatus=await new Promise((resolve,reject)=>{
      const client=request(proxy.server,{method:'CONNECT',path:'example.invalid:443'});
      client.on('connect',(response,socket)=>{socket.on('error',()=>{});resolve(response.statusCode);socket.destroy();});
      client.on('error',reject);client.end();
    });
    assert.equal(connectStatus,403);
    assert.equal(calls,1);
  }finally{await proxy.close();target.closeAllConnections();await new Promise(resolve=>target.close(resolve));}
  await assert.rejects(browserPerformanceProxy(['https://example.invalid']),/loopback/);
});
