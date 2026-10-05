import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {runsRoot} from './runtime.mjs';
import {assertOwnedPath} from './guards.mjs';
import {localAcceptanceContext} from './acceptance-context.mjs';

async function fixture(work) {
  const runId=`test_${randomBytes(12).toString('hex')}`,directory=assertOwnedPath(runsRoot,path.join(runsRoot,runId));
  const calls=[];let fail=false;
  const server=createServer(async(request,response)=>{
    let body='';for await(const chunk of request)body+=chunk;
    const input=JSON.parse(body);calls.push({path:request.url,username:input.username});
    response.writeHead(fail?429:200,{'content-type':'application/json'});
    response.end(JSON.stringify(fail?{error:'limited'}:{token:`owned-${input.username}`,user:{id:input.username}}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const registry={runId,directory,status:'ready',ports:{database:54321},origins:{api:origin,ui:origin}};
  const dsn=new URL(`postgres://127.0.0.1:54321/${runId}?sslmode=disable`);dsn.username='test_runner';
  const env={TEST_RUN_ID:runId,TEST_RUN_DIRECTORY:directory,TEST_DATABASE_URL:dsn.href,
    TEST_API_ORIGIN:origin,TEST_UI_ORIGIN:origin,TEST_USERNAME:'owned-player',TEST_PASSWORD:randomBytes(24).toString('hex'),
    TEST_ADMIN_USERNAME:'owned-admin',TEST_ADMIN_PASSWORD:randomBytes(24).toString('hex')};
  const save=()=>writeFile(path.join(directory,'registry.json'),JSON.stringify(registry));
  await mkdir(directory,{recursive:true});await save();
  try {await work({env,registry,calls,save,fail:value=>{fail=value;}});}
  finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    assertOwnedPath(runsRoot,directory);await rm(directory,{recursive:true,force:true});}
}

test('owned login is single-flight across contexts and stays isolated by account role',()=>fixture(async({env,calls})=>{
  const a=await localAcceptanceContext(env),b=await localAcceptanceContext(env);
  const results=await Promise.all(Array.from({length:40},(_,i)=>(i%2?a:b).authenticate()));
  assert.equal(calls.length,1);assert.equal(results[0].user.id,'owned-player');
  results[0].user.id='mutated';assert.equal((await b.authenticate()).user.id,'owned-player');
  assert.equal((await a.authenticate('admin')).user.id,'owned-admin');assert.equal(calls.length,2);
  await assert.rejects(a.authenticate('peer'),/provisioned/);await assert.rejects(a.authenticate('__proto__'),/provisioned/);
  assert.equal(calls.length,2);
}));

test('failed login is not cached or retried automatically',()=>fixture(async({env,calls,fail})=>{
  const context=await localAcceptanceContext(env);fail(true);
  await assert.rejects(context.authenticate(),/HTTP 429/);assert.equal(calls.length,1);
  fail(false);assert.equal((await context.authenticate()).user.id,'owned-player');assert.equal(calls.length,2);
}));

test('cached owned login cannot outlive readiness or a changed origin',()=>fixture(async({env,registry,calls,save})=>{
  const context=await localAcceptanceContext(env);await context.authenticate();
  registry.status='stopped';await save();await assert.rejects(context.authenticate(),/no longer ready/);
  registry.status='ready';registry.origins.api='http://127.0.0.1:1';await save();
  await assert.rejects(context.authenticate(),/no longer ready/);assert.equal(calls.length,1);
}));
