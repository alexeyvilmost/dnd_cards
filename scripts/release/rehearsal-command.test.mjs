import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createDockerCommand,safeDockerFailure} from './rehearsal-command.mjs';
const privateCanary='PRIVATE_PROCESS_CANARY_DO_NOT_PERSIST';
const command=options=>createDockerCommand({...options,spawnProcess:(_executable,args,settings)=>spawn(process.execPath,['--input-type=module','-e',...args],settings)});
test('real nonzero process exposes exit metadata without arguments or private stdout/stderr',async()=>{
 const invoke=command();let failure;
 await assert.rejects(invoke([`process.stdout.write('${privateCanary}');process.stderr.write('${privateCanary}');process.exitCode=7;`]),e=>{failure=e;return true;});
 const d=safeDockerFailure(failure);assert.equal(d.reason,'process-exit');assert.equal(d.exitCode,7);assert.equal(d.stdoutBytes,Buffer.byteLength(privateCanary));assert.equal(d.stderrBytes,Buffer.byteLength(privateCanary));assert.ok(d.durationMs>=0);assert.ok(!JSON.stringify(failure).includes(privateCanary));assert.ok(!failure.message.includes(privateCanary));
});
test('real stalled process distinguishes timeout from failure without raw input',async()=>{
 let failure;await assert.rejects(command()([`setInterval(()=>{},1000);`],{timeout:250,input:privateCanary}),e=>{failure=e;return true;});
 const d=safeDockerFailure(failure);assert.equal(d.reason,'timeout');assert.equal(d.exitCode,null);assert.ok(d.durationMs>=200);assert.ok(!JSON.stringify(d).includes(privateCanary));
});
test('real excessive output remains bounded and exposes only counts',async()=>{
 let failure;await assert.rejects(command({maximumOutputBytes:8})([`process.stdout.write('${privateCanary}');`]),e=>{failure=e;return true;});
 const d=safeDockerFailure(failure);assert.equal(d.reason,'output-limit');assert.ok(d.stdoutBytes>8);assert.ok(!JSON.stringify(failure).includes(privateCanary));
});
test('missing executable errors and foreign diagnostics are never serialized',async()=>{
 const invoke=createDockerCommand({spawnProcess:(_exe,_args,settings)=>spawn('missing-private-rehearsal-executable',[privateCanary],settings)});
 let failure;await assert.rejects(invoke([]),e=>{failure=e;return true;});assert.equal(safeDockerFailure(failure).reason,'spawn-error');assert.ok(!JSON.stringify(failure).includes(privateCanary));
 assert.equal(safeDockerFailure(Object.assign(Error(privateCanary),{diagnostic:{reason:privateCanary}})),undefined);
});
test('successful actual process preserves streaming UTF-8 and trimmed command output',async()=>{
 const script="const b=Buffer.from('КД 🧙');process.stdout.write(b.subarray(0,3));setTimeout(()=>{process.stdout.write(b.subarray(3));process.stdout.write('\\n')},20);";
 assert.equal(await command()([script]),'КД 🧙');
});
