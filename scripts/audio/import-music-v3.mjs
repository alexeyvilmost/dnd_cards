// Import the finished three-minute soundtrack. No generation or database writes.
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeMusicGallery} from './music-gallery.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const readJson=async file=>JSON.parse((await readFile(path.join(root,file),'utf8')).replace(/^\uFEFF/,''));
const prompts=await readJson('scripts/audio/music-prompts-v3.json');
const manifest=await readJson('outputs/music-v3/manifest.json');
const catalog=await readJson('backend/audiopresentation/catalog.json');
const maps=[...await readJson('frontend/src/solo-combat/data/battleMaps.json'),...await readJson('frontend/src/solo-combat/data/urvinMaps.json')];
const expectedMaps=new Set(maps.map(map=>map.id));
if(prompts.tracks.length!==17||manifest.tracks.length!==17)throw new Error('All 17 compositions must finish before replacing the catalog.');
const tracks=prompts.tracks.map(prompt=>{
 const track=manifest.tracks.find(row=>row.key===prompt.key);
 if(!track||track.status!=='ready'||track.prompt!==prompt.prompt||track.durationMs!==180000||JSON.stringify(track.compositionPlan)!==JSON.stringify(prompt.compositionPlan))throw new Error(`Generation is not ready: ${prompt.key}`);
 if(!/^[a-z0-9_.-]+\.mp3$/.test(track.file))throw new Error('Invalid music asset path.');
 return track;
});
if(new Set(tracks.map(track=>track.key)).size!==tracks.length)throw new Error('Duplicate music keys.');
const battles=tracks.filter(track=>track.role==='battle');
if(battles.length!==expectedMaps.size||new Set(battles.map(track=>track.mapId)).size!==expectedMaps.size||battles.some(track=>!expectedMaps.has(track.mapId)))throw new Error('Every canonical map needs its own composition.');
for(const role of ['site','run'])if(tracks.filter(track=>track.role===role).length!==1)throw new Error(`Expected one ${role} composition.`);
const assetDir=path.join(root,'frontend/public/audio/music-v3');
await mkdir(assetDir,{recursive:true});
const cues=[];
const provenance=[];
for(const track of tracks){
 const source=path.join(root,'outputs/music-v3',track.file);
 const audio=await readFile(source);
 const sha256=createHash('sha256').update(audio).digest('hex');
 if(sha256!==track.sha256||audio.length!==track.bytes)throw new Error(`Music asset changed: ${track.key}`);
 await copyFile(source,path.join(assetDir,track.file));
 const url=`/audio/music-v3/${track.file}`;
 cues.push({key:track.key,name:track.nameRu,channel:'music',url,gain:track.role==='battle'?0.38:0.28,loop:true,
  license:'Generated with ElevenLabs Music; source and generation details in audiopresentation/music-provenance-v3.json',version:3});
 provenance.push({...track,url});
}
catalog.version=3;
catalog.cues=[...catalog.cues.filter(cue=>cue.channel!=='music'),...cues];
catalog.music={site:tracks.find(track=>track.role==='site').key,run:tracks.find(track=>track.role==='run').key,
 battles:Object.fromEntries(battles.map(track=>[track.mapId,track.key]))};
await writeFile(path.join(root,'backend/audiopresentation/catalog.json'),`${JSON.stringify(catalog,null,2)}\n`);
await writeFile(path.join(root,'backend/audiopresentation/music-provenance-v3.json'),`${JSON.stringify({version:3,provider:manifest.provider,modelId:manifest.modelId,source:'https://elevenlabs.io/docs/api-reference/music/compose',tracks:provenance},null,2)}\n`);
await writeMusicGallery(assetDir,tracks);
console.log(JSON.stringify({tracks:tracks.length,maps:battles.length,durationMs:tracks.reduce((sum,track)=>sum+track.durationMs,0),assets:'frontend/public/audio/music-v3'}));
