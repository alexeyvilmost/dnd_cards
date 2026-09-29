// Generate the explicitly requested local soundtrack. Credentials never enter logs or manifests.
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {loadElevenLabsKey} from './workbench/server.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const dir=path.join(root,'outputs/music-v2');
const readJson=async file=>JSON.parse((await readFile(file,'utf8')).replace(/^\uFEFF/,''));
const prompts=await readJson(path.join(root,'scripts/audio/music-prompts.json'));
await mkdir(dir,{recursive:true});
const manifestFile=path.join(dir,'manifest.json');
let manifest;
try{manifest=await readJson(manifestFile);}catch(error){if(error.code!=='ENOENT')throw error;manifest={version:1,provider:'ElevenLabs Music',modelId:'music_v2_5',tracks:[]};}
const save=async()=>{const temp=`${manifestFile}.${randomUUID()}.tmp`;await writeFile(temp,JSON.stringify(manifest,null,2)+'\n');await rename(temp,manifestFile);};
const apiKey=await loadElevenLabsKey();
if(!apiKey)throw new Error('ELEVENLABS_TOKEN is missing from the project .env.');
for(const track of prompts.tracks){
 const old=manifest.tracks.find(row=>row.key===track.key);
 if(old?.status==='ready')continue;
 if(old)throw new Error(`Previous ${old.status} request requires review before retry: ${track.key}`);
 const row={...track,status:'generating',startedAt:new Date().toISOString(),requestId:randomUUID()};
 manifest.tracks.push(row);await save();
 try{
  const response=await fetch('https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128',{method:'POST',headers:{'xi-api-key':apiKey,'content-type':'application/json',Accept:'audio/mpeg'},body:JSON.stringify({model_id:manifest.modelId,prompt:track.prompt,music_length_ms:track.durationMs,force_instrumental:true}),signal:AbortSignal.timeout(240000)});
  row.httpStatus=response.status;
  const cost=response.headers.get('character-cost');
  row.costCredits=cost===null?null:Number(cost);
  row.songId=response.headers.get('song-id');
  if(!response.ok){
   const error=await response.json().catch(()=>({}));
   const detail=error.detail??error;
   row.errorCode=typeof detail.status==='string'?detail.status.slice(0,100):`http_${response.status}`;
   row.error=String(detail.message??'Provider rejected the music request.').replaceAll(apiKey,'[redacted]').slice(0,1200);
   row.status='failed';row.completedAt=new Date().toISOString();await save();
   console.log(JSON.stringify({key:row.key,status:row.status,httpStatus:row.httpStatus,errorCode:row.errorCode,error:row.error}));
   process.exitCode=1;break;
  }
  const type=response.headers.get('content-type')??'';
  if(!type.includes('audio/')&&!type.includes('octet-stream'))throw new Error('Provider returned a non-audio response.');
  const audio=Buffer.from(await response.arrayBuffer());
  if(audio.length<100||audio.length>20*1024*1024||!(audio.subarray(0,3).toString()==='ID3'||(audio[0]===255&&(audio[1]&224)===224)))throw new Error('Invalid MP3 response.');
  row.sha256=createHash('sha256').update(audio).digest('hex');row.file=`${track.key.replaceAll('.','_')}.${row.sha256.slice(0,12)}.mp3`;row.bytes=audio.length;
  await writeFile(path.join(dir,row.file),audio);row.status='ready';row.completedAt=new Date().toISOString();await save();
  console.log(JSON.stringify({key:row.key,status:row.status,bytes:row.bytes,costCredits:row.costCredits}));
 }catch(error){row.status='interrupted';row.error='Music request or file save did not finish. Provider outcome may be unknown; no automatic retry.';row.completedAt=new Date().toISOString();await save();console.log(JSON.stringify({key:row.key,status:row.status,error:row.error}));process.exitCode=1;break;}
}
