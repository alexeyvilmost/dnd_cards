import {createServer} from 'node:http';
const hop=new Set(['host','connection','transfer-encoding','proxy-authorization','proxy-connection','upgrade']);
const headers=value=>Object.fromEntries(Object.entries(value).filter(([key])=>!hop.has(key.toLowerCase())));
/** A loopback transport only. It does not supply an API fixture or success. */
export async function startOwnedBrowserRelay(forward){
 if(typeof forward!=='function')throw Error('Owned transport callback required');
 const pending=new Set();let closed=false,authority;
 const server=createServer((request,response)=>{
  const task=(async()=>{
   try{
    if(closed||request.headers.host!==authority||!request.url?.startsWith('/')||request.url.startsWith('//')||/[\r\n]/.test(request.url))throw Error('Relative owned resource with exact loopback authority required');
    let size=0;const chunks=[];for await(const chunk of request){size+=chunk.length;if(size>1024*1024)throw Error('Owned relay request too large');chunks.push(chunk);}
    const result=await forward({path:request.url,method:request.method,headers:{...headers(request.headers),host:authority},bodyBase64:Buffer.concat(chunks).toString('base64')});
    if(!Number.isInteger(result?.status)||result.status<100||result.status>599||typeof result.bodyBase64!=='string'||!result.headers||typeof result.headers!=='object')throw Error('Owned transport response invalid');
    const bytes=Buffer.from(result.bodyBase64,'base64');if(bytes.length>32*1024*1024||bytes.toString('base64')!==result.bodyBase64)throw Error('Owned transport bytes invalid');
    if(!response.destroyed){response.writeHead(result.status,headers(result.headers));response.end(bytes);}
   }catch{if(!response.destroyed){if(!response.headersSent)response.writeHead(502);response.end();}}
  })();pending.add(task);task.finally(()=>pending.delete(task));
 });
 server.on('connection',socket=>socket.on('error',()=>{}));server.on('upgrade',(_request,socket)=>socket.destroy());
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 authority='127.0.0.1:'+server.address().port;
 return {origin:'http://'+authority,close:async()=>{closed=true;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await Promise.allSettled([...pending]);}};
}

// Runs inside the already-owned internal proxy. Host/path selection is fixed;
// status, headers and raw bytes originate from the actual OCI applications.
export const ownedBrowserForwardProgram=`import http from'node:http';process.stdin.setEncoding('utf8');let raw='';for await(const chunk of process.stdin)raw+=chunk;const x=JSON.parse(raw);if(!x.path.startsWith('/')||x.path.startsWith('//')||!/^127[.]0[.]0[.]1:[0-9]{1,5}$/.test(x.headers?.host??''))throw Error('relative owned path/authority required');const api=x.path.startsWith('/api/');const result=await new Promise((resolve,reject)=>{const request=http.request({hostname:api?'backend':'frontend',port:api?8080:3000,path:x.path,method:x.method,headers:x.headers,agent:false},response=>{const chunks=[];let size=0;response.on('data',chunk=>{size+=chunk.length;if(size>32*1024*1024){response.destroy();reject(Error('size'))}else chunks.push(chunk)});response.on('error',reject);response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,bodyBase64:Buffer.concat(chunks).toString('base64')}))});request.setTimeout(60000,()=>request.destroy(Error('timeout')));request.on('error',reject);request.end(Buffer.from(x.bodyBase64,'base64'))});console.log(JSON.stringify(result));`;
