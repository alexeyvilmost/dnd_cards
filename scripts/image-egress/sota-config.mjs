// Convert one authenticated Sota profile to a restricted CONNECT service.
// The downloaded profile is data; its DNS, routes, TUN and other outbounds are
// never applied to the host or copied into the generated gateway.
import {isIP} from 'node:net';

export function sotaEgressConfiguration(profile,{username,password,listen='0.0.0.0',port=18080}={}) {
  if(!/^[a-z][a-z0-9_-]{2,31}$/.test(username??'')||!/^[a-f0-9]{64}$/.test(password??''))throw Error('Dedicated proxy credentials are required');
  if(!['127.0.0.1','0.0.0.0'].includes(listen)||!Number.isSafeInteger(port)||port<1024||port>65535)throw Error('Explicit unprivileged proxy listener required');
  const candidates=profile?.outbounds?.filter(row=>row.tag==='proxy');
  if(candidates?.length!==1)throw Error('Exactly one Sota proxy outbound required');
  const proxy=structuredClone(candidates[0]);
  if(proxy.type!=='vless'||!/^[a-f0-9-]{36}$/i.test(proxy.uuid??'')||typeof proxy.server!=='string'
    ||(!isIP(proxy.server)&&!(/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/i.test(proxy.server)))
    ||!Number.isSafeInteger(proxy.server_port)||proxy.server_port<1||proxy.server_port>65535
    ||proxy.tls?.enabled!==true||proxy.tls.insecure===true||proxy.tls.disable_sni===true)throw Error('Unsupported or insecure Sota outbound');
  const keys=new Set(['type','tag','server','server_port','uuid','flow','network','tls','transport','multiplex','packet_encoding']);
  if(Object.keys(proxy).some(key=>!keys.has(key)))throw Error('Unexpected Sota outbound field requires review');
  // In particular do not accept detour, bind_interface, routing_mark or TUN.
  return {
    log:{disabled:true},
    dns:{servers:[{type:'local',tag:'local'}]},
    inbounds:[{type:'http',tag:'openai-connect',listen,listen_port:port,users:[{username,password}],set_system_proxy:false}],
    outbounds:[proxy],
    route:{default_domain_resolver:'local',rules:[
      {inbound:['openai-connect'],domain:['api.openai.com'],port:[443],network:'tcp',action:'route',outbound:'proxy'},
      {action:'reject'},
    ]},
  };
}
