import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,lstat,mkdir,realpath,mkdtemp,chmod,rm} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {writerBrowserPins,validateWriterBrowserRuntime} from './writer-browser-consumption.mjs';
const fileHash=async file=>{const h=createHash('sha256');for await(const bytes of createReadStream(file))h.update(bytes);return 'sha256:'+h.digest('hex');};
// Chromium creates a Unix socket below TMPDIR. Release evidence paths can be
// longer than the socket limit, so keep this private runtime outside that tree.
export async function createWriterBrowserTemporaryDirectory(base='/tmp'){
 const parent=await realpath(base),directory=await mkdtemp(path.join(parent,'wb-'));
 const owner=await lstat(directory);
 const assertOwned=async()=>{const stat=await lstat(directory);assert.ok(stat.isDirectory()&&!stat.isSymbolicLink());assert.equal(stat.dev,owner.dev);assert.equal(stat.ino,owner.ino);assert.equal(await realpath(directory),directory);assert.equal(path.dirname(directory),parent);assert.match(path.basename(directory),/^wb-[A-Za-z0-9]{6}$/);};
 try{await chmod(directory,0o700);await assertOwned();if(process.platform==='linux')assert.ok(Buffer.byteLength(directory)<=40,'Browser temporary socket path must remain short');}
 catch(error){await assertOwned();await rm(directory,{recursive:true});throw error;}
 let stopped=false;return {directory,cleanup:async()=>{if(stopped)return;await assertOwned();await rm(directory,{recursive:true});stopped=true;}};
}
export function assertLockedWriterBrowser({lock,installed,registry,platform,architecture}){
 assert.equal(platform,'linux');assert.equal(architecture,'x64');
 for(const name of ['@playwright/test','playwright','playwright-core'])assert.equal(lock.packages?.['node_modules/'+name]?.version,writerBrowserPins.playwrightVersion);
 assert.equal(installed.version,writerBrowserPins.playwrightVersion);const rows=registry.browsers.filter(row=>row.name==='chromium');assert.equal(rows.length,1);
 assert.equal(rows[0].revision,writerBrowserPins.browserRevision);assert.equal(rows[0].browserVersion,writerBrowserPins.browserVersion);return rows[0];
}
// Browser receives neither the process' GitHub/SSH/provider environment nor a
// Docker socket. Only the host-side application adapter invokes Docker.
export async function prepareWriterBrowser({repositoryRoot,directory}){
 const root=await realpath(repositoryRoot),require=createRequire(path.join(root,'frontend/package.json'));
 const core=path.dirname(require.resolve('playwright-core/package.json'));
 const [lock,installed,registry]=await Promise.all([readFile(path.join(root,'frontend/package-lock.json'),'utf8'),readFile(path.join(core,'package.json'),'utf8'),readFile(path.join(core,'browsers.json'),'utf8')]);
 assertLockedWriterBrowser({lock:JSON.parse(lock),installed:JSON.parse(installed),registry:JSON.parse(registry),platform:process.platform,architecture:process.arch});
 const {chromium}=require('@playwright/test'),executablePath=chromium.executablePath(),stat=await lstat(executablePath);assert.ok(stat.isFile()&&!stat.isSymbolicLink());
 const executableSHA256=await fileHash(executablePath);await mkdir(directory,{mode:0o700});assert.equal(await realpath(directory),path.resolve(directory));
 const home=path.join(directory,'home');await mkdir(home,{mode:0o700});
 const runtime={kind:'playwright-bundled-chromium',...writerBrowserPins,executableSHA256,runnerOS:process.platform,architecture:process.arch};validateWriterBrowserRuntime(runtime);
 const temporary=await createWriterBrowserTemporaryDirectory();
 return {runtime,launch:{executablePath,env:{PATH:process.env.PATH??'/usr/bin:/bin',HOME:home,TMPDIR:temporary.directory,LANG:'C.UTF-8'}},cleanup:temporary.cleanup,assertLaunched:async browser=>{assert.equal(browser.version(),writerBrowserPins.browserVersion);assert.equal(await fileHash(executablePath),executableSHA256);},assertUnchanged:async()=>assert.equal(await fileHash(executablePath),executableSHA256)};
}
