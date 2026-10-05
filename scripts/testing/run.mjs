#!/usr/bin/env node
import {readFileSync, existsSync} from 'node:fs';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createPlan} from '../release/plan-components.mjs';
import {readSuites, selectGroups, catalogTests, resolveGoTests, verifyVitestResult, verifyNodeResult, verifyPlaywrightResult, hash} from './suites.mjs';
import {startTestStack} from './stack.mjs';
import {runRequiredGo} from './required-go.mjs';
import {compileGoPackages, listGoTests} from './go-test-list.mjs';
import {captureSourceSnapshot, verifySourceSnapshot, assertCleanCICheckout} from './source-snapshot.mjs';
import {execute, repositoryRoot, cleanEnvironment, resolveTool} from './runtime.mjs';
import {shardPlan,assignShard,assertShardCoverage} from './shards.mjs';
import {suiteWorkload} from './workload.mjs';
import {safeNodeFailureDiagnostics} from './node-failure-diagnostics.mjs';
import {safeVitestFailureDiagnostics} from './vitest-failure-diagnostics.mjs';
import {supplementVitestFailureDiagnostics} from './vitest-suite-error-reporter.mjs';

export function suiteOptions(args) {
  const result = {suite:'core', mode:'local', candidate:'HEAD'};
  for (let i=0; i<args.length; i++) {
    const flag = args[i];
    if (['--full','--plan-only','--reuse-ui-build','--race'].includes(flag)) result[flag.slice(2)] = true;
    else if (['--suite','--base','--candidate','--mode','--select','--output','--go','--pg-bin','--shard'].includes(flag) && args[i+1] && !args[i+1].startsWith('--')) result[flag.slice(2)] = args[++i];
    else throw Error(`Unknown or incomplete argument: ${flag}`);
  }
  if (!['local','ci'].includes(result.mode)) throw Error('Test runner supports local or ci planning only');
  if (result.mode === 'ci' && result['reuse-ui-build']) throw Error('CI must build current UI sources');
  if(result.shard&&(result.suite==='legacy-manual'||result['reuse-ui-build']))throw Error('Shards require mandatory suites and private fresh builds');
  if(result.race&&process.platform!=='linux')throw Error('The supported Go race profile requires Linux and a C toolchain');
  return result;
}

