// Unit-only fabricated protocol data; never actual hosted/OCI evidence.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pair,refresh} from './writer-policy-unit-fixture.mjs';
import {evidenceHash,assertReleaseReady} from './validate-manifest.mjs';
import {verifyHandoff} from './deployment-handoff.mjs';
import {validateWriterTrace,writerTraceBinding} from './writer-traces.mjs';
import {assertHostedWriterPublication,validateWriterBrowserRuntime} from './writer-browser-consumption.mjs';
const browser=f=>f.check.traces.find(t=>t.outcomeId==='frontend-pending-job-reload');
function rehash(f){const trace=browser(f);trace.proofHash=evidenceHash(trace.proof);f.check.outcomes.find(o=>o.id===trace.outcomeId).traceHash=evidenceHash(trace);refresh(f.candidate,f.bundle);}
function binding(f){return writerTraceBinding(f.candidate,f.check,f.bundle.rehearsalReceipt);}
function freshHandoff(f,publication=f.check.writerPublication){return verifyHandoff(f.candidate,f.bundle,publication.verifiedReleaseRun,f.candidate.releaseCommit,publication);}

test('host consumption preserves original browser run and raw trace without rebinding',()=>{
 const f=pair(),trace=browser(f),raw=JSON.stringify(trace.proof.trace),original=trace.proof.binding.runId;
 assert.notEqual(original,binding(f).runId);assert.equal(trace.proof.trace.bindingHash,evidenceHash(trace.proof.binding));
 validateWriterTrace(trace,trace.outcomeId,binding(f));assertHostedWriterPublication(trace,f.check.writerPublication,f.candidate);
 assertReleaseReady(f.candidate,f.bundle);freshHandoff(f);
 assert.equal(JSON.stringify(trace.proof.trace),raw);assert.equal(trace.proof.binding.runId,original);
 trace.proof.trace.bindingHash=evidenceHash(binding(f));rehash(f);assert.throws(()=>assertReleaseReady(f.candidate,f.bundle));
});

test('fresh publication fields remain bound even when a stored proof is rehashed',()=>{
 for(const mutate of [
  t=>t.proof.provenance.releaseRunId++,t=>t.proof.provenance.runAttempt++,
  t=>t.proof.provenance.controlCommit='9'.repeat(40),t=>t.proof.provenance.manifestHash='sha256:'+'9'.repeat(64),
  t=>t.verifiedReleaseRunHash='sha256:'+'8'.repeat(64),
 ]){const f=pair();mutate(browser(f));rehash(f);assert.throws(()=>assertReleaseReady(f.candidate,f.bundle));assert.throws(()=>freshHandoff(f));}
});

test('internally consistent forged publication cannot replace independently verified handoff context',()=>{
 const f=pair(),trusted=structuredClone(f.check.writerPublication),publication=f.check.writerPublication,trace=browser(f);
 publication.verifiedReleaseRun.id++;publication.verifiedReleaseRun.runAttempt++;publication.provenance.releaseRunId++;
 trace.proof.provenance.releaseRunId++;trace.proof.provenance.runAttempt++;trace.verifiedReleaseRunHash=evidenceHash(publication.verifiedReleaseRun);rehash(f);
 // Offline consistency is not a fresh GitHub authorization.
 assertReleaseReady(f.candidate,f.bundle);assert.throws(()=>freshHandoff(f,trusted),/publication/);
});

test('image, old launch, runtime profile, browser binary, cleanup and accidental secrets fail closed',()=>{
 const mutations=[
  t=>t.proof.binding.candidate.images.backend='example.test/backend@sha256:'+'a'.repeat(64),
  t=>t.proof.binding.previous.identities.frontend.releaseId='another-old-ui',
  t=>t.proof.executionProfile.previous.backend.instance.releaseId='other',
  t=>t.proof.executionProfile.candidate.backend.environment.IMAGE_JOBS_ENABLED='0',
  t=>t.proof.executionProfile.previous.backend.environment.DB_FROZEN_CATALOGS='1',
  t=>t.proof.executionProfile.candidate.backend.environment.DATABASE_URL='private-canary',
  t=>delete t.proof.browserRuntime.executableSHA256,
  t=>t.proof.browserRuntime.browserRevision='other',t=>t.proof.browserRuntime.browserVersion='151.0.7922.57',
  t=>t.proof.browserRuntime.playwrightVersion='1.0.0',t=>t.proof.browserRuntime.runnerOS='win32',
  t=>t.proof.browserRuntime.kind='system-chrome',t=>t.proof.browserRuntime.path='private/path',
  t=>t.proof.cleanup.status='failed',t=>t.proof.cleanup.errors.push('owned-resource-remains'),
  t=>t.proof.trace.observations[0].providerCallsAfter++,t=>t.proof.trace.observations[1].syncRequests++,
 ];
 for(const mutate of mutations){const f=pair();mutate(browser(f));rehash(f);assert.throws(()=>assertReleaseReady(f.candidate,f.bundle));}
 const f=pair();validateWriterBrowserRuntime(browser(f).proof.browserRuntime);
 assert.throws(()=>validateWriterTrace(browser(f),'image-job-cross-image-retry',binding(f)),/only supply/);
});
