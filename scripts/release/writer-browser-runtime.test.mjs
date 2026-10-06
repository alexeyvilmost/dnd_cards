import{test}from'node:test';import assert from'node:assert/strict';
import{assertLockedWriterBrowser,createWriterBrowserTemporaryDirectory}from'./writer-browser-runtime.mjs';
import{tmpdir}from'node:os';import{lstat,writeFile,access,rename,mkdir,rmdir}from'node:fs/promises';import path from'node:path';
import{writerBrowserPins}from'./writer-browser-consumption.mjs';
import{assertFormatProbePolicy}from'./compact-oci-adapter.mjs';
function fixture(){return {platform:'linux',architecture:'x64',lock:{packages:Object.fromEntries(['@playwright/test','playwright','playwright-core'].map(name=>['node_modules/'+name,{version:writerBrowserPins.playwrightVersion}]))},installed:{version:writerBrowserPins.playwrightVersion},registry:{browsers:[{name:'chromium',revision:writerBrowserPins.browserRevision,browserVersion:writerBrowserPins.browserVersion}]}};}
test('bundled browser pins must agree with actual lock, installed package and browser registry',()=>{assertLockedWriterBrowser(fixture());for(const change of [v=>v.platform='win32',v=>v.architecture='arm64',v=>v.installed.version='0.0.0',v=>v.lock.packages['node_modules/playwright-core'].version='0.0.0',v=>v.registry.browsers[0].name='chromium-headless-shell',v=>v.registry.browsers[0].revision='0',v=>v.registry.browsers[0].browserVersion='unknown',v=>v.registry.browsers.push(v.registry.browsers[0])]){const input=fixture();change(input);assert.throws(()=>assertLockedWriterBrowser(input));}});
test('a format probe cannot silently accept frozen catalog writes or string booleans',()=>{assert.deepEqual(assertFormatProbePolicy({}),{compactReceipts:false,imageJobs:false,frozenCatalogs:false});for(const input of [{frozenCatalogs:true},{frozenCatalogs:null},{compactReceipts:'1'},{imageJobs:1}])assert.throws(()=>assertFormatProbePolicy(input));});
test('browser socket temporary directory is private, independent of evidence depth and cleaned after launch failure',async()=>{
 const temporary=await createWriterBrowserTemporaryDirectory(process.platform==='linux'?'/tmp':tmpdir());
 try{assert.match(path.basename(temporary.directory),/^wb-[A-Za-z0-9]{6}$/);if(process.platform==='linux'){assert.ok(Buffer.byteLength(temporary.directory)<=40);assert.equal((await lstat(temporary.directory)).mode&0o777,0o700);}await writeFile(path.join(temporary.directory,'launch-failure'),'owned');}
 finally{await temporary.cleanup();}await assert.rejects(access(temporary.directory),{code:'ENOENT'});await temporary.cleanup();
});
test('browser cleanup refuses a replaced directory and leaves the replacement intact',async()=>{
 const temporary=await createWriterBrowserTemporaryDirectory(process.platform==='linux'?'/tmp':tmpdir()),moved=temporary.directory+'-original';
 await rename(temporary.directory,moved);await mkdir(temporary.directory);
 try{await assert.rejects(temporary.cleanup());await access(temporary.directory);}
 finally{await rmdir(temporary.directory);await rename(moved,temporary.directory);await temporary.cleanup();}
});