export async function runSuite(argv) {
  const args = suiteOptions(argv), started = Date.now();
  const {manifest, hash: manifestHash} = readSuites();
  const plan = createPlan({repo:repositoryRoot, mode:args.mode, base:args.base, candidate:args.candidate, full:args.full});
  const selection = selectGroups(manifest, plan, {suite:args.suite, select:args.select});
  const catalog = catalogTests(manifest);
  const directory = path.resolve(repositoryRoot, args.output ?? `outputs/testing/suites/${Date.now()}-${randomUUID()}`);
  await mkdir(directory, {recursive:true});
  const report = {schema_version:1, status:'planned', suite:args.suite, started_at:new Date(started).toISOString(),
    candidate:plan.candidate, manifest_sha256:manifestHash, component_plan:plan, selection, checks:[],
    versions:{node:process.version}, go_race:args.race===true, fixture:null, limitations:[], directory};
  const save = async () => {report.duration_ms = Date.now()-started; await writeFile(path.join(directory,'report.json'), JSON.stringify(report,null,2));};
  await writeFile(path.join(directory,'test-catalog.json'), JSON.stringify(catalog,null,2));
  await save();
  if (args['plan-only']) {console.log(`Planned ${selection.selected.length} groups; ${directory}`); return;}
  let stack;
  let sourceSnapshot;
  const environment = cleanEnvironment({...(process.env.CI ? {CI:process.env.CI} : {})});
  async function check(id, action) {
    const step = {id, status:'running', started_at:new Date().toISOString()}, at=Date.now();
    report.checks.push(step); await save(); console.log(`Checking ${id}...`);
    try {step.result = await action(); step.status='passed';}
    catch (error) {step.status='failed'; step.reason=error.message; if(error.nodeDiagnostics||error.browserDiagnostics||error.vitestDiagnostics)step.diagnostics=error.nodeDiagnostics??error.browserDiagnostics??error.vitestDiagnostics; throw error;}
    finally {step.duration_ms=Date.now()-at; await save();}
  }
  const invoke = (id, executable, argv, settings={}) => execute(executable,argv,{env:environment,log:path.join(directory,`${id}.log`),...settings});
  const invokeNodeTests = async (id, files, settings={}) => {
    try {return verifyNodeResult(await invoke(id,process.execPath,['--test','--test-reporter=tap',...files],{timeout:900_000,...settings}));}
    catch(error){error.nodeDiagnostics=safeNodeFailureDiagnostics(error.output,{files,root:repositoryRoot});throw error;}
  };
  try {
    report.status='running';
    await check('source-hygiene', async () => {
      await invoke('diff', 'git',['diff','--check']);
      await invoke('diff-staged', 'git',['diff','--cached','--check']);
      await invoke('database-dumps',process.execPath,['scripts/security/check-no-database-dumps.mjs']);
      await invoke('known-credentials',process.execPath,['scripts/security/check-no-known-credentials.mjs']);
      if(args.mode==='ci')report.ci_source=assertCleanCICheckout();
      sourceSnapshot=captureSourceSnapshot();
      if(sourceSnapshot.head!==plan.candidate.sha)throw Error('HEAD changed after suite planning; restart the run');
      await writeFile(path.join(directory,'source-snapshot.json'),JSON.stringify(sourceSnapshot,null,2));
      report.source_snapshot={sha256:sourceSnapshot.sha256,files:sourceSnapshot.files.length};
      const diff=execFileSync('git',['diff','HEAD','--binary'],{cwd:repositoryRoot,maxBuffer:64*1024*1024,stdio:['ignore','pipe','pipe']});
      // Keep only the hash of tracked content; untracked source hashes below do
      // not read env files, user output, arbitrary artwork or local snapshots.
      const extra=plan.changed_files.filter(file => /^(?:frontend|backend|scripts|tests|infra)\//.test(file)
        && /\.(?:[cm]?[jt]sx?|go|json|ya?ml|sql|ps1|sh)$/.test(file) && !/(?:^|\/)(?:node_modules|dist|output|outputs|tmp|\.env)(?:\/|$)/.test(file)
        && existsSync(path.join(repositoryRoot,file))).map(file=>({file,sha256:hash(readFileSync(path.join(repositoryRoot,file)))}));
      report.worktree={tracked_diff_sha256:hash(diff),source_files:extra};
      report.lockfiles=Object.fromEntries(['frontend/package-lock.json','backend/go.sum'].map(file=>[file,hash(readFileSync(path.join(repositoryRoot,file)))]));
      return {status:'passed'};
    });
    let {nodeFiles,vitestFiles,goGroups,scripts,browserGroups,gates,fixtureFiles}=suiteWorkload({selection,catalog,manifest,suite:args.suite,select:args.select});
    let owns=()=>true;
    const completed=[];
    if(args.shard){
      report.shard=assignShard(shardPlan({suite:args.suite,nodeFiles,vitestFiles,goGroups,scripts,browserGroups,gates,fixtureFiles}),args.shard);
      report.coverage={completed};owns=id=>report.shard.assigned.includes(id);
      nodeFiles=nodeFiles.filter(file=>owns(`node:${file}`));vitestFiles=vitestFiles.filter(file=>owns(`vitest:${file}`));
      goGroups=goGroups.filter(group=>owns(args.suite==='extended'?'go:all-local-packages':`go:${group.package}`));
      scripts=scripts.filter(group=>owns(`script:${group.id}`));browserGroups=browserGroups.filter(group=>owns(`browser:${group.id}`));
      gates=gates.filter(gate=>owns(`gate:${gate.id}`));fixtureFiles=fixtureFiles.filter(file=>owns(`fixture:${file==='frontend/e2e/battle-3d.spec.ts'?'battle3d':'production'}`));
      await save();
    }
    const done=ids=>{if(args.shard)completed.push(...ids);};
    const needsStack=scripts.length>0||browserGroups.length>0||gates.length>0||fixtureFiles.length>0||nodeFiles.some(file=>file.startsWith('frontend/worker/')||file.endsWith('.integration.test.mjs'));
    // Run infrastructure tests before paying the cost of a production build.
    const preflight=nodeFiles.filter(file=>!file.startsWith('frontend/worker/')&&!file.endsWith('.integration.test.mjs'));
    if (preflight.length) {await check('node-contracts',()=>invokeNodeTests('node-contracts',preflight));done(preflight.map(file=>`node:${file}`));}
    if (needsStack||goGroups.length) {
      await check('isolated-stack',async()=>{
        stack=await startTestStack({dbOnly:!needsStack,profile:'integration',isolatedBuild:Boolean(args.shard),reuseBuild:args['reuse-ui-build']===true,go:args.go,pgBin:args['pg-bin'],equipmentIntent:args.suite==='extended',initiativeOptions:args.suite==='extended',workerMirrors:args.suite==='extended',catalogBatch:args.suite==='extended',preparationCache:args.suite==='extended',performance:args.suite==='extended'});
        stack.env.OAUTH_TEST_DSN=stack.database.dsn;
        if(args.race){stack.env.TEST_GO_RACE='1';stack.env.CGO_ENABLED='1';}
        stack.env.CONTENT_MIGRATION_TEST_BOOTSTRAP='1';
        // Each named helper creates its own schema. Historical clone/preimage
        // profiles are deliberately absent from this allowlist.
        for (const name of ['ACCOUNT_ADMIN_268_TEST_DSN','ANIMATION_TEST_DATABASE_URL','AUDIO_TEST_DATABASE_URL',
          'EFFECT_CLASSIFICATION_TEST_DATABASE_URL','ENTITY_REFERENCE_TEST_DATABASE_URL','ITEM_SOURCE_262_TEST_DSN',
          'OWNED_ITEM_265_TEST_DSN','PAPER_DOCUMENT_266_TEST_DSN','ROGUELIKE_MIGRATION_TEST_DSN']) stack.env[name]=stack.database.dsn;
        report.fixture={run_id:stack.registry.runId,profile:stack.registry.fixture,artifact_hash:stack.registry.artifactHash,ui_build:stack.registry.uiBuild};
        return {run_id:stack.registry.runId,mode:needsStack?'integration':'database-only'};
      });
    }
    if (vitestFiles.length) await check('vitest',async()=>{
      const selectionFile=path.join(directory,'vitest-selection.json'), resultFile=path.join(directory,'vitest-result.json');
      const diagnosticsFile=path.join(directory,'vitest-suite-errors.json'), diagnosticsSettingsFile=path.join(directory,'vitest-diagnostics-settings.json');
      const diagnosticSettings={root:repositoryRoot,files:vitestFiles,runId:randomUUID(),outputFile:diagnosticsFile};
      await writeFile(selectionFile,JSON.stringify(vitestFiles.map(file=>file.replace(/^frontend\//,''))));
      await writeFile(diagnosticsSettingsFile,JSON.stringify(diagnosticSettings),{mode:0o600});
      try {
        await invoke('vitest',process.execPath,['node_modules/vitest/vitest.mjs','run','--config','vitest.suites.config.ts','--reporter=json',`--reporter=${path.join(repositoryRoot,'scripts/testing/vitest-suite-error-reporter.mjs')}`,`--outputFile=${resultFile}`],{
          cwd:path.join(repositoryRoot,'frontend'),env:{...environment,TEST_VITEST_SELECTION:selectionFile,TEST_VITEST_DIAGNOSTICS_SETTINGS:diagnosticsSettingsFile},timeout:3_600_000});
        return verifyVitestResult(JSON.parse(readFileSync(resultFile,'utf8')),vitestFiles);
      } catch(error) {
        try {error.vitestDiagnostics=safeVitestFailureDiagnostics(JSON.parse(readFileSync(resultFile,'utf8')),{files:vitestFiles,root:repositoryRoot});} catch { /* Preserve the original failure when no usable report exists. */ }
        try {error.vitestDiagnostics=supplementVitestFailureDiagnostics(JSON.parse(readFileSync(resultFile,'utf8')),JSON.parse(readFileSync(diagnosticsFile,'utf8')),diagnosticSettings);} catch { /* Missing, stale or malformed supplement cannot replace the original failure or JSON diagnostics. */ }
        throw error;
      }
    });
    done(vitestFiles.map(file=>`vitest:${file}`));
    const remainingNode=nodeFiles.filter(file=>!preflight.includes(file));
    if (remainingNode.length) await check('worker-and-database-node',async()=>{
      if (!needsStack&&remainingNode.some(file=>file.startsWith('frontend/worker/'))) await invoke('worker-build',process.execPath,['frontend/worker/build.mjs']);
      return invokeNodeTests('worker-and-database-node',remainingNode,{env:stack?.env??environment});
    });
    done(remainingNode.map(file=>`node:${file}`));
    if (goGroups.length) {
      const go=resolveTool('go',args.go);
      report.versions.go=(await invoke('go-version',go,['version'])).trim();
      await check('backend-compile',async()=>{const discovery=await compileGoPackages({invoke,go,settings:{cwd:path.join(repositoryRoot,'backend'),env:stack.env,signal:stack.signal,timeout:600_000}});return {compiled:true,tests_executed:false,discovery};});
      const packages=args.suite==='extended' ? (await invoke('go-packages',go,['list','./...'],{cwd:path.join(repositoryRoot,'backend'),env:stack.env})).trim().split('\n').map(name=>name.trim()).filter(Boolean) : [...new Set(goGroups.map(group=>group.package))];
      const moduleName=readFileSync(path.join(repositoryRoot,'backend/go.mod'),'utf8').match(/^module\s+(\S+)/m)[1];
      for (const packageName of packages) {
        const packagePath=packageName.startsWith('.')?packageName:'.'+packageName.slice(moduleName.length);
        const id=`go-${packagePath==='.'?'backend':packagePath.slice(2).replaceAll('/','-')}`;
        await check(id,async()=>{
          const discovery=await listGoTests({invoke,id,go,packagePath,packageName:moduleName+(packagePath==='.'?'':packagePath.slice(1)),settings:{cwd:path.join(repositoryRoot,'backend'),env:stack.env,signal:stack.signal}});
          const names=discovery.output.split(/\r?\n/).filter(line=>/^Test[A-Za-z0-9_]+$/.test(line));
          const prefixes=goGroups.filter(group=>group.package===packagePath).flatMap(group=>group.prefixes);
          if (!names.length&&args.suite==='extended'&&!prefixes.length) return {no_tests_in_package:true};
          const manualCases=manifest.legacy_manual.flatMap(group=>group.go_cases??[]).filter(row=>row.package===packagePath);
          const dedicatedCases=(manifest.dedicated_go_routes??[]).filter(row=>row.package===packagePath);
          const tests=args.suite==='extended'?names.filter(name=>![...manualCases,...dedicatedCases].some(row=>row.test===name)):resolveGoTests(names,prefixes);
          if (prefixes.length) resolveGoTests(names,prefixes);
          if (args.suite==='extended') report.manual_go_cases=manifest.legacy_manual.flatMap(group=>group.go_cases??[]);
          return {...await runRequiredGo(stack,{tests,packagePath,go}),discovery:{attempts:discovery.attempts,...(discovery.retryReason?{retryReason:discovery.retryReason}:{})}};
        });
        if(args.suite!=='extended')done([`go:${packagePath}`]);
      }
      if(args.suite==='extended')done(['go:all-local-packages']);
    }
    for (const group of scripts) {await check(group.id,async()=>{await invoke(group.id,process.execPath,[group.file],{env:stack.env,timeout:600_000});return {exit_code:0,contract:group.contract};});done([`script:${group.id}`]);}
    for (const group of browserGroups) await check(group.id,async()=>{
      await invoke(group.id,process.execPath,['frontend/node_modules/@playwright/test/cli.js','test','--config=frontend/playwright.local.config.ts',...group.files],{
        env:{...stack.env,...(args.mode==='ci'?{TEST_BROWSER_CHANNEL:'chrome'}:{})},timeout:1_200_000});
      const result=verifyPlaywrightResult(JSON.parse(readFileSync(path.join(stack.registry.directory,'acceptance/playwright.json'),'utf8')),group.files);done([`browser:${group.id}`]);return result;
    });
    if (args.suite==='extended') {
      for (const gate of gates) await check(gate.id,async()=>{
        const module=await import(new URL(`../../${gate.script}`,import.meta.url));
        if(typeof module[gate.export]!=='function')throw Error(`Missing required gate export: ${gate.id}`);
        const result=await module[gate.export](stack,gate.options??{},{go:args.go,pgBin:args['pg-bin']});done([`gate:${gate.id}`]);return result;
      });
      const {checkBrowserFixtures}=await import('./browser-fixtures.mjs');
      for(const profile of ['production','battle3d']) {
        const files=fixtureFiles.filter(file=>(file==='frontend/e2e/battle-3d.spec.ts')===(profile==='battle3d'));
        if(files.length) {await check(`browser-ui-fixtures-${profile}`,()=>checkBrowserFixtures(stack,files,{ci:args.mode==='ci',profile}));done([`fixture:${profile}`]);}
      }
    }
    if(args.shard)assertShardCoverage(report.shard,completed);
    await check('source-stability',async()=>{
      const after=captureSourceSnapshot();
      try{return verifySourceSnapshot(sourceSnapshot,after);}
      catch(error){report.source_drift={changed_files:error.changedFiles,head_changed:error.headChanged};throw error;}
    });
    report.status='passed';
  } catch(error) {
    report.status='failed'; report.failure=error.message; process.exitCode=1;
  } finally {
    if (stack) {try {await stack.cleanup(); report.cleanup={status:stack.registry.status,errors:stack.registry.cleanupErrors??[]};}
      catch(error) {report.status='failed';report.cleanup={error:error.message};process.exitCode=1;}}
    else if(args.shard)report.cleanup={status:'not-required',errors:[]};
    await save(); console.log(`${report.status.toUpperCase()}: ${directory}`);
  }
  return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runSuite(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
