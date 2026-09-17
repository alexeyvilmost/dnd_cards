import {apiClient} from '../api/client';
export type SoundEvent='cast'|'hit'|'miss'|'healing';
export interface AudioCue {key:string;name:string;channel:'music'|'effects'|'ui';url:string;gain:number;loop:boolean;license:string;version:number}
export interface AudioBinding {entity_type:string;entity_id:string;event:SoundEvent;cue_key:string}
export interface AudioCatalog {cues:AudioCue[];bindings:AudioBinding[];can_manage:boolean}
export const audioApi={
 get:async()=>(await apiClient.get<AudioCatalog>('/api/audio')).data,
 bind:async(type:string,id:string,event:SoundEvent,cueKey:string)=>apiClient.put(`/api/audio/entities/${encodeURIComponent(type)}/${encodeURIComponent(id)}/${event}`,{cue_key:cueKey}),
 upload:async(file:File,name:string,license:string)=>{const form=new FormData();form.append('file',file);form.append('name',name);form.append('license',license);return (await apiClient.post<AudioCue>('/api/audio/upload',form,{headers:{'Content-Type':'multipart/form-data'}})).data;},
};
