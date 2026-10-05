#!/usr/bin/env node
// Local browser decode proof; this is not application flow or print acceptance.
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {repositoryRoot} from '../testing/runtime.mjs';
import {prepareMediaVariants} from '../../frontend/scripts/media-variants.mjs';

const bundleDirectory=process.argv[2],output=process.argv[3];
if(!bundleDirectory||!output||existsSync(output))throw Error('Usage: check-media-browser.mjs BUNDLE NEW_REPORT');
const build=prepareMediaVariants({enabled:true,bundleDirectory,inspectionOnly:process.argv[4]==='--inspect-legacy-candidate'});
const manifest=JSON.parse(readFileSync(path.join(bundleDirectory,'manifest.json'),'utf8'));
const files=new Map(),entries=manifest.entries.filter(row=>row.status==='variant');
for(const row of entries){files.set(`/original/${row.sourceSha256}.png`,{type:'image/png',bytes:readFileSync(path.join(repositoryRoot,'frontend/public',row.sourcePath))});files.set(row.variantURL,{type:'image/webp',bytes:readFileSync(path.join(bundleDirectory,'files',row.variantSha256+'.webp'))});}
let servedBytes=0;
const server=createServer((req,res)=>{if(req.url==='/'){res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});res.end('<!doctype html><html lang="en"><title>Local media pixel proof</title><body>Local decode validation</body></html>');return;}const file=files.get(req.url);if(!file){res.writeHead(404);res.end();return;}servedBytes+=file.bytes.length;res.writeHead(200,{'Content-Type':file.type,'Content-Length':file.bytes.length,'Cache-Control':'no-store'});res.end(file.bytes);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const require=createRequire(path.join(repositoryRoot,'frontend/package.json')),{chromium}=require('@playwright/test');
let browser;
try {
  browser=await chromium.launch({headless:true,channel:process.env.TEST_BROWSER_CHANNEL??(process.platform==='win32'?'chrome':undefined)});const page=await browser.newPage();
  await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());await page.goto(origin);
  const checks=[];
  for(const row of entries) {
    const result=await page.evaluate(async({original,variant,width,height})=>{
      const decode=async url=>{const img=new Image();img.src=url;await img.decode();const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0);return {width:canvas.width,height:canvas.height,rgba:ctx.getImageData(0,0,canvas.width,canvas.height).data};};
      const [a,b]=await Promise.all([decode(original),decode(variant)]);let differentBytes=0,differentPixels=0,lastDifferentPixel=-1,maxDifference=0,opaqueDifferences=0,alphaDifferences=0;
      if(a.rgba.length===b.rgba.length){for(let i=0;i<a.rgba.length;i++){if(a.rgba[i]!==b.rgba[i]){differentBytes++;if((i>>2)!==lastDifferentPixel){differentPixels++;lastDifferentPixel=i>>2;}maxDifference=Math.max(maxDifference,Math.abs(a.rgba[i]-b.rgba[i]));if(a.rgba[(i>>2)*4+3]===255)opaqueDifferences++;if(i%4===3)alphaDifferences++;}}}else differentBytes=-1;
      return {equal:a.width===width&&b.width===width&&a.height===height&&b.height===height&&differentBytes===0,differentBytes,differentPixels,maxDifference,opaqueDifferences,alphaDifferences,rgbaBytes:a.rgba.length};
    },{original:`/original/${row.sourceSha256}.png`,variant:row.variantURL,width:row.proof.width,height:row.proof.height});
    checks.push({sourceURL:row.sourceURL,variantURL:row.variantURL,...result});
  }
  const equal=checks.every(row=>row.equal);
  const report={schemaVersion:1,status:equal?'passed':'failed',browser:browser.version(),checks,summary:{...build.summary,decodedPairs:checks.length,browserRGBAEqual:equal,failedPairs:checks.filter(row=>!row.equal).length,servedBodyBytes:servedBytes,networkBasis:'local validation deliberately fetches both original and variant; not app transfer or latency',applicationEnabledE2E:'pending',printVisualReview:'pending',deployment:'not_attempted'}};
  writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report.summary));if(!equal)process.exitCode=1;
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
