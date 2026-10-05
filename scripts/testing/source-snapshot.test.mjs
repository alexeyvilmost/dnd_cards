import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {captureSourceSnapshot, verifySourceSnapshot, isVerificationInput, assertCleanCICheckout} from './source-snapshot.mjs';

test('source receipt detects changed, removed and newly added inputs, excluding generated output', () => {
  const directory=mkdtempSync(path.join(tmpdir(),'source-receipt-'));
  try {
    const git=(...args)=>execFileSync('git',args,{cwd:directory,stdio:'pipe'});
    git('init','-q'); mkdirSync(path.join(directory,'frontend/src'),{recursive:true});
    writeFileSync(path.join(directory,'frontend/src/main.ts'),'export const value=1;');
    const coverageSource='frontend/src/rules-core/coverage/validator.ts';
    mkdirSync(path.join(directory,path.dirname(coverageSource)),{recursive:true});
    writeFileSync(path.join(directory,coverageSource),'export const valid=true;');
    git('add','.'); git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture');
    const before=captureSourceSnapshot(directory);
    assert.equal(assertCleanCICheckout(directory).clean_checkout,true);
    assert.equal(verifySourceSnapshot(before,captureSourceSnapshot(directory)).unchanged,true);
    mkdirSync(path.join(directory,'frontend/dist')); writeFileSync(path.join(directory,'frontend/dist/index.html'),'built');
    mkdirSync(path.join(directory,'frontend/coverage')); writeFileSync(path.join(directory,'frontend/coverage/index.html'),'report');
    assert.equal(verifySourceSnapshot(before,captureSourceSnapshot(directory)).unchanged,true);
    writeFileSync(path.join(directory,coverageSource),'export const valid=false;');
    assert.throws(()=>verifySourceSnapshot(before,captureSourceSnapshot(directory)),error=>error.changedFiles.includes(coverageSource));
    writeFileSync(path.join(directory,coverageSource),'export const valid=true;');
    assert.equal(verifySourceSnapshot(before,captureSourceSnapshot(directory)).unchanged,true);
    writeFileSync(path.join(directory,'frontend/src/main.ts'),'export const value=2;');
    assert.throws(()=>assertCleanCICheckout(directory),/clean committed/);
    assert.throws(()=>verifySourceSnapshot(before,captureSourceSnapshot(directory)),error=>error.changedFiles.includes('frontend/src/main.ts'));
    writeFileSync(path.join(directory,'frontend/src/main.ts'),'export const value=1;');
    writeFileSync(path.join(directory,'frontend/src/новый.ts'),'export {};');
    assert.throws(()=>verifySourceSnapshot(before,captureSourceSnapshot(directory)),error=>error.changedFiles.includes('frontend/src/новый.ts'));
    rmSync(path.join(directory,'frontend/src/новый.ts')); rmSync(path.join(directory,'frontend/src/main.ts'));
    assert.throws(()=>verifySourceSnapshot(before,captureSourceSnapshot(directory)),error=>error.changedFiles.includes('frontend/src/main.ts'));
  } finally {
    assert.equal(path.dirname(directory),tmpdir()); assert.ok(path.basename(directory).startsWith('source-receipt-'));
    rmSync(directory,{recursive:true,force:true});
  }
});
test('source receipt covers shared data and media without reading secrets or reports',()=>{
  for(const file of ['backend/audiopresentation/catalog.json','frontend/public/maps/floor.png','frontend/src/rules-core/coverage/validator.ts','frontend/src/rules-core/coverage/coverage.test.ts','tests/suites.json','.github/workflows/ci.yml','officials/canon/prod-snapshot/classes.json','.dockerignore'])assert.equal(isVerificationInput(file),true,file);
  for(const file of ['frontend/.env','backend/.env.production','frontend/tsconfig.tsbuildinfo','outputs/testing/report.json','frontend/test-results/report.json','frontend/coverage/index.html','backend/coverage/cover.out','frontend/node_modules/a/index.js'])assert.equal(isVerificationInput(file),false,file);
});
