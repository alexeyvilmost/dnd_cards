import {createServer,request} from 'node:http';

/** Browser routing disables Chromium's HTTP cache. A local allowlist proxy
 * blocks remote egress without intercepting page requests through Playwright. */
export async function browserPerformanceProxy(origins) {
  const allowed=new Set(origins);
  for(const origin of allowed) {
    const url=new URL(origin);
    if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('Browser proxy requires loopback HTTP origins');
  }
  const server=createServer((incoming,outgoing)=>{
    incoming.on('error',()=>outgoing.destroy());outgoing.on('error',()=>{});
    let target;try{target=new URL(incoming.url);}catch{outgoing.writeHead(400);outgoing.end();return;}
    if(!allowed.has(target.origin)||target.username||target.password){outgoing.writeHead(403);outgoing.end();return;}
    const headers={...incoming.headers,host:target.host};delete headers['proxy-authorization'];delete headers['proxy-connection'];
    const upstream=request(target,{method:incoming.method,headers},response=>{
      outgoing.writeHead(response.statusCode,response.headers);response.pipe(outgoing);
      response.on('error',()=>outgoing.destroy());
    });
    upstream.on('error',()=>{if(!outgoing.headersSent)outgoing.writeHead(502);outgoing.end();});
    upstream.setTimeout(30000,()=>upstream.destroy());incoming.on('aborted',()=>upstream.destroy());outgoing.on('close',()=>upstream.destroy());incoming.pipe(upstream);
  });
  // Chromium may reset denied CONNECT sockets during startup or shutdown.
  server.on('connection',socket=>socket.on('error',()=>{}));
  server.on('connect',(_request,socket)=>{socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');});
  server.on('upgrade',(_request,socket)=>socket.destroy());
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {server:`http://127.0.0.1:${server.address().port}`,close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
