import test from 'node:test';
import assert from 'node:assert/strict';
import {sotaEgressConfiguration} from './sota-config.mjs';
const credentials={username:'openai',password:'a'.repeat(64)};
const profile=()=>({inbounds:[{type:'tun'}],route:{final:'direct'},outbounds:[
  {type:'vless',tag:'proxy',uuid:'11111111-1111-4111-8111-111111111111',server:'example.test',server_port:443,tls:{enabled:true,insecure:false,server_name:'example.test',reality:{enabled:true,public_key:'test'}}},
  {type:'direct',tag:'direct'},
]});
test('gateway accepts only authenticated OpenAI TLS destinations and never copies provider host routing',()=>{
 const source=profile(),before=structuredClone(source),config=sotaEgressConfiguration(source,credentials);
 assert.deepEqual(source,before);assert.equal(config.inbounds.length,1);assert.equal(config.inbounds[0].type,'http');assert.equal(config.inbounds[0].set_system_proxy,false);
 assert.deepEqual(config.inbounds[0].users,[credentials]);assert.equal(config.outbounds.length,1);assert.equal(config.outbounds[0].type,'vless');
 assert.deepEqual(config.route.rules,[{inbound:['openai-connect'],domain:['api.openai.com'],port:[443],network:'tcp',action:'route',outbound:'proxy'},{action:'reject'}]);
 assert.equal(config.log.disabled,true);assert.equal(config.route.final,undefined);
 config.outbounds[0].tls.server_name='changed';assert.deepEqual(source,before);
});
test('gateway fails closed for insecure profiles, injected routing and missing authentication',()=>{
 for(const mutate of [p=>p.outbounds[0].tls.insecure=true,p=>p.outbounds[0].tls.enabled=false,p=>p.outbounds[0].detour='direct',p=>p.outbounds[0].bind_interface='eth0',p=>p.outbounds.push({...p.outbounds[0]}),p=>p.outbounds[0].server_port=0]) {
  const p=profile();mutate(p);assert.throws(()=>sotaEgressConfiguration(p,credentials));
 }
 assert.throws(()=>sotaEgressConfiguration(profile(),{}));assert.throws(()=>sotaEgressConfiguration(profile(),{...credentials,listen:'::'}));
});
