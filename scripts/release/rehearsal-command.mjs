import {spawn} from 'node:child_process';
import {createReadStream} from 'node:fs';
import assert from 'node:assert/strict';

class DockerCommandFailure extends Error {
  constructor(diagnostic) {
    super('Disposable Docker step failed; raw process output withheld');
    this.diagnostic=Object.freeze(diagnostic);
  }
}
export function safeDockerFailure(error) {
  return error instanceof DockerCommandFailure ? {...error.diagnostic} : undefined;
}
export function createDockerCommand({spawnProcess=spawn,maximumOutputBytes=128*1024*1024}={}) {
 assert.ok(Number.isSafeInteger(maximumOutputBytes)&&maximumOutputBytes>0);
 return function command(args,{input,inputFile,timeout=180000,env={}}={}) {
  assert.ok(Number.isSafeInteger(timeout)&&timeout>0);
  return new Promise((resolve,reject)=>{
    const started=performance.now();let child,timer,stream,output='',bytes=0,stderrBytes=0,failed=false;
    const fail=(reason,exitCode=null,signal=null)=>{
      if(failed)return;failed=true;clearTimeout(timer);stream?.destroy();child?.kill();
      reject(new DockerCommandFailure({reason,durationMs:Math.round(performance.now()-started),stdoutBytes:bytes,stderrBytes,
        exitCode:Number.isSafeInteger(exitCode)?exitCode:null,signal:['SIGTERM','SIGKILL','SIGINT','SIGABRT','SIGSEGV'].includes(signal)?signal:null}));
    };
    try{child=spawnProcess('docker',args,{env:{...Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.toUpperCase().startsWith('PG'))),...env},windowsHide:true,stdio:['pipe','pipe','pipe']});}
    catch{fail('spawn-error');return;}
    timer=setTimeout(()=>fail('timeout'),timeout);child.on('error',()=>fail('spawn-error'));
    child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{bytes+=Buffer.byteLength(chunk);if(bytes>maximumOutputBytes)fail('output-limit');else output+=chunk;});
    child.stderr.on('data',chunk=>{stderrBytes+=chunk.length;});child.stdin.on('error',()=>{});
    child.on('close',(code,signal)=>{clearTimeout(timer);if(code!==0)fail('process-exit',code,signal);else if(!failed)resolve(output.trim());});
    if(inputFile){stream=createReadStream(inputFile);stream.on('error',()=>fail('input-read-error'));stream.pipe(child.stdin);}else child.stdin.end(input??'');
  });
 };
}
export const dockerCommand=createDockerCommand();
