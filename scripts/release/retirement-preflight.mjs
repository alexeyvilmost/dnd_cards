#!/usr/bin/env node
// Read-only local bundle inspection; deliberately no production/run command.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyLocalRetirementArtifacts} from './retirement-artifacts.mjs';
export async function main(args){
 if(args.length!==2||args[0]!=='inspect')throw Error('Usage: retirement-preflight.mjs inspect LOCAL_BUNDLE_DIRECTORY');
 const plan=await verifyLocalRetirementArtifacts(path.resolve(args[1]));
 process.stdout.write(JSON.stringify(plan,null,2)+'\n');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(()=>{process.stderr.write('Local retirement preflight refused; no database operation executed.\n');process.exitCode=1;});
