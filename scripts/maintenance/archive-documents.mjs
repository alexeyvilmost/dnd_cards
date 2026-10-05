#!/usr/bin/env node
// Reversible, deliberately bounded migration of three superseded reports.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {repositoryRoot} from '../testing/runtime.mjs';
const apply=process.argv.includes('--apply');
if(process.argv.slice(2).some(arg=>arg!=='--apply'))throw Error('Usage: archive-documents.mjs [--apply]');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const docs=path.join(repositoryRoot,'docs'), archive=path.join(docs,'archive','2026-07');
const manifestFile=path.join(docs,'audits/2026-10-04/execution/document-archive-manifest.json');
const names=['project-review-2026-07-12.md','remediation-progress-2026-07-08.md','constructors-audit-2026-07-13.md'];
function checked(relative) {
  const resolved=path.resolve(repositoryRoot,relative), boundary=docs+path.sep;
  if(!resolved.startsWith(boundary))throw Error('Archive target escapes docs');
  for(let part=resolved;part!==repositoryRoot;part=path.dirname(part)){
    if(fs.existsSync(part)&&fs.lstatSync(part).isSymbolicLink())throw Error('Archive paths cannot traverse links');
  }
  return resolved;
}
const old=fs.existsSync(manifestFile)?JSON.parse(fs.readFileSync(manifestFile,'utf8')):null;
const rows=names.map(name=>{
  const source=checked('docs/'+name),destination=checked('docs/archive/2026-07/'+name);
  const prior=old?.rows.find(row=>row.name===name);
  const content=fs.readFileSync(source),originalHash=prior?.original_sha256??hash(content);
  const stub=`# Исторический документ\n\nЭтот отчёт фиксирует состояние июля 2026 года. Его выводы не описывают текущую готовность проекта.\n\n[Открыть сохранённый оригинал](archive/2026-07/${name}) · [Актуальная документация](README.md)\n`;
  const currentHash=hash(content);
  if(currentHash!==originalHash&&currentHash!==hash(stub))throw Error('Source changed since the reviewed archive manifest: '+name);
  if(fs.existsSync(destination)&&hash(fs.readFileSync(destination))!==originalHash)throw Error('Existing archive differs: '+name);
  return {name,source,destination,original_sha256:originalHash,stub_sha256:hash(stub),stub,
    action:'copy-original-then-install-forwarding-stub',reason:'knowledge-base.md marks this report superseded/completed; references retained by forwarding stub',
    reference_review:'No runtime ?raw/dynamic/go:embed/CLI/skill use found; documentation references retained. Archive bytes preserve historical line numbers.'};
});
fs.mkdirSync(path.dirname(manifestFile),{recursive:true});
if(apply){
  fs.mkdirSync(archive,{recursive:true});
  for(const row of rows){
    checked(path.relative(repositoryRoot,row.destination));
    if(!fs.existsSync(row.destination))fs.copyFileSync(row.source,row.destination,fs.constants.COPYFILE_EXCL);
    if(hash(fs.readFileSync(row.destination))!==row.original_sha256)throw Error('Backup verification failed');
    fs.writeFileSync(row.source,row.stub);
  }
  // Preserve the original relative link without rewriting archived bytes.
  const link=checked('docs/archive/2026-07/remediation-plan-2026-07-08.md');
  const target=checked('docs/remediation-plan-2026-07-08.md');
  if(!fs.existsSync(target))throw Error('Historical plan target is missing');
  fs.writeFileSync(link,'# Исторический план\n\n[Открыть исходный план](../../remediation-plan-2026-07-08.md). Это документ июля 2026 года.\n');
}
const manifest={schema_version:1,status:apply?'applied':'dry-run',date:'2026-10-04',rows:rows.map(({stub,...row})=>row),
  files_deleted:0,original_bytes_preserved:true,rollback:'For each row, verify destination original_sha256 and copy its bytes back to source. Keep archive evidence; no recursive deletion is required.'};
fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2)+'\n');
console.log(`${manifest.status}: ${rows.length} documents; original bytes preserved; ${manifestFile}`);
