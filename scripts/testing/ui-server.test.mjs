import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {startTestUI} from './ui-server.mjs';

test('UI fixture host serves static assets but cannot forward any API method',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'dnd-ui-fixture-'));
  let server;
  try {
    await writeFile(path.join(directory,'index.html'),'<main>fixture</main>');
    server=await startTestUI({root:directory,fixtureOnly:true});
    const origin=`http://127.0.0.1:${server.address().port}`;
    assert.equal(await (await fetch(origin+'/sheet')).text(),'<main>fixture</main>');
    for(const method of ['GET','POST','PATCH','DELETE']) {
      const response=await fetch(origin+'/api/characters-v3',{method});
      assert.equal(response.status,503);assert.match((await response.json()).error,/Unmocked API/);
    }
    assert.equal((await fetch(origin+'/missing.json')).status,404);
  } finally {
    if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    assert.equal(path.dirname(directory),tmpdir());assert.ok(path.basename(directory).startsWith('dnd-ui-fixture-'));
    await rm(directory,{recursive:true,force:true});
  }
});
