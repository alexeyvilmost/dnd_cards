import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createDockerRehearsal} from './docker-rehearsal.mjs';

for(const changedOwnership of [false,true])test(`restore failure cleans every owned resource; changed ownership=${changedOwnership}`,async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'rehearsal-adapter-test-'));
  const resources=new Map(),calls=[];let label,run,pg;
  await writeFile(path.join(directory,'database.dump'),'unit fixture bytes');
  const executeDocker=async(args,options)=>{
    calls.push({args,options});
    if(args[0]==='context')return JSON.stringify('unix:///unit-only-docker.sock');
    if(args[0]==='pull')return '';
    if(['network','volume'].includes(args[0])&&args[1]==='create'){
      label=args[args.indexOf('--label')+1];run=label.split('=')[1];resources.set(args.at(-1),{kind:args[0],owner:run});return args.at(-1);
    }
    if(args[0]==='run'){
      const name=args[args.indexOf('--name')+1];assert.ok(name&&args.includes('--label'),'Every helper must have cleanup ownership');
      resources.set(name,{kind:'container',owner:run});
      if(args.includes('df'))return 'Filesystem 1024-blocks Used Available Capacity Mounted on\nunit 9999999 1 9999998 1% /data';
      pg=name;return name;
    }
    if(args[0]==='exec'){
      if(args.includes('pg_isready'))return '';
      if(args.includes('psql'))return 'minimal:0:off';
      if(args.includes('df'))return 'Filesystem 1024-blocks Used Available Capacity Mounted on\nunit 9999999 1 9999998 1% /data';
      assert.ok(args.includes('pg_restore'));throw Error('Injected restore interruption');
    }
    if(args[1]==='ls')return [...resources].filter(([,row])=>row.kind===args[0]).map(([name])=>name).join('\n');
    if(args[1]==='inspect'){
      const name=args[2],row=resources.get(name);assert.ok(row);
      // Ownership changes only during cleanup; restore failure itself is the
      // injected pg_restore interruption for both cases.
      const owner=changedOwnership&&name===pg&&calls.some(c=>c.args.includes('pg_restore'))?'foreign':row.owner;
      return JSON.stringify([{Internal:true,Labels:{'bagofholding.rehearsal':owner},Config:{Labels:{'bagofholding.rehearsal':owner}},State:{Running:true},NetworkSettings:{Networks:{[run+'_net']:{}},Ports:{}},Mounts:[{Type:'volume',Name:run+'_pgdata',Destination:'/var/lib/postgresql/data'}]}]);
    }
    if(args[1]==='rm'){assert.ok(resources.delete(args.at(-1)));return '';}
    throw Error('Unexpected simulated Docker command');
  };
  const adapter=createDockerRehearsal({directory,backupDirectory:directory,postgresImage:`example.test/postgres@sha256:${'a'.repeat(64)}`,executeDocker});
  assert.equal(adapter.execution,'simulation');
  try{
    await assert.rejects(adapter.prepareCapture({files:[{category:'database',path:'database.dump',bytes:18}]},{}),/interruption/);
    const cleaned=await adapter.cleanup();assert.deepEqual(await adapter.cleanup(),cleaned);
    assert.equal(cleaned.status,changedOwnership?'failed':'stopped');
    assert.equal(resources.size,changedOwnership?1:0);
    assert.ok(!(await readdir(directory)).some(name=>name.endsWith('.env')));
    assert.ok(calls.filter(call=>call.args.includes('--name')).every(call=>call.args.includes('--label')));
    assert.ok(!calls.some(call=>call.args.some(arg=>/^postgres:\/\//.test(arg))));
  }finally{
    // mkdtemp owns this exact generated directory; never deletes project paths.
    assert.equal(path.dirname(directory),os.tmpdir());assert.match(path.basename(directory),/^rehearsal-adapter-test-/);
    await rm(directory,{recursive:true,force:true});
  }
});
