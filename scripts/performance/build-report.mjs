import {readFile,readdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {gzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const lexer=require('es-module-lexer');

/** Inspect emitted assets, without evaluating app or service-worker code. */
export async function buildReport(directory=path.join(root,'frontend/dist')) {
  await lexer.init;
  const assets=[];
  async function visit(relative='') {
    for(const entry of await readdir(path.join(directory,relative),{withFileTypes:true})) {
      const name=path.posix.join(relative,entry.name);
      if(entry.isDirectory())await visit(name);
      else {
        const bytes=await readFile(path.join(directory,name));
        assets.push({name,bytes:bytes.length,gzip_bytes:gzipSync(bytes).length});
      }
    }
  }
  await visit();
  const graph=new Map(),dynamicEdges=[];
  for(const asset of assets.filter(row=>row.name.endsWith('.js'))) {
    const source=await readFile(path.join(directory,asset.name),'utf8');
    let imports;try{[imports]=lexer.parse(source);}catch{continue;}
    const staticImports=[];
    for(const specifier of imports) {
      if(!specifier.n?.startsWith('.'))continue;
      const target=path.posix.normalize(path.posix.join(path.posix.dirname(asset.name),specifier.n));
      if(specifier.d===-1)staticImports.push(target);
      else dynamicEdges.push({from:asset.name,to:target});
    }
    graph.set(asset.name,staticImports);
  }
  const html=await readFile(path.join(directory,'index.html'),'utf8');
  const entry=[...html.matchAll(/<script[^>]+src="\/?([^"?]+\.js)"/g)].map(match=>match[1]);
  const entryCSS=[...html.matchAll(/<link[^>]+href="\/?([^"?]+\.css)"/g)].map(match=>match[1]);
  const closure=names=>{const found=new Set();const add=name=>{if(found.has(name))return;found.add(name);for(const dependency of graph.get(name)??[])add(dependency);};names.forEach(add);return [...found].sort();};
  const size=names=>({assets:names,raw_bytes:names.reduce((sum,name)=>sum+(assets.find(row=>row.name===name)?.bytes??0),0),gzip_bytes:names.reduce((sum,name)=>sum+(assets.find(row=>row.name===name)?.gzip_bytes??0),0)});
  const entryGraph=closure(entry),routes={};
  for(const route of ['CardLibrary','CharacterForge','CharacterSheetMVP','PaperSheetEntry','SoloCombatPage','RoguelikePage']) {
    const matches=assets.filter(row=>new RegExp(`^assets/${route}-.*\\.js$`).test(row.name)).map(row=>row.name);
    if(!matches.length)continue;
    const full=closure([...entry,...matches]);
    routes[route]={staticJavaScript:size(full),additionalJavaScript:size(full.filter(name=>!entryGraph.includes(name))),
      namedRouteCSS:size(assets.filter(row=>new RegExp(`^assets/${route}-.*\\.css$`).test(row.name)).map(row=>row.name))};
  }
  let precache=[];
  try {
    const sw=await readFile(path.join(directory,'sw.js'),'utf8');
    precache=[...sw.matchAll(/\{url:"([^"]+)",revision:/g)].map(match=>match[1]);
  }catch{}
  const report={schemaVersion:1,generatedAt:new Date().toISOString(),entryJavaScript:size(entryGraph),entryCSS:size(entryCSS),routes,
    dynamicImports:dynamicEdges,pwaPrecache:size(precache),allJavaScript:size(assets.filter(row=>row.name.endsWith('.js')).map(row=>row.name)),
    allAssets:size(assets.map(row=>row.name)),assetInventory:assets,
    interpretation:{gzip:'Per-file gzip estimate; actual HTTP encoding/cache is measured by browser resources.',routes:'Static JS dependency closure plus separately named route CSS. CSS inherited from other chunks and dynamic preload CSS are not assigned to routes here; browser resource timings measure actual CSS bytes.',dynamicImports:'Reachability edges only, not proof of initial download.',pwa:'Parsed emitted service worker precache URLs; browser baseline blocks service worker, so this is separate install cost.',allAssets:'Includes lazy code/media/public files; never an initial-load budget.'}};
  return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const report=await buildReport();
  if(process.argv[2])await writeFile(process.argv[2],JSON.stringify(report,null,2));
  else console.log(JSON.stringify({entryJavaScript:report.entryJavaScript,entryCSS:report.entryCSS,routes:report.routes,pwaPrecache:report.pwaPrecache,allJavaScript:report.allJavaScript.raw_bytes,allAssets:report.allAssets.raw_bytes},null,2));
}
