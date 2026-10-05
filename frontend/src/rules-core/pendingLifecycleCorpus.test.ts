import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {describe,it,expect} from 'vitest';
import {handleCommand} from './handler';
import type {PendingResolution} from './domain';
import {replayPendingCase,type PendingReplayCase} from './testing/pendingReplay.mjs';

const phases={action_cost_policy:true,attack_reaction:true,check_boost:true,concentration_save:true,
  damage_reaction:true,escape_grapple:true,event_reaction:true,hazard_save:true,magic_missile_reaction:true,
  mastery_save:true,protection_reaction:true,shove_outcome:true,slot_recovery:true,target_save:true,unarmed_save:true,
} satisfies Record<PendingResolution['type'],true>;
const base=new URL('./testing/fixtures/pending-lifecycle-v1/',import.meta.url);
const hash=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
const manifest=JSON.parse(readFileSync(new URL('manifest.json',base),'utf8'));
const compressed=readFileSync(new URL(manifest.file,base)),bytes=gunzipSync(compressed);
const compressedArtifact=readFileSync(new URL(manifest.artifactFile,base)),artifact=gunzipSync(compressedArtifact);
if(manifest.sha256!=='726929985527d894ffe6b0876aea79e2a2ed52b11fcd2eae5ef41e1c703eb726'
  ||manifest.artifactSha256!=='b63daef2388f4227b1bbea7140069d4dc2ddd5388b8ba440f0523f086ce5b064'
  ||hash(bytes)!==manifest.sha256||hash(compressed)!==manifest.compressedSha256
  ||hash(artifact)!==manifest.artifactSha256||hash(compressedArtifact)!==manifest.artifactCompressedSha256)throw Error('Frozen pending corpus or executable hash mismatch');
const corpus=JSON.parse(bytes.toString('utf8')) as {schemaVersion:number;cases:PendingReplayCase[]};
const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;

describe('saved rule continuations survive JSON reload, retry and process restart',()=>{
  it('contains every supported PendingResolution variant without replacing historical fixtures',()=>{
    expect(corpus.schemaVersion).toBe(1);expect(corpus.cases).toHaveLength(71);
    expect(Object.keys(manifest.phaseCounts).sort()).toEqual(Object.keys(phases).sort());
    expect([...new Set(corpus.cases.map((row:any)=>row.phase))].sort()).toEqual(Object.keys(phases).sort());
    for(const phase of Object.keys(phases))expect(corpus.cases.filter((row:any)=>row.phase===phase)).toHaveLength(manifest.phaseCounts[phase]);
    for(const row of corpus.cases){expect(row.world.pendingResolution?.type).toBe(row.phase);expect(row.result.status).toBe('accepted');}
  });
  it.each(corpus.cases)('$phase / $name',row=>{
    replayPendingCase(handleCommand,row);
  });
  it('the frozen executable resumes all saved cases identically in two fresh Node processes',()=>{
    const directory=mkdtempSync(path.join(tmpdir(),'pending-lifecycle-'));
    try {
      const executable=path.join(directory,'handler.cjs');writeFileSync(executable,artifact,{flag:'wx'});
      const helper=new URL('./testing/pendingReplay.mjs',import.meta.url).href;
      const program=`(async()=>{const {createHash}=require('node:crypto');const {handleCommand}=require(process.argv[1]);const {replayPendingCase}=await import(process.argv[2]);process.stdin.setEncoding('utf8');let input='';for await(const part of process.stdin)input+=part;const corpus=JSON.parse(input);const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;process.stdout.write(JSON.stringify(corpus.cases.map(row=>createHash('sha256').update(JSON.stringify(canonical(replayPendingCase(handleCommand,row)))).digest('hex'))));})().catch(error=>{console.error(error);process.exitCode=1;});`;
      const expected=corpus.cases.map((row:any)=>hash(JSON.stringify(canonical(row.result))));
      for(let restart=0;restart<2;restart++){
        const result=spawnSync(process.execPath,['-e',program,executable,helper],{input:bytes,encoding:'utf8',timeout:30000,windowsHide:true,maxBuffer:1024*1024});
        expect(result.error).toBeUndefined();expect(result.status,result.stderr).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual(expected);
      }
      expect(hash(readFileSync(executable))).toBe(manifest.artifactSha256);
    }finally{
      expect(path.dirname(directory)).toBe(path.resolve(tmpdir()));expect(path.basename(directory)).toMatch(/^pending-lifecycle-/);
      rmSync(directory,{recursive:true,force:true});
    }
  });
});
