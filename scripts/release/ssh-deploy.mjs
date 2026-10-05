#!/usr/bin/env node
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {deployOverSSH} from './ssh-transport.mjs';
export function requestFromEnvironment(env){return {schemaVersion:1,controlCommit:env.GITHUB_SHA,sourceCommit:env.SOURCE_SHA,
  repository:env.GITHUB_REPOSITORY,actor:env.GITHUB_ACTOR,eventName:env.GITHUB_EVENT_NAME,mode:env.DEPLOY_MODE,
  runId:env.GITHUB_RUN_ID,attempt:env.GITHUB_RUN_ATTEMPT,attemptRoot:env.DEPLOY_SSH_ATTEMPT_ROOT,
  hostConfig:env.DEPLOY_HOST_CONFIG_FILE,rehearsalConfig:env.REHEARSAL_CONFIG_FILE,nodePath:env.DEPLOY_SSH_NODE,
  productionEnabled:env.PRODUCTION_DEPLOY_ENABLED};}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const [controlDirectory,candidateDirectory,outputDirectory,...extra]=process.argv.slice(2);if(!controlDirectory||!candidateDirectory||!outputDirectory||extra.length)throw Error('Expected control, candidate and public receipt directories');
    const result=await deployOverSSH({controlDirectory:path.resolve(controlDirectory),candidateDirectory:path.resolve(candidateDirectory),outputDirectory:path.resolve(outputDirectory),request:requestFromEnvironment(process.env),
      endpoint:{host:process.env.DEPLOY_SSH_HOST,user:process.env.DEPLOY_SSH_USER,port:Number(process.env.DEPLOY_SSH_PORT||22)},
      privateKey:process.env.DEPLOY_SSH_PRIVATE_KEY,knownHosts:process.env.DEPLOY_SSH_KNOWN_HOSTS,token:process.env.GITHUB_TOKEN});
    process.stdout.write(JSON.stringify(result)+'\n');
  }catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
}
