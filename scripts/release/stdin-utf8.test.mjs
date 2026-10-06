import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const consumers=[['docker-rehearsal.mjs','apiProgram'],['docker-rehearsal.mjs','copyProgram'],['docker-rehearsal.mjs','replay'],['rehearsal-scenarios.mjs','program'],['compact-oci-adapter.mjs','httpProgram'],['compact-oci-adapter.mjs','copyProgram'],['owned-browser-relay.mjs','ownedBrowserForwardProgram']];
const payload={entity:{label:'Опрокинутый',description:'Встать: половина скорости 🙂',cost:{movement_fraction:0.5}},other:{label:'Élan 魔法',description:'Другая сущность',values:['Ж','界','😀',null,17]}};
const bytes=Buffer.from(JSON.stringify(payload)),marker=Buffer.from('О'),split=bytes.indexOf(marker)+1;
assert.ok(split>1);const expected=createHash('sha256').update(bytes).digest('hex');

for(const [file,name]of consumers)test(`${file}:${name} preserves JSON when a UTF-8 character spans stdin chunks`,async()=>{
 const source=await readFile(new URL(file,import.meta.url),'utf8'),match=new RegExp('(?:const |,\\s*)'+name+'=`([^`]+)`;').exec(source);
 assert.ok(match,'Actual embedded consumer required');
 const prefix=/^[\s\S]*?for await\(const \w+ of process\.stdin\)(\w+)\+=\w+;/.exec(match[1]);assert.ok(prefix,'Actual stdin read loop required');
 const program="process.stdout.write('ready\\n');process.stdin.once('data',()=>process.stdout.write('first\\n'));"+prefix[0]+"const decoded=JSON.parse("+prefix[1]+");console.log('result:'+JSON.stringify({sha256:(await import('node:crypto')).createHash('sha256').update(JSON.stringify(decoded)).digest('hex'),entities:Object.keys(decoded).length}));";
 const child=spawn(process.execPath,['--input-type=module','-e',program],{cwd:fileURLToPath(new URL('../../frontend/worker/',import.meta.url)),windowsHide:true,env:Object.fromEntries(['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','HOME','USERPROFILE'].filter(k=>process.env[k]).map(k=>[k,process.env[k]])),stdio:['pipe','pipe','pipe']});
 let output='',stderr='',sentFirst=false,sentLast=false;const timer=setTimeout(()=>child.kill(),5000);
 child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{output+=chunk;if(!sentFirst&&output.includes('ready\n')){sentFirst=true;child.stdin.write(bytes.subarray(0,split));}if(!sentLast&&output.includes('first\n')){sentLast=true;child.stdin.end(bytes.subarray(split));}});
 child.stderr.setEncoding('utf8');child.stderr.on('data',chunk=>stderr+=chunk);child.stdin.on('error',()=>{});
 try{const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});assert.equal(code,0,stderr);assert.equal(sentLast,true,'Both forced chunks must be consumed');const result=JSON.parse(output.split('\n').find(line=>line.startsWith('result:')).slice(7));assert.equal(result.entities,2);assert.equal(result.sha256,expected,'The actual consumer corrupted multilingual entity data');}finally{clearTimeout(timer);if(child.exitCode===null&&child.signalCode===null)child.kill();}
});
