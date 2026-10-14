import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {cleanEnvironment,resolveTool} from '../testing/runtime.mjs';
import {ownedPeerHttpURL} from './owned-peer-http.mjs';

test('real local Docker probes follow the current generation while the old address is occupied',{timeout:240000},()=>{
  assert.ok(!process.env.DOCKER_HOST&&!process.env.DOCKER_CONTEXT,'Default local Docker daemon required');
  const executable=resolveTool('docker',process.env.DOCKER_BIN),env=cleanEnvironment();
  const docker=(args,input)=>{
    const r=spawnSync(executable,args,{env,input,encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:2*1024*1024});
    assert.equal(r.status,0,'Owned local Docker operation failed');return r.stdout.trim();
  };
  const endpoint=JSON.parse(docker(['context','inspect','--format','{{json .Endpoints.docker.Host}}']));
  assert.match(endpoint,/^(unix:\/\/|npipe:\/\/)/);assert.equal(docker(['info','--format','{{.OSType}}']),'linux');
  const image=JSON.parse(readFileSync(new URL('../../infra/release-build-config.json',import.meta.url))).baseImages.NODE_IMAGE;
  assert.match(image,/^node@sha256:[a-f0-9]{64}$/);docker(['pull',image]);
  const imageId=JSON.parse(docker(['image','inspect',image]))[0].Id;
  const owner='compact_'+randomBytes(12).toString('hex'),network=owner+'_net',label='bagofholding.compact-writer='+owner,resources=[];
  const inspect=(kind,name)=>JSON.parse(docker([kind,'inspect',name]))[0];
  const server=(name,alias,port,generation,ip)=>{
    resources.push({kind:'container',name});
    const program=`require('node:http').createServer((q,r)=>{r.setHeader('content-type','application/json');r.end(JSON.stringify({generation:${generation}}))}).listen(${port},'0.0.0.0')`;
    docker(['run','-d','--name',name,'--label',label,'--network',network,...(alias?['--network-alias',alias]:[]),...(ip?['--ip',ip]:[]),'--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--entrypoint','node',imageId,'-e',program]);
    return inspect('container',name);
  };
  const remove=(kind,name)=>{
    const row=inspect(kind,name),labels=kind==='container'?row.Config.Labels:row.Labels;
    assert.equal(labels['bagofholding.compact-writer'],owner);
    docker(kind==='container'?['container','rm','--force',name]:[kind,'rm',name]);
    resources.find(r=>r.kind===kind&&r.name===name&&!r.removed).removed=true;
  };
  let proxy;
  const request=url=>{
    const program="let s='';process.stdin.setEncoding('utf8');for await(const c of process.stdin)s+=c;const url=JSON.parse(s);let value;for(let i=0;i<40;i++){try{const r=await fetch(url,{signal:AbortSignal.timeout(2000)});value=await r.json();break;}catch{await new Promise(r=>setTimeout(r,100));}}if(!value)throw Error('Owned peer unavailable');console.log(JSON.stringify(value));";
    return JSON.parse(docker(['exec','-i',proxy,'node','--input-type=module','-e',program],JSON.stringify(url)));
  };
  try{
    resources.push({kind:'network',name:network});docker(['network','create','--internal','--label',label,network]);
    const allocated=inspect('network',network);assert.equal(allocated.Internal,true);
    const subnet=allocated.IPAM.Config?.find(row=>/^\d+\.\d+\.\d+\.\d+\/\d+$/.test(row.Subnet))?.Subnet;
    assert.ok(subnet,'Owned Docker network must have an allocated IPv4 subnet');
    // Older daemons permit --ip only with explicit IPAM. Reserve a free subnet
    // using the daemon allocator, then recreate only our empty owned network.
    remove('network',network);resources.push({kind:'network',name:network});
    docker(['network','create','--internal','--subnet',subnet,'--label',label,network]);
    const explicit=inspect('network',network);assert.equal(explicit.Internal,true);
    assert.equal(explicit.IPAM.Config.find(row=>row.Subnet===subnet)?.Subnet,subnet);
    proxy=owner+'_probe';resources.push({kind:'container',name:proxy});
    docker(['run','-d','--name',proxy,'--label',label,'--network',network,'--read-only','--cap-drop','ALL','--entrypoint','node',imageId,'-e','setInterval(()=>{},1000)']);
    const first=owner+'_api_1',old=server(first,'backend',8080,1),oldIP=old.NetworkSettings.Networks[network].IPAddress;
    assert.equal(request(ownedPeerHttpURL('http://backend:8080/api/health',{alias:'backend',port:8080,name:first,owner,network,imageId,container:old})).generation,1);
    remove('container',first);
    server(owner+'_old_address',null,8080,-1,oldIP);
    const second=owner+'_api_2',current=server(second,'backend',8080,2);
    assert.notEqual(current.NetworkSettings.Networks[network].IPAddress,oldIP);
    assert.equal(request('http://'+oldIP+':8080/api/health').generation,-1);
    assert.equal(request(ownedPeerHttpURL('http://backend:8080/api/health',{alias:'backend',port:8080,name:second,owner,network,imageId,container:current})).generation,2);
    const workerName=owner+'_worker',worker=server(workerName,'rules-worker',8090,3);
    assert.equal(request(ownedPeerHttpURL('http://rules-worker:8090/health',{alias:'rules-worker',port:8090,name:workerName,owner,network,imageId,container:worker})).generation,3);
  }finally{
    for(const r of resources.reverse())if(!r.removed){
      const existing=docker(r.kind==='container'?['container','ls','-aq','--filter','label='+label,'--filter','name=^/'+r.name+'$']:['network','ls','-q','--filter','label='+label,'--filter','name=^'+r.name+'$']);
      if(existing)remove(r.kind,r.name);
    }
    assert.equal(docker(['container','ls','-aq','--filter','label='+label]),'');
    assert.equal(docker(['network','ls','-q','--filter','label='+label]),'');
  }
});
