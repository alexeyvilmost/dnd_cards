import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execute} from './runtime.mjs';

test('execute preserves a JSON document written one UTF-8 byte at a time',async()=>{
 const expected=JSON.stringify({label:'Опрокинутый 🧙',source:'КД'});
 const code=`const bytes=Buffer.from(${JSON.stringify(expected)});(async()=>{for(const byte of bytes){process.stdout.write(Buffer.from([byte]));await new Promise(resolve=>setTimeout(resolve,2));}})();`;
 const output=await execute(process.execPath,['-e',code]);
 assert.equal(output,expected);assert.deepEqual(JSON.parse(output),JSON.parse(expected));
});

test('execute decodes split Cyrillic and emoji bytes independently on stdout and stderr', async () => {
  const directory=await mkdtemp(path.join(tmpdir(),'owned-runtime-utf8-'));
  const log=path.join(directory,'output.log');
  const stdout='Производная 🧙‍♀️\n',stderr='Ошибка: КД 🔥\n';
  const script=`const a=Buffer.from(${JSON.stringify(stdout)}),b=Buffer.from(${JSON.stringify(stderr)});
    process.stdout.write(a.subarray(0,1));process.stderr.write(b.subarray(0,1));
    setTimeout(()=>{process.stdout.write(a.subarray(1));setTimeout(()=>process.stderr.write(b.subarray(1)),30);},30);`;
  try {
    const output=await execute(process.execPath,['-e',script],{log});
    assert.ok(output.includes(stdout));assert.ok(output.includes(stderr));assert.ok(!output.includes('\uFFFD'));
    assert.equal(await readFile(log,'utf8'),output);
  } finally {
    const resolved=path.resolve(directory),base=path.resolve(tmpdir())+path.sep;
    assert.ok(resolved.startsWith(base)&&path.basename(resolved).startsWith('owned-runtime-utf8-'));
    await rm(resolved,{recursive:true,force:true});
  }
});
