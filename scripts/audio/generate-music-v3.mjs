// Compose the user's longer soundtrack as separate, explicitly authored sections.
// A request is recorded before dispatch; interrupted requests are never retried automatically.
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {loadElevenLabsKey} from './workbench/server.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const source=path.join(root,'scripts/audio/music-prompts-v3.json');
const outputDir=path.join(root,'outputs/music-v3');
const maxRequests=process.argv[2]==='--one'?1:Infinity;
if(process.argv.length>2&&process.argv[2]!=='--one')throw new Error('Only --one is supported.');
const readJson=async file=>JSON.parse((await readFile(file,'utf8')).replace(/^\uFEFF/,''));
const prompts=await readJson(source);
if(prompts.tracks.length!==17||new Set(prompts.tracks.map(track=>track.key)).size!==17)throw new Error('Expected 17 distinct soundtrack compositions.');
for(const track of prompts.tracks){
 const chunks=track.compositionPlan?.chunks;
 if(track.durationMs!==180000||!Array.isArray(chunks)||chunks.length<4||chunks.length>30||chunks.reduce((sum,chunk)=>sum+chunk.duration_ms,0)!==track.durationMs)throw new Error(`Invalid duration or plan: ${track.key}`);
 for(const chunk of chunks){
  if(!chunk.text||chunk.text.split(/\r?\n/).length>30||chunk.text.split(/\r?\n/).some(line=>line.length>200)||chunk.duration_ms<3000||chunk.duration_ms>120000||!Array.isArray(chunk.positive_styles)||chunk.positive_styles.length<3||!Array.isArray(chunk.negative_styles)||!chunk.negative_styles.some(value=>/vocals/i.test(value)))throw new Error(`Invalid section: ${track.key}`);
 }
}
await mkdir(outputDir,{recursive:true});
const manifestFile=path.join(outputDir,'manifest.json');
let manifest;
try{manifest=await readJson(manifestFile);}catch(error){if(error.code!=='ENOENT')throw error;manifest={version:3,provider:'ElevenLabs Music',modelId:'music_v2_5',tracks:[]};}
const save=async()=>{const temp=`${manifestFile}.${randomUUID()}.tmp`;await writeFile(temp,JSON.stringify(manifest,null,2)+'\n');await rename(temp,manifestFile);};
const apiKey=await loadElevenLabsKey();
if(!apiKey)throw new Error('ELEVENLABS_TOKEN is missing from the project .env.');
let sent=0;
for(const track of prompts.tracks){
 const old=manifest.tracks.find(row=>row.key===track.key);
 if(old?.status==='ready'){
  if(JSON.stringify(old.compositionPlan)!==JSON.stringify(track.compositionPlan))throw new Error(`Finished generation has a different plan: ${track.key}`);
  continue;
 }
 if(old)throw new Error(`Previous ${old.status} request requires review before retry: ${track.key}`);
 if(sent>=maxRequests)break;
 const row={...track,status:'generating',startedAt:new Date().toISOString(),requestId:randomUUID()};
 manifest.tracks.push(row);await save();
 sent++;
 try{
  const response=await fetch('https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128',{method:'POST',headers:{'xi-api-key':apiKey,'content-type':'application/json',Accept:'audio/mpeg'},body:JSON.stringify({model_id:manifest.modelId,composition_plan:track.compositionPlan}),signal:AbortSignal.timeout(600000)});
  row.httpStatus=response.status;
  const cost=response.headers.get('character-cost');row.costCredits=cost===null?null:Number(cost);
  row.songId=response.headers.get('song-id');
  if(!response.ok){
   const error=await response.json().catch(()=>({}));const detail=error.detail??error;
   row.errorCode=typeof detail?.status==='string'?detail.status.slice(0,100):`http_${response.status}`;
   row.error=String(typeof detail==='string'?detail:JSON.stringify(detail)??'Provider rejected the music request.').replaceAll(apiKey,'[redacted]').slice(0,2000);
   row.status='failed';row.completedAt=new Date().toISOString();await save();
   console.log(JSON.stringify({key:row.key,status:row.status,httpStatus:row.httpStatus,errorCode:row.errorCode,error:row.error}));process.exitCode=1;break;
  }
  const type=response.headers.get('content-type')??'';
  if(!type.includes('audio/')&&!type.includes('octet-stream'))throw new Error('Provider returned a non-audio response.');
  const audio=Buffer.from(await response.arrayBuffer());
  if(audio.length<100||audio.length>30*1024*1024||!(audio.subarray(0,3).toString()==='ID3'||(audio[0]===255&&(audio[1]&224)===224)))throw new Error('Invalid MP3 response.');
  row.sha256=createHash('sha256').update(audio).digest('hex');row.file=`${track.key.replaceAll('.','_')}.${row.sha256.slice(0,12)}.mp3`;row.bytes=audio.length;
  await writeFile(path.join(outputDir,row.file),audio);row.status='ready';row.completedAt=new Date().toISOString();await save();
  console.log(JSON.stringify({key:row.key,status:row.status,bytes:row.bytes,costCredits:row.costCredits}));
 }catch(error){
  row.status='interrupted';
  row.errorCode=String(error?.cause?.code??error?.code??error?.name??'unknown').slice(0,100);
  row.errorDetail=String(error?.message??'Request failed').replaceAll(apiKey,'[redacted]').slice(0,500);
  row.error='Music request or file save did not finish. Provider outcome may be unknown; no automatic retry.';
  row.completedAt=new Date().toISOString();await save();
  console.log(JSON.stringify({key:row.key,status:row.status,errorCode:row.errorCode,error:row.error}));process.exitCode=1;break;
 }
}
