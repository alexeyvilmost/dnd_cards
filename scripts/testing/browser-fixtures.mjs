import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {startTestUI} from './ui-server.mjs';
import {localAcceptanceContext} from './acceptance-context.mjs';
import {browserPerformanceProxy} from '../performance/browser-proxy.mjs';
import {repositoryRoot, execute, writeRegistry, cleanEnvironment} from './runtime.mjs';
import {verifyPlaywrightResult} from './suites.mjs';

// The UI-fixture layer has no API upstream. Even an unhandled request or a
// service worker cannot write to the owned real database (or another service).
export async function checkBrowserFixtures(stack, files, {ci=false, profile='production'}={}) {
  await localAcceptanceContext(stack.env);
  if (!['production','battle3d'].includes(profile) || !files.length || files.some(file=>!/^frontend\/e2e\/[^/]+\.spec\.ts$/.test(file))) throw Error('Invalid browser fixture selection');
  const frontend=path.join(repositoryRoot,'frontend');
  let server,proxy,origin;
  try {
    if (profile==='production') {
      if(!stack.registry.uiBuild?.directory) throw Error('UI fixtures require a per-run immutable build directory');
      server=await startTestUI({root:stack.registry.uiBuild.directory,fixtureOnly:true,cacheAssets:true});
      origin=`http://127.0.0.1:${server.address().port}`;
    } else {
      const {createServer}=await import(pathToFileURL(path.join(frontend,'node_modules/vite/dist/node/index.js')));
      const require=createRequire(path.join(frontend,'package.json'));
      const {default:tailwindcss}=await import(pathToFileURL(require.resolve('tailwindcss')));
      const {default:autoprefixer}=await import(pathToFileURL(require.resolve('autoprefixer')));
      const {default:tailwind}=await import(pathToFileURL(path.join(frontend,'tailwind.config.js')));
      const vite=await createServer({root:frontend,configFile:false,envDir:false,mode:'test',
        cacheDir:path.join(stack.registry.directory,'vite-fixture-cache'),
        optimizeDeps:{entries:['e2e/fixtures/battle-3d-preview.html'],include:['react/jsx-dev-runtime','react/jsx-runtime','react','react-dom/client','react-dom','@react-three/fiber','three','axios']},
        css:{postcss:{plugins:[tailwindcss({...tailwind,content:[path.join(frontend,'src/**/*.{js,ts,jsx,tsx}')]}),autoprefixer()]}},
        plugins:[{name:'fixture-api-deny',configureServer(instance){instance.middlewares.use((req,res,next)=>{
          if(req.url.startsWith('/api/')) {res.statusCode=503;res.end('API unavailable in dev UI fixture');} else next();
        });}}],
        server:{host:'127.0.0.1',port:0,strictPort:true,hmr:false,watch:null,fs:{strict:true,allow:[repositoryRoot]}}});
      await vite.listen(); server={close:()=>vite.close()};
      origin=`http://127.0.0.1:${vite.httpServer.address().port}`;
    }
    proxy=await browserPerformanceProxy([origin]);
    stack.registry.browserFixture={profile,origin,proxy:proxy.server};await writeRegistry(stack.registry);
    const reportFile=path.join(stack.registry.directory,'acceptance',`playwright-fixtures-${profile}.json`);
    await execute(process.execPath,['frontend/node_modules/@playwright/test/cli.js','test','--config=frontend/playwright.fixtures.config.ts',...files],{
      env:cleanEnvironment({TEST_RUN_ID:stack.env.TEST_RUN_ID,TEST_RUN_DIRECTORY:stack.env.TEST_RUN_DIRECTORY,
        TEST_FIXTURE_UI_ORIGIN:origin,TEST_FIXTURE_PROXY:proxy.server,TEST_FIXTURE_PROFILE:profile,...(ci?{CI:'1',TEST_BROWSER_CHANNEL:'chrome'}:{})}),
      log:path.join(stack.registry.directory,`browser-fixtures-${profile}.log`),timeout:3_600_000});
    return verifyPlaywrightResult(JSON.parse(await readFile(reportFile,'utf8')),files);
  } finally {
    if(proxy) await proxy.close();
    if(server) {
      if(profile==='production'){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
      else await server.close();
    }
    delete stack.registry.browserFixture;await writeRegistry(stack.registry);
  }
}
