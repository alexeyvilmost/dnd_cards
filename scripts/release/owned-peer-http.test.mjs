import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ownedPeerHttpURL} from './owned-peer-http.mjs';

const peer=(alias,port,ip)=>{
  const name='compact_owned_'+alias,owner='compact_owned',network='compact_owned_net',imageId='sha256:'+'a'.repeat(64);
  return {alias,port,name,owner,network,imageId,container:{Name:'/'+name,Image:imageId,Config:{Image:imageId,Labels:{'bagofholding.compact-writer':owner}},State:{Running:true},
    NetworkSettings:{Networks:{[network]:{Aliases:[alias],IPAddress:ip}},Ports:{}}}};
};

test('a restarted backend uses its inspected address instead of a stale alias endpoint',()=>{
  const old=peer('backend',8080,'172.19.0.6'),current=peer('backend',8080,'172.19.0.9');
  assert.equal(ownedPeerHttpURL('http://backend:8080/api/health',old),'http://172.19.0.6:8080/api/health');
  assert.equal(ownedPeerHttpURL('http://backend:8080/api/health',current),'http://172.19.0.9:8080/api/health');
  assert.equal(ownedPeerHttpURL('http://backend:8080/api/spells?limit=100',current),'http://172.19.0.9:8080/api/spells?limit=100');
});

test('worker and frontend probes retain their own ports and current identities',()=>{
  assert.equal(ownedPeerHttpURL('http://rules-worker:8090/health',peer('rules-worker',8090,'172.19.0.10')),'http://172.19.0.10:8090/health');
  assert.equal(ownedPeerHttpURL('http://frontend:3000/build-info.json',peer('frontend',3000,'172.19.0.11')),'http://172.19.0.11:3000/build-info.json');
});

test('a stopped, substituted, exposed or foreign container cannot become a probe target',()=>{
  const original=peer('backend',8080,'172.19.0.9');
  const mutations=[
    p=>p.container.State.Running=false,
    p=>p.container.Name='/different',
    p=>p.container.Config.Labels['bagofholding.compact-writer']='foreign',
    p=>p.container.Image='sha256:'+'b'.repeat(64),
    p=>p.container.Config.Image='mutable:latest',
    p=>p.container.NetworkSettings.Networks.foreign={IPAddress:'10.0.0.1'},
    p=>p.container.NetworkSettings.Ports['8080/tcp']=[{HostIp:'0.0.0.0',HostPort:'8080'}],
    p=>p.container.NetworkSettings.Networks[p.network].Aliases=[],
    p=>p.container.NetworkSettings.Networks[p.network].IPAddress='',
    p=>p.container.NetworkSettings.Networks[p.network].IPAddress='backend',
  ];
  for(const mutate of mutations){const p=structuredClone(original);mutate(p);assert.throws(()=>ownedPeerHttpURL('http://backend:8080/api/health',p));}
  for(const url of ['https://backend:8080/api/health','http://backend:8090/api/health','http://foreign:8080/api/health','http://user:secret@backend:8080/api/health'])assert.throws(()=>ownedPeerHttpURL(url,original));
});
