#!/usr/bin/env node
// Only runs on the explicitly enabled trusted deployment host. Its output is
// paths to protected files, never credentials or a database snapshot.
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureHostBackup} from './capture-host-backup.mjs';
import {deploymentStateFile} from './legacy-baseline.mjs';

function assertTemplateStateBinding(config,template) {
  if(typeof config.root!=='string'||!path.isAbsolute(config.root))throw Error('Protected deployment root required');
  const root=path.resolve(config.root),allowed=[path.join(root,'active.json'),path.join(root,'legacy-state.json')];
  if(config.legacyBaselineDirectory!==undefined) {
    if(typeof config.legacyBaselineDirectory!=='string'||!path.isAbsolute(config.legacyBaselineDirectory))throw Error('Protected legacy observation directory required');
    const legacy=path.resolve(config.legacyBaselineDirectory);
    if(path.dirname(legacy)!==root||!/^legacy-observation-[A-Za-z0-9_-]+$/.test(path.basename(legacy)))throw Error('Protected legacy observation directory required');
    allowed.push(path.join(legacy,'baseline.json'));
  }
  if(!allowed.includes(template.activeStateFile))throw Error('Rehearsal state must be bound to the configured deployment root');
}

export async function prepareHostRelease({config,policy,rehearsalTemplate,captureId,capture=captureHostBackup,enabled=process.env.DEPLOY_PRODUCTION_ENABLED}) {
  if(!/^capture-[1-9]\d*-[1-9]\d*$/.test(captureId??''))throw Error('Exact workflow run and attempt identity required');
  if(rehearsalTemplate?.schemaVersion!==1||rehearsalTemplate.postgresImage!==config.postgresImage)throw Error('Rehearsal and deployment must share the pinned PostgreSQL image');
  assertTemplateStateBinding(config,rehearsalTemplate);
  if(enabled!=='true'||policy?.productionEnabled!==true)throw Error('Trusted host preparation remains disabled');
  // A saved template may predate legacy adoption. Resolve the live pointer from
  // trusted host configuration for each capture, never from candidate contents.
  const activeStateFile=deploymentStateFile(config);
  const output=path.join(config.backupDirectory,captureId);
  const captured=await capture({config,policy,output,production:true,enabled});
  if(captured?.status!=='captured'||captured.captureDirectory!==output)throw Error('Capture did not return the exact protected directory');
  if(deploymentStateFile(config)!==activeStateFile)throw Error('Active deployment state pointer changed during capture');
  const {backupDirectory:unusedBackup,captureDirectory:unusedCapture,...template}=rehearsalTemplate;
  const hostConfig=path.join(output,'deployment-config.json'),rehearsalConfig=path.join(output,'rehearsal-config.json');
  await writeFile(hostConfig,JSON.stringify({...config,backupDirectory:output},null,2)+'\n',{flag:'wx',mode:0o600});
  await writeFile(rehearsalConfig,JSON.stringify({...template,activeStateFile,captureDirectory:output},null,2)+'\n',{flag:'wx',mode:0o600});
  return {schemaVersion:1,status:'captured-awaiting-rehearsal',captureDirectory:output,hostConfig,rehearsalConfig};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const [hostFile,policyFile,templateFile,captureId,...extra]=process.argv.slice(2);
    if(!hostFile||!policyFile||!templateFile||!captureId||extra.length)throw Error('Expected host config, policy, rehearsal template and capture ID');
    const read=async file=>JSON.parse(await readFile(file,'utf8'));
    const result=await prepareHostRelease({config:await read(hostFile),policy:await read(policyFile),rehearsalTemplate:await read(templateFile),captureId});
    process.stdout.write(`capture_directory=${result.captureDirectory}\nhost_config=${result.hostConfig}\nrehearsal_config=${result.rehearsalConfig}\n`);
  } catch {process.stderr.write('Trusted host preparation failed; retain protected partial capture for inspection.\n');process.exitCode=1;}
}
