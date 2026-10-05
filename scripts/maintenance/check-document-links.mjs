#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {repositoryRoot} from '../testing/runtime.mjs';

const requested=process.argv.slice(2);
if(requested.some(file=>!/^docs\/.+\.md$/.test(file)||file.split('/').includes('..')))throw Error('Choose repository-relative docs Markdown paths');
const names=requested.length?requested:execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z','docs'],{cwd:repositoryRoot,encoding:'utf8',maxBuffer:64*1024*1024}).split('\0').filter(file=>file.endsWith('.md'));
const missing=[],outside=[],files=[...new Set(names)].filter(file=>fs.existsSync(path.join(repositoryRoot,file)));
let checked=0;
for(const file of files) {
  const text=fs.readFileSync(path.join(repositoryRoot,file),'utf8').replace(/^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s*\1\s*$/gm,'');
  for(const match of text.matchAll(/!?\[[^\]\n]*\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\s*\)/g)) {
    const destination=match[1].replace(/^<|>$/g,'');
    if(/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(destination))continue;
    let link;try{link=decodeURIComponent(destination.split(/[?#]/)[0]);}catch{missing.push({file,link:destination,reason:'invalid-encoding'});continue;}
    if(!link)continue;
    const target=path.resolve(path.dirname(path.join(repositoryRoot,file)),link);
    const relative=path.relative(repositoryRoot,target);
    if(relative.startsWith('..'+path.sep)||path.isAbsolute(relative)){outside.push({file,link:destination,reason:'outside-workspace-not-inspected'});continue;}
    checked++;if(!fs.existsSync(target))missing.push({file,link:destination,reason:'target-missing'});
  }
}
const report={schema_version:1,created_at:new Date().toISOString(),scope:requested.length?'explicit-files':'all-local-docs',files:files.length,checked_local_targets:checked,
  missing,outside,limitations:['Checks inline Markdown local file targets; not remote URLs, headings, reference-style links or prose paths.']};
const output=path.join(repositoryRoot,'outputs/maintenance',requested.length?'document-links-selected.json':'document-links-all.json');
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({files:files.length,checked,missing:missing.length,outside:outside.length,output}));
if(missing.length||outside.length)process.exitCode=1;
