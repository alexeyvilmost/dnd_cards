import {apiClient} from '../api/client';
import seed from '../../../backend/audiopresentation/catalog.json';
export type SoundEvent='cast'|'charge'|'launch'|'hit'|'miss'|'healing'|'activate';
export interface AudioCue {key:string;name:string;channel:'music'|'effects'|'ui';url:string;gain:number;loop:boolean;license:string;version:number}
export interface AudioBinding {entity_type:string;entity_id:string;event:SoundEvent;cue_key:string}
export type AudioPhaseProfile=Partial<Record<SoundEvent,string>>;
export interface AudioCatalog {
 version?:number; cues:AudioCue[]; bindings:AudioBinding[]; can_manage:boolean;
 profiles?:Record<string,AudioPhaseProfile>;
 defaults?:{diceSingle?:string;diceRoll?:string};
 music?:{site?:string;run?:string;battles?:Record<string,string>};
}
export const builtInAudioCatalog:AudioCatalog={...seed,can_manage:false} as AudioCatalog;
/** API bindings are authoritative; the bundled presentation data also works offline. */
export function normalizeAudioCatalog(catalog:AudioCatalog):AudioCatalog {
 const cues=new Map(builtInAudioCatalog.cues.map(cue=>[cue.key,cue]));
 for(const cue of catalog.cues){
  const bundled=cues.get(cue.key);
  if((catalog.version??0)<2&&!bundled&&!cue.key.startsWith('custom.'))continue;
  if(!bundled||cue.version>=bundled.version)cues.set(cue.key,cue);
 }
 return {...builtInAudioCatalog,...catalog,cues:[...cues.values()],bindings:catalog.bindings.filter(binding=>cues.has(binding.cue_key)),
  profiles:catalog.profiles??builtInAudioCatalog.profiles,
  defaults:catalog.defaults??builtInAudioCatalog.defaults,
  music:catalog.music??builtInAudioCatalog.music};
}
export const audioApi={
 get:async()=>normalizeAudioCatalog((await apiClient.get<AudioCatalog>('/api/audio')).data),
 bind:async(type:string,id:string,event:SoundEvent,cueKey:string)=>apiClient.put(`/api/audio/entities/${encodeURIComponent(type)}/${encodeURIComponent(id)}/${event}`,{cue_key:cueKey}),
 upload:async(file:File,name:string,license:string)=>{const form=new FormData();form.append('file',file);form.append('name',name);form.append('license',license);return (await apiClient.post<AudioCue>('/api/audio/upload',form,{headers:{'Content-Type':'multipart/form-data'}})).data;},
};
