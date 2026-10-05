#!/usr/bin/env node
// Read-only inventory. Unknown artifacts remain originals until a human/data
// owner establishes otherwise; this tool never proposes deletion by age.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {repositoryRoot} from '../testing/runtime.mjs';
const roots=['output','outputs','tmp','references'];
const tracked=new Set(execFileSync('git',['ls-files','-z'],{cwd:repositoryRoot,encoding:'utf8',maxBuffer:64*1024*1024}).split('\0').filter(Boolean));
const rows=[],summary={};
for(const root of roots) {
  const totals=summary[root]={files:0,bytes:0,tracked_files:0,tracked_bytes:0,untracked_files:0,untracked_bytes:0,links_not_followed:0};
  const pending=[path.join(repositoryRoot,root)];
  while(pending.length) {
    const directory=pending.pop();if(!fs.existsSync(directory)) continue;
    if(fs.lstatSync(directory).isSymbolicLink()){totals.links_not_followed++;continue;}
    for(const entry of fs.readdirSync(directory,{withFileTypes:true})) {
      const absolute=path.join(directory,entry.name),relative=path.relative(repositoryRoot,absolute).replaceAll('\\','/');
      const info=fs.lstatSync(absolute);
      if(info.isSymbolicLink()){totals.links_not_followed++;continue;}
      if(info.isDirectory()){pending.push(absolute);continue;}
      if(!info.isFile())continue;
      const isTracked=tracked.has(relative),classification=isTracked?'tracked-evidence-or-reference'
        : relative.startsWith('outputs/testing/')||relative.startsWith('outputs/release-measure/')?'owned-generated-diagnostics'
        : 'unclassified-preserve-original';
      totals.files++;totals.bytes+=info.size;totals[isTracked?'tracked_files':'untracked_files']++;totals[isTracked?'tracked_bytes':'untracked_bytes']+=info.size;
      rows.push({path:relative,bytes:info.size,tracked:isTracked,classification,action:'preserve',
        ...(isTracked?{sha256:createHash('sha256').update(fs.readFileSync(absolute)).digest('hex')}:{})});
    }
  }
}
const gitObjectStats=Object.fromEntries(execFileSync('git',['count-objects','-v'],{cwd:repositoryRoot,encoding:'utf8'}).trim().split(/\r?\n/).map(row=>{const [key,value]=row.split(': ');return [key,Number(value)];}));
const report={schema_version:1,created_at:new Date().toISOString(),read_only:true,roots,summary,
  git_objects:{...gitObjectStats,storage_unit_for_size_fields:'KiB',note:'Local Git objects; includes loose/unreachable objects, not working-tree files or Docker layers.'},
  docker_contexts:'Measured separately in execution/REL-02.md; never add to working-tree size or claim transferred bytes.',
  actions:{deleted:0,moved:0},rows};
const output=path.join(repositoryRoot,'outputs/maintenance/artifact-inventory.json');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
const {rows:_,...compact}=report;
fs.writeFileSync(path.join(repositoryRoot,'docs/audits/2026-10-04/execution/artifact-inventory-summary.json'),JSON.stringify(compact,null,2)+'\n');
console.log(JSON.stringify({summary,git_objects:report.git_objects,output}));
