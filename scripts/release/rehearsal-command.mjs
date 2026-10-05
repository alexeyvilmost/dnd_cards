import {spawn} from 'node:child_process';
import {createReadStream} from 'node:fs';

export function dockerCommand(args,{input,inputFile,timeout=180000,env={}}={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn('docker',args,{env:{...Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.toUpperCase().startsWith('PG'))),...env},windowsHide:true,stdio:['pipe','pipe','pipe']});
    let output='',bytes=0,failed=false;
    const fail=()=>{if(failed)return;failed=true;child.kill();reject(Error('Disposable Docker step failed; raw process output withheld'));};
    const timer=setTimeout(fail,timeout);child.on('error',fail);
    child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{bytes+=Buffer.byteLength(chunk);if(bytes>128*1024*1024)fail();else output+=chunk;});
    child.stderr.resume();child.stdin.on('error',()=>{});
    child.on('close',code=>{clearTimeout(timer);if(code!==0)fail();else if(!failed)resolve(output.trim());});
    if(inputFile){const stream=createReadStream(inputFile);stream.on('error',fail);stream.pipe(child.stdin);}else child.stdin.end(input??'');
  });
}
