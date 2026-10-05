import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,symlink,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {recoverHistoricalSourceCertification,verifyHistoricalSourceCertification,normalizeSourceReleaseHash} from './historical-source-certification.mjs';
const repo=fileURLToPath(new URL('../..',import.meta.url));
const releaseHash='sha256:04678a044c4dc809d213e01e392bc0f16562d5103ee96e070089c1edf7e7100b';
async function temp(t){const root=await mkdtemp(path.join(tmpdir(),'source-certification-'));t.after(async()=>{assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.ok(path.basename(root).startsWith('source-certification-'));await rm(root,{recursive:true,force:true});});return root;}
async function recovered(t){const root=await temp(t),directory=path.join(root,'recovered');const proof=await recoverHistoricalSourceCertification({repo,releaseHash,outputDirectory:directory});return {root,directory,proof};}

test('exact historical Git bytes independently reproduce certificate, source, overlay and database identity hashes',async t=>{
 const {directory,proof}=await recovered(t);
 assert.equal(proof.commit,'aec0f3205d4bfeee02a6e2b2fcf2132eed4002d5');assert.equal(proof.releaseHash,releaseHash);
 assert.equal(proof.contentHash,'sha256:4ee64d32fffe6b88e797a10ae89207d5f88c0f2214cc16df043d6b9464e9f056');
 assert.equal(proof.certificateContentHash,'sha256:c7d28beda4ee169df4a424c1c547fd12f68dec1756f3cf5083a91a3485bbf22b');
 assert.equal(proof.sourceProjectionHash,'sha256:d45f8d97601e6eba0640e6b1c0d95eaf26fc67cb6889187de45a3b5769d187ca');
 assert.equal(proof.databaseBinding.rulesetReleaseId,'54abf005-a210-4ce7-8511-6f03eea02ed7');
 assert.equal(proof.manifestHash,'sha256:3dda1b242973905d6793412c1407adedd72779ac8ce73461ee19686b88c122a4');
 assert.equal(proof.databaseBinding.manifestCanonicalBytesSha256,proof.manifestHash);
 assert.equal(proof.artifactVersion,'1.0.0');assert.equal(proof.databaseBinding.artifactVersion,proof.releaseId);
 assert.equal(proof.executable,false);assert.equal(proof.limits.fullSourceRecompile,false);assert.equal(proof.limits.historicalCommandReplay,false);
 assert.equal(proof.files.length,10);assert.ok(Object.values(proof.verification).every(Boolean));
 assert.deepEqual(await verifyHistoricalSourceCertification(directory),proof);
 await assert.rejects(recoverHistoricalSourceCertification({repo,releaseHash,outputDirectory:directory}),/EEXIST/);
});
test('changed certificate or provenance bytes cannot silently acquire historical authority',async t=>{
 const {directory}=await recovered(t),certificate=path.join(directory,'sources/frontend/src/character/sheetCombatCertification.generated.json');
 const original=await readFile(certificate);await writeFile(certificate,Buffer.concat([original,Buffer.from('\n')]));
 await assert.rejects(verifyHistoricalSourceCertification(directory),/bytes differ/);await writeFile(certificate,original);
 const file=path.join(directory,'provenance.json'),raw=await readFile(file),report=JSON.parse(raw);report.databaseBinding.manifestHash='sha256:'+'0'.repeat(64);await writeFile(file,JSON.stringify(report));
 await assert.rejects(verifyHistoricalSourceCertification(directory),/provenance report differs/);await writeFile(file,raw);
 await writeFile(path.join(directory,'unlisted.cjs'),'not an executable recovery');await assert.rejects(verifyHistoricalSourceCertification(directory),/file set differs/);
});
test('unsupported hashes, wrong commits and linked recovery roots are rejected without history mutation',async t=>{
 const root=await temp(t);assert.equal(normalizeSourceReleaseHash(releaseHash.slice(7)),releaseHash);
 for(const input of ['04678',releaseHash+' ',null,'../'+releaseHash])assert.throws(()=>normalizeSourceReleaseHash(input));
 await assert.rejects(recoverHistoricalSourceCertification({repo,releaseHash:'sha256:'+'a'.repeat(64),outputDirectory:path.join(root,'unknown')}),/Unsupported/);
 await assert.rejects(recoverHistoricalSourceCertification({repo,releaseHash,commit:'a'.repeat(40),outputDirectory:path.join(root,'wrong')}),/commit differs/);
 const target=path.join(root,'real');await mkdir(target);const linked=path.join(root,'linked');await symlink(target,linked,process.platform==='win32'?'junction':'dir');
 await assert.rejects(verifyHistoricalSourceCertification(linked),/links/);
});
