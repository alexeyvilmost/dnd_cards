import {defineConfig,devices} from '@playwright/test';
import path from 'node:path';
import {readFileSync,realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const runId=process.env.TEST_RUN_ID??'',directory=process.env.TEST_RUN_DIRECTORY;
if(!/^test_[a-f0-9]{24}$/.test(runId)||!directory) throw Error('Use the owned browser fixture runner');
const root=realpathSync(fileURLToPath(new URL('../outputs/testing/runs/',import.meta.url)));
if(realpathSync(directory)!==path.join(root,runId)) throw Error('Invalid owned browser directory');
const registry=JSON.parse(readFileSync(path.join(directory,'registry.json'),'utf8'));
const fixture=registry.browserFixture;
if(registry.runId!==runId||registry.status!=='ready'||!fixture
  ||fixture.origin!==process.env.TEST_FIXTURE_UI_ORIGIN||fixture.proxy!==process.env.TEST_FIXTURE_PROXY
  ||fixture.profile!==process.env.TEST_FIXTURE_PROFILE) throw Error('Browser fixture registry mismatch');
for(const value of [fixture.origin,fixture.proxy]) {
  const url=new URL(value);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.pathname!=='/'||url.username||url.password||url.hash||url.search) throw Error('Owned loopback origin required');
}
const battle=fixture.profile==='battle3d';
if(!battle&&fixture.profile!=='production') throw Error('Unknown browser fixture profile');
const channel=process.env.TEST_BROWSER_CHANNEL??(process.platform==='win32'?'chrome':undefined);
export default defineConfig({
  testDir:'./e2e',forbidOnly:true,workers:1,retries:0,fullyParallel:false,timeout:120_000,
  ...(battle?{testMatch:'battle-3d.spec.ts'}:{testIgnore:'battle-3d.spec.ts'}),
  outputDir:path.join(directory,'acceptance',`ui-fixtures-${fixture.profile}`),
  reporter:[['line'],['json',{outputFile:path.join(directory,'acceptance',`playwright-fixtures-${fixture.profile}.json`)}]],
  use:{baseURL:fixture.origin,channel,trace:'off',video:'off',screenshot:'only-on-failure',
    proxy:{server:fixture.proxy},serviceWorkers:'allow',
    launchOptions:{args:['--proxy-bypass-list=<-loopback>',...(battle?['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']:[])]}},
  projects:battle?[{name:'battle3d-local',use:{viewport:{width:1440,height:1100}}}]:[
    {name:'desktop-chromium',use:{...devices['Desktop Chrome']}},
    {name:'mobile-chromium',use:{...devices['Pixel 7']}},
  ],
});
