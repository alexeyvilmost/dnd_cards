import {startTestStack} from './stack.mjs';
import {checkBrowserFixtures} from './browser-fixtures.mjs';
import {readSuites,catalogTests} from './suites.mjs';

async function main() {
const args=process.argv.slice(2),reuseBuild=args.includes('--reuse-ui-build');
const profile=args.includes('--battle3d')?'battle3d':'production';
const selected=args.filter(arg=>!arg.startsWith('--'));
if(args.some(arg=>arg.startsWith('--')&&!['--reuse-ui-build','--battle3d'].includes(arg))) throw Error('Unknown UI fixture option');
const files=catalogTests(readSuites().manifest).filter(row=>row.runner==='playwright'&&row.file.startsWith('frontend/e2e/')
  &&(row.file==='frontend/e2e/battle-3d.spec.ts')===(profile==='battle3d')).map(row=>row.file);
if(selected.some(file=>!files.includes(file))) throw Error('Unknown owned UI fixture file');
const stack=await startTestStack({profile:'integration',reuseBuild});
try {console.log(JSON.stringify({runId:stack.registry.runId,profile,result:await checkBrowserFixtures(stack,selected.length?selected:files,{profile})}));}
finally {await stack.cleanup();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
