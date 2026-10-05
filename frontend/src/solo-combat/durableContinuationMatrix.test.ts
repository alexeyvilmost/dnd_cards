import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {describe,expect,it} from 'vitest';
import * as engine from './engine';
import {replayDurableCase,type DurableReplayCase} from './testing/durableReplay.mjs';
import {durableContinuationFields,durableD20Operations,durableD20Timings,durableTriggeredEvents,durableDeathSavePhases} from './testing/durableContinuationMatrix';
import type {SoloCombatState} from './types';

const base=new URL('./testing/fixtures/durable-continuations-v1/',import.meta.url);
const hash=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
const manifest=JSON.parse(readFileSync(new URL('manifest.json',base),'utf8'));
const compressed=readFileSync(new URL(manifest.file,base)),bytes=gunzipSync(compressed);
const artifactCompressed=readFileSync(new URL(manifest.artifactFile,base)),artifact=gunzipSync(artifactCompressed);
if(manifest.sha256!=='d1741084ee1b348b77556e0fd69a01d21e09ab9ea4988b66401c9f933d781a25'
  ||manifest.artifactSha256!=='6fa90f5234a9f2eaeffea24720ce684d56d11104c6016780f326bdc8a5f67e46'
  ||hash(bytes)!==manifest.sha256||hash(compressed)!==manifest.compressedSha256
  ||hash(artifact)!==manifest.artifactSha256||hash(artifactCompressed)!==manifest.artifactCompressedSha256)throw Error('Immutable durable continuation corpus or executable changed');
const corpus=JSON.parse(bytes.toString('utf8')) as {schemaVersion:number;cases:DurableReplayCase[]};
const inputState=(row:DurableReplayCase)=>{const first=row.args[0] as {world?:unknown;state:SoloCombatState};return (first.world?first:first.state) as SoloCombatState;};
const unique=(values:unknown[])=>[...new Set(values)].sort();

describe('durable board continuations retain canonical state across JSON reload and process restart',()=>{
  it('covers every persisted continuation field and supported choice discriminator',()=>{
    expect(corpus.schemaVersion).toBe(1);expect(corpus.cases).toHaveLength(222);
    expect(unique(corpus.cases.flatMap(row=>row.phases))).toEqual(Object.keys(durableContinuationFields).sort());
    for(const phase of Object.keys(durableContinuationFields))expect(corpus.cases.filter(row=>row.phases.includes(phase as keyof typeof durableContinuationFields))).toHaveLength(manifest.phaseCounts[phase]);
    const states=corpus.cases.map(inputState),interrupts=states.flatMap(state=>state.pendingD20Interrupt?[state.pendingD20Interrupt]:[]);
    expect(unique(interrupts.map(row=>row.operation))).toEqual(Object.keys(durableD20Operations).sort());
    expect(unique(interrupts.map(row=>row.timing))).toEqual(Object.keys(durableD20Timings).sort());
    // Critical is an option event in a hit window; it is not a separate reroll.
    expect(unique(states.flatMap(state=>state.pendingTriggeredAction?[state.pendingTriggeredAction.event,...Object.values(state.pendingTriggeredAction.optionEvents??{})]:[]))).toEqual(Object.keys(durableTriggeredEvents).sort());
    expect(unique(states.flatMap(state=>state.pendingDeathSave?[state.pendingDeathSave.phase]:[]))).toEqual(Object.keys(durableDeathSavePhases).sort());
    expect(states.some(state=>state.pendingAdditionalMovement?.interrupted?.pendingMovementStep)).toBe(true);
    expect(states.some(state=>state.playerMovement&&state.pendingMovementStep&&state.world.pendingResolution)).toBe(true);
    expect(states.some(state=>state.monsterAttackSequence&&state.world.pendingResolution)).toBe(true);
    expect(states.some(state=>state.pendingCombatAreaTurnContinuation&&state.world.pendingResolution)).toBe(true);
  });
  it.each(corpus.cases)('$name / $test / $id',row=>{replayDurableCase(engine,row);});
  it('restarts the frozen executable twice and resumes all snapshots with exact tapes and outputs',()=>{
    const directory=mkdtempSync(path.join(tmpdir(),'solo-durable-'));
    try{
      const executable=path.join(directory,'engine.cjs');writeFileSync(executable,artifact,{flag:'wx'});
      const helper=new URL('./testing/durableReplay.mjs',import.meta.url).href;
      const program=`(async()=>{const {createHash}=require('node:crypto');const engine=require(process.argv[1]);const {replayDurableCase}=await import(process.argv[2]);process.stdin.setEncoding('utf8');let input='';for await(const part of process.stdin)input+=part;const corpus=JSON.parse(input);const results=corpus.cases.map(row=>createHash('sha256').update(JSON.stringify(replayDurableCase(engine,row))).digest('hex'));process.stdout.write(JSON.stringify(results));})().catch(error=>{console.error(error.message);process.exitCode=1;});`;
      const expected=corpus.cases.map(row=>hash(JSON.stringify(row.result)));
      for(let restart=0;restart<2;restart++){
        const result=spawnSync(process.execPath,['-e',program,executable,helper],{input:bytes,encoding:'utf8',timeout:60000,windowsHide:true,maxBuffer:1024*1024});
        expect(result.error).toBeUndefined();expect(result.status,result.stderr).toBe(0);expect(JSON.parse(result.stdout)).toEqual(expected);
      }
      expect(hash(readFileSync(executable))).toBe(manifest.artifactSha256);
    }finally{expect(path.dirname(directory)).toBe(path.resolve(tmpdir()));expect(path.basename(directory)).toMatch(/^solo-durable-/);rmSync(directory,{recursive:true,force:true});}
  },120000);
});
