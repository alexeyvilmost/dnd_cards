// Real Docker boundary for the distinct frontend-only journal. It cannot dump,
// restore, migrate, scan DB references, start backend/worker or delete stores.
import {execFileSync} from 'node:child_process';import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {evidenceHash} from './validate-manifest.mjs';import {validateActive} from './deploy-state.mjs';
import {observeUIHost,assertProtectedPath} from './ui-host-observation.mjs';import {readProtectedFullAnchor} from './ui-host-anchor.mjs';
import {retainImmutableAssets} from './retained-assets.mjs';import {inspectIdentity} from './ci-images.mjs';
const same=(a,b)=>evidenceHash(a)===evidenceHash(b);
function command(args){try{return execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:310_000,maxBuffer:8*1024*1024}).trim();}
  catch(error){throw Object.assign(Error('Selective Docker step failed; inspect protected diagnostics'),{code:'selective-docker-failed',uncertainOutcome:!!error.signal||['ETIMEDOUT','ENOBUFS'].includes(error.code)});}}
export function frontendComposition(original,state){
  validateActive(state);const next=structuredClone(original);
  if(!next.services?.frontend||!next.services.backend||!next.services['rules-worker'])throw Error('Original full composition missing application services');
  for(const [name,key] of [['backend','backend'],['rules-worker','rulesWorker']]){
    const service=next.services[name],instance=state.instances[key];
    if(service.image!==state.manifest.components[key].imageDigest||service.environment?.RELEASE_ID!==instance.releaseId
      ||service.environment.RELEASE_COMMIT!==instance.releaseCommit)throw Error('Protected runtime differs from original full composition');
  }
  next.services.frontend.image=state.manifest.components.frontend.imageDigest;
  next.services.frontend.environment={...next.services.frontend.environment,RELEASE_ID:state.instances.frontend.releaseId,RELEASE_COMMIT:state.instances.frontend.releaseCommit};
  return next;
}
export async function createDockerFrontendAdapter(config,{authorized=false,command:run=command,identityProbe=inspectIdentity}={}){
  if(!authorized||config.frontendSelectiveEnabled!==true)throw Error('Frontend selective host operation is not enabled');
  return createObservedFrontendBoundary(config,await readProtectedFullAnchor(config),{command:run,identityProbe});
}
// Execution core, not an authorization API. Production uses the protected
// constructor above; a local owned-boundary drill may supply its own truthful
// observation without manufacturing GitHub/full-adoption approval evidence.
export function createObservedFrontendBoundary(config,{document,runtime},{command:run=command,identityProbe=inspectIdentity}={}){
  const root=path.resolve(config.root);assertProtectedPath(root,config.assetDirectory,{directory:true});
  const observed=(state,protectedOnly=false)=>observeUIHost(config,state,{run,protectedOnly});
  const permitted=new Map();
  function composeFile(state){
    const hash=evidenceHash(state);if(!permitted.has(hash))throw Error('Composition was not prepared by this selective adapter');
    const file=permitted.get(hash);assertProtectedPath(root,file);
    if(!same(JSON.parse(readFileSync(file,'utf8')),frontendComposition(runtime,state)))throw Error('Prepared selective composition changed');
    return file;
  }
  function retainDocument(state){
    const directory=path.join(root,'frontend-releases',state.manifest.releaseId);mkdirSync(directory,{recursive:true,mode:0o700});assertProtectedPath(root,directory,{directory:true});
    const file=path.join(directory,'compose.runtime.json'),value=frontendComposition(runtime,state),bytes=JSON.stringify(value,null,2)+'\n';
    if(existsSync(file)){assertProtectedPath(root,file);if(readFileSync(file,'utf8')!==bytes)throw Error('Immutable selective composition collision');}
    else writeFileSync(file,bytes,{flag:'wx',mode:0o600});permitted.set(evidenceHash(state),file);return file;
  }
  async function retain(state,label){
    const name='ui-extract-'+randomUUID(),owner=evidenceHash({root,name,releaseId:state.manifest.releaseId});
    const directory=path.join(root,'frontend-releases',state.manifest.releaseId,'extract-'+label);
    try{
      const id=run(['create','--name',name,'--label','bagofholding.ui-extract='+owner,'--network','none','--entrypoint','/bin/true',state.manifest.components.frontend.imageDigest]);
      if(!/^[a-f0-9]{64}$/.test(id))throw Error('Owned frontend extraction container required');
      mkdirSync(directory,{recursive:true,mode:0o700});assertProtectedPath(root,directory,{directory:true});
      run(['cp',`${id}:/usr/share/nginx/html/.`,directory]);
    }finally{
      // The name exists before create: even a lost create response is owned and
      // discoverable. Inspection/cleanup failure must fail preparation.
      const ids=run(['ps','-aq','--filter',`name=^/${name}$`]).split(/\s+/).filter(Boolean);
      if(ids.length>1)throw Error('Ambiguous owned frontend extraction');
      for(const id of ids){const found=JSON.parse(run(['inspect',id]))[0];
        if(found.Name!=='/'+name||found.Config?.Labels?.['bagofholding.ui-extract']!==owner)throw Error('Frontend extraction ownership changed');
        run(['rm',id]);}
    }
    return retainImmutableAssets(directory,config.assetDirectory);
  }
  return {
    protectedAnchor:document,observe:state=>observed(state),observeProtected:state=>observed(state,true),
    async prepare(plan){
      if(plan.kind!=='frontend-only'||!same(plan.changed,['frontend'])||plan.anchor.runtimeCompatibilityHash!==document.binding.runtimeCompatibilityHash
        ||!same(plan.anchor,document.binding))throw Error('Actual protected full anchor differs from selective plan');
      retainDocument(plan.previous);retainDocument(plan.desired);
      // Only the new frontend is pulled. The original retained frontend must
      // already exist and is inspected/extracted without pulling other images.
      run(['pull',plan.desired.manifest.components.frontend.imageDigest]);
      for(const state of [plan.previous,plan.desired]){
        const component=state.manifest.components.frontend,instance=state.instances.frontend;
        const identity=identityProbe(component.imageDigest,{candidate:instance.releaseCommit,releaseId:instance.releaseId},{name:'frontend'});
        if(identity.component!=='frontend'||identity.provenance!=='baked'||identity.sourceCommit!==component.sourceCommit
          ||identity.inputFingerprint!==component.inputFingerprint||identity.apiProtocolVersion!==state.manifest.apiProtocolVersion
          ||identity.releaseId!==instance.releaseId||identity.releaseCommit!==instance.releaseCommit)throw Error('Actual frontend image identity differs');
      }
      await retain(plan.previous,'previous');await retain(plan.desired,'candidate');
      return {status:'prepared',anchorHash:evidenceHash(document),changed:['frontend'],databaseSnapshot:'not-created'};
    },
    allowRecovery(operation){
      if(operation.kind!=='frontend-only'||!same(operation.plan.anchor,document.binding)||!same(operation.plan.changed,['frontend']))throw Error('Selective recovery anchor differs');
      for(const state of [operation.plan.previous,operation.plan.desired]){
        const file=path.join(root,'frontend-releases',state.manifest.releaseId,'compose.runtime.json');assertProtectedPath(root,file);
        if(!same(JSON.parse(readFileSync(file,'utf8')),frontendComposition(runtime,state)))throw Error('Selective recovery composition changed');permitted.set(evidenceHash(state),file);
      }
    },
    async replaceFrontend(state){
      const file=composeFile(state);
      run(['compose','--project-name',config.project,'-f',file,'up','-d','--no-deps','--no-build','--pull','never','--wait','frontend']);
    },
  };
}
