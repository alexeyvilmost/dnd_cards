import {useEffect,useState} from 'react';
import {audioApi,type AudioCatalog,type SoundEvent} from './catalog';
import {soundPlayer} from './player';
import {AUDIO_AVAILABLE} from './availability';
export default function EntitySoundEditor({type,id}:{type:string;id:string}){
 const [catalog,setCatalog]=useState<AudioCatalog|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [file,setFile]=useState<File|null>(null),[name,setName]=useState(''),[license,setLicense]=useState('');
 const refresh=async()=>{const c=await audioApi.get();setCatalog(c);window.dispatchEvent(new Event('audio-catalog-changed'));};
 useEffect(()=>{let live=true;audioApi.get().then(c=>{if(live)setCatalog(c);}).catch(()=>{});return()=>{live=false;};},[type,id]);
 if(!catalog?.can_manage)return null;
 return <details className="entity-tag-editor entity-sound-editor"><summary>Звуковое оформление</summary><div className="entity-tag-form">
  <p>Это оформление сущности, не изменение её механики. Пустое значение — общий звук соответствующего события.</p>
  {!AUDIO_AVAILABLE&&<p>Воспроизведение звука временно отключено на время доработки.</p>}
  {([['cast','Применение'],['hit','Попадание'],['miss','Промах'],['healing','Лечение']] as [SoundEvent,string][]).map(([event,label])=>{
   const key=catalog.bindings.find(b=>b.entity_type===type&&b.entity_id===id&&b.event===event)?.cue_key??'';
   return <div key={event}><label>{label}<select aria-label={label} value={key} disabled={busy} onChange={async e=>{setBusy(true);setError('');try{await audioApi.bind(type,id,event,e.target.value);await refresh();}catch{setError('Не удалось сохранить звуковое оформление');}finally{setBusy(false);}}}><option value="">Стандартный звук</option>{catalog.cues.filter(c=>c.channel!=='music').map(c=><option key={c.key} value={c.key}>{c.name}</option>)}</select></label><button type="button" disabled={!AUDIO_AVAILABLE||!key} onClick={()=>{soundPlayer.setCatalog(catalog);soundPlayer.unlock();soundPlayer.play(key);}}>Прослушать</button></div>;
  })}
  <h4>Загрузить свой звук</h4>
  <label>Название<input value={name} maxLength={200} onChange={e=>setName(e.target.value)}/></label>
  <label>Источник и лицензия<input value={license} maxLength={2000} onChange={e=>setLicense(e.target.value)} placeholder="Например: собственная запись"/></label>
  <label>WAV, MP3 или OGG, до 15 МБ<input type="file" accept="audio/wav,audio/mpeg,audio/ogg,.wav,.mp3,.ogg" onChange={e=>setFile(e.target.files?.[0]??null)}/></label>
  <button type="button" disabled={busy||!file||!name.trim()||!license.trim()} onClick={async()=>{if(!file)return;setBusy(true);setError('');try{await audioApi.upload(file,name,license);await refresh();setName('');setLicense('');}catch(e){setError((e as {response?:{data?:{error?:string}}}).response?.data?.error??'Не удалось загрузить звук');}finally{setBusy(false);}}}>Загрузить в Yandex Storage</button>
  {error&&<p role="alert">{error}</p>}
 </div></details>;
}
