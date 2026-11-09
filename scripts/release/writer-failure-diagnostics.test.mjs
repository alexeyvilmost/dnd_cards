import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createDockerCommand,safeDockerFailure} from './rehearsal-command.mjs';
import {markWriterFailure,safeWriterFailure} from './writer-failure-diagnostics.mjs';

test('writer failure keeps only trusted fixed identifiers and preserves the original error',()=>{
 const secret='PRIVATE_ERROR_CANARY',failure=Object.assign(Error(secret),{code:'ORIGINAL',writerFailure:{phase:secret}});
 assert.equal(markWriterFailure(failure,{phase:'probe-fixture'}),failure);
 assert.equal(markWriterFailure(failure,{phase:'outcome',outcome:'image-job-cross-image-retry'}),failure);
 markWriterFailure(failure,{cleanupFailed:true});
 assert.deepEqual(safeWriterFailure(failure),{phase:'probe-fixture',outcome:'image-job-cross-image-retry',cleanupFailed:true});
 assert.equal(failure.message,secret);assert.equal(failure.code,'ORIGINAL');
 assert.ok(!JSON.stringify(safeWriterFailure(failure)).includes(secret));
 assert.equal(safeWriterFailure(Object.assign(Error(secret),{writerFailure:{phase:'probe-fixture'}})),undefined);
});

test('unknown caller values and non-Error throws cannot leak into diagnostics',()=>{
 const secret='PRIVATE_UNKNOWN_CANARY';
 const failure=markWriterFailure(secret,{phase:secret,outcome:secret});
 assert.equal(failure.message,'Writer compatibility step failed');
 assert.equal(safeWriterFailure(failure),undefined);
 markWriterFailure(failure,{phase:'retained-history',outcome:secret});
 assert.deepEqual(safeWriterFailure(failure),{phase:'retained-history'});
});

test('candidate restoration failure is distinct from owned fixture cleanup failure',()=>{
 const failure=Error('PRIVATE_RESTORE_CANARY');
 markWriterFailure(failure,{phase:'outcome',candidateRestoreFailed:true,cleanupFailed:false});
 assert.deepEqual(safeWriterFailure(failure),{phase:'outcome',candidateRestoreFailed:true});
 markWriterFailure(failure,{cleanupFailed:true});
 assert.deepEqual(safeWriterFailure(failure),{phase:'outcome',candidateRestoreFailed:true,cleanupFailed:true});
 assert.ok(!JSON.stringify(safeWriterFailure(failure)).includes('PRIVATE_RESTORE_CANARY'));
});

test('fixed stage annotation preserves existing branded Docker diagnostics',async()=>{
 const secret='PRIVATE_DOCKER_WRITER_CANARY';
 const command=createDockerCommand({spawnProcess:(_exe,args,settings)=>spawn(process.execPath,['-e',...args],settings)});
 await assert.rejects(command([`process.stderr.write('${secret}');process.exitCode=9;`]),error=>{
  const before=safeDockerFailure(error);
  assert.equal(before.reason,'process-exit');assert.equal(before.exitCode,9);
  assert.equal(markWriterFailure(error,{phase:'probe-execution',outcome:'image-job-cross-image-retry'}),error);
  assert.deepEqual(safeDockerFailure(error),before);
  assert.ok(!JSON.stringify({docker:safeDockerFailure(error),writer:safeWriterFailure(error)}).includes(secret));
  return true;
 });
});
