// Exact OCI metadata probes. No application database or external provider is
// accessible; each temporary container is named, labelled and removed exactly.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {inspectIdentity} from './ci-images.mjs';
import {validateManifest} from './validate-manifest.mjs';

const command=args=>execFileSync('docker',args,{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:300000,maxBuffer:8*1024*1024});
export function observeWriterImageRoles({candidate,active}){
 validateManifest(candidate);validateManifest(active.manifest);
 const imageRoles={},roleLaunches={},owner=randomUUID(),label='bagofholding.registry-rehearsal='+owner,resources=[];
 let result,failure;
 try{
  for(const role of ['candidate','previous']){
   const manifest=role==='candidate'?candidate:active.manifest;imageRoles[role]={};roleLaunches[role]={};
   for(const component of ['backend','rulesWorker','frontend']){
    const expected=manifest.components[component],image=expected.imageDigest,launch=role==='candidate'?{releaseId:manifest.releaseId,releaseCommit:manifest.releaseCommit}:active.instances[component];
    command(['pull','--platform','linux/amd64',image]);const metadata=JSON.parse(command(['image','inspect',image]));
    assert.equal(metadata.length,1);assert.equal(metadata[0].Os,'linux');assert.equal(metadata[0].Architecture,'amd64');assert.ok(metadata[0].RepoDigests.includes(image));
    const name='boh-registry-'+randomUUID()+'-'+(component==='rulesWorker'?'worker':component);resources.push(name);
    const observed=inspectIdentity(image,{candidate:launch.releaseCommit,releaseId:launch.releaseId},{name:component==='rulesWorker'?'worker':component},{containerName:name,ownershipLabel:label,command:args=>command(args.filter(value=>value!=='--rm'))});
    if(observed.status!==undefined)assert.equal(observed.status,'ok');if(observed.timestamp!==undefined)assert.ok(Number.isSafeInteger(observed.timestamp));
    const {status,timestamp,...identity}=observed;
    assert.equal(identity.component,component);assert.equal(identity.provenance,'baked');assert.equal(identity.sourceCommit,expected.sourceCommit);assert.equal(identity.inputFingerprint,expected.inputFingerprint);
    assert.equal(identity.releaseId,launch.releaseId);assert.equal(identity.releaseCommit,launch.releaseCommit);
    imageRoles[role][component]={image,identity};roleLaunches[role][component]={...launch};
   }
  }
  result={imageRoles,roleLaunches};
 }catch(error){failure=error;}finally{
  const errors=[];
  for(const name of resources.reverse())try{
   const names=command(['container','ls','--all','--filter','name=^/'+name+'$','--format','{{.Names}}']).trim();
   if(!names)continue;assert.equal(names,name);const actual=JSON.parse(command(['container','inspect',name]))[0];assert.equal(actual.Config.Labels?.['bagofholding.registry-rehearsal'],owner);
   command(['container','rm','--force',name]);
  }catch{errors.push(name);}
  if(errors.length)failure??=Error('Owned writer metadata probes were not removed');
 }
 if(failure)throw Object.assign(Error('Immutable writer image observation failed'),{cause:failure});return result;
}
