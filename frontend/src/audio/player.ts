import {getSettings,type SiteSettings} from '../settings';
import type {AudioCatalog,AudioCue,SoundEvent} from './catalog';
import {AUDIO_AVAILABLE} from './availability';
type Voice={audio:HTMLAudioElement;cue:AudioCue;fade:number};
export function audioGain(cue:AudioCue,settings:SiteSettings,fade=1){
 const channel=cue.channel==='music'?settings.audioMusic:cue.channel==='ui'?settings.audioUI:settings.audioEffects;
 const gain=settings.audioMaster*channel*cue.gain*fade;
 return AUDIO_AVAILABLE&&settings.audioEnabled&&Number.isFinite(gain)?Math.max(0,Math.min(1,gain)):0;
}
/** Cosmetic only: no game commands, RNG, or result decisions. Never queues stale effects. */
export class SoundPlayer {
 catalog:AudioCatalog={cues:[],bindings:[],can_manage:false};
 private voices=new Set<Voice>();private music:Voice|null=null;private desiredMusic:string|null=null;
 private unlocked=false;private hidden=false;private seen=new Set<string>();private recent=new Map<string,number>();
 private fading:ReturnType<typeof setInterval>|null=null;
 constructor(private factory:(url:string)=>HTMLAudioElement=url=>new Audio(url),private settings=()=>getSettings()){}
 setCatalog(catalog:AudioCatalog){this.catalog=catalog;this.ensureMusic();}
 unlock(){this.unlocked=true;this.ensureMusic();}
 entity(type:string,id:string,event:SoundEvent){return this.catalog.bindings.find(b=>b.entity_type===type&&b.entity_id===id&&b.event===event)?.cue_key;}
 play(key:string,eventId?:string){
  if(eventId){if(this.seen.has(eventId))return;this.seen.add(eventId);if(this.seen.size>1500)this.seen.delete(this.seen.values().next().value!);}
  const cue=this.catalog.cues.find(c=>c.key===key),now=Date.now();
  if(!cue||cue.channel==='music'||!this.unlocked||this.hidden||audioGain(cue,this.settings())===0)return;
  if(now-(this.recent.get(key)??0)<(key==='dice.roll'?180:70))return;
  this.recent.set(key,now);if(this.voices.size>=8){const oldest=[...this.voices].find(v=>v.cue.channel!=='music');if(oldest)this.stop(oldest);}
  this.start(cue,1);
 }
 private start(cue:AudioCue,fade:number):Voice|null{
  let voice:Voice|null=null;
  try{
   const audio=this.factory(cue.url);voice={audio,cue,fade};const active=voice;
   audio.preload='auto';audio.loop=cue.loop;audio.volume=audioGain(cue,this.settings(),fade);
   this.voices.add(active);audio.onended=()=>this.stop(active);audio.onerror=()=>this.stop(active);
   void audio.play().catch(()=>this.stop(active));return active;
  }catch{if(voice)this.stop(voice);return null;}
 }
 private stop(voice:Voice){voice.audio.pause();voice.audio.onended=null;voice.audio.onerror=null;this.voices.delete(voice);if(this.music===voice)this.music=null;}
 setMusic(key:string|null){if(key===this.desiredMusic){this.ensureMusic();return;}this.desiredMusic=key;this.transition();}
 private ensureMusic(){if(!this.music&&this.desiredMusic)this.transition();}
 private transition(){
  const cue=this.catalog.cues.find(c=>c.key===this.desiredMusic&&c.channel==='music');
  if(this.fading)clearInterval(this.fading);
  for(const voice of this.voices)if(voice.cue.channel==='music'&&voice!==this.music)this.stop(voice);
  const old=this.music;
  const fresh=cue&&this.unlocked&&!this.hidden&&audioGain(cue,this.settings())>0?this.start(cue,0):null;
  this.music=fresh;
  if(!old&&!fresh)return;
  let tick=0;this.fading=setInterval(()=>{
   tick++;const p=Math.min(1,tick/16);if(old){old.fade=1-p;old.audio.volume=audioGain(old.cue,this.settings(),old.fade);}if(fresh){fresh.fade=p;fresh.audio.volume=audioGain(fresh.cue,this.settings(),p);}
   if(p===1){if(old)this.stop(old);if(this.fading)clearInterval(this.fading);this.fading=null;}
  },50);
 }
 refresh(){for(const voice of this.voices){voice.audio.volume=audioGain(voice.cue,this.settings(),voice.fade);if(voice.audio.volume===0&&voice.cue.channel!=='music')this.stop(voice);}if(!this.settings().audioEnabled||this.settings().audioMusic===0||this.settings().audioMaster===0){if(this.music)this.stop(this.music);}else this.ensureMusic();}
 visibility(hidden:boolean){this.hidden=hidden;if(hidden){if(this.fading)clearInterval(this.fading);this.fading=null;for(const voice of [...this.voices])this.stop(voice);}else this.ensureMusic();}
 dispose(){this.visibility(true);this.desiredMusic=null;}
}
// Vite may load timestamped and bare URLs for this module during hot reload.
// One player per page prevents orphaned music and multiple independent mixers.
const playerKey=Symbol.for('bag-of-holding.audio.v1');
const registry=globalThis as unknown as Record<symbol,SoundPlayer|undefined>;
// Also silence an instance retained by HMR from before the release switch changed.
if(!AUDIO_AVAILABLE)registry[playerKey]?.dispose();
export const soundPlayer=(!AUDIO_AVAILABLE?undefined:registry[playerKey])??(registry[playerKey]=new SoundPlayer());
