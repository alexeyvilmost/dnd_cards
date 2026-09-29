import {getSettings,type SiteSettings} from '../settings';
import {builtInAudioCatalog,type AudioCatalog,type AudioCue,type SoundEvent} from './catalog';
import {AUDIO_AVAILABLE} from './availability';
type Voice={audio:HTMLAudioElement;cue:AudioCue;fade:number};
export interface ScheduledSound {key:string;eventId:string;delayMs:number}
export function audioGain(cue:AudioCue,settings:SiteSettings,fade=1){
 const channel=cue.channel==='music'?settings.audioMusic:cue.channel==='effects'?settings.audioEffects:0;
 const gain=settings.audioMaster*channel*cue.gain*fade;
 return AUDIO_AVAILABLE&&settings.audioEnabled&&Number.isFinite(gain)?Math.max(0,Math.min(1,gain)):0;
}
/** Cosmetic only: no game commands, RNG, or result decisions. Never queues stale effects. */
export class SoundPlayer {
 readonly mixerVersion=2;
 catalog:AudioCatalog=builtInAudioCatalog;
 private voices=new Set<Voice>();private music:Voice|null=null;private desiredMusic:string|null=null;
 private routeMusic:string|null=null;private combatMusic:string|null|undefined;
 private unlocked=false;private hidden=false;private seen=new Set<string>();private recent=new Map<string,number>();
 private scheduled=new Map<string,ReturnType<typeof setTimeout>>();
 private catalogListeners=new Set<()=>void>();
 private fading:ReturnType<typeof setInterval>|null=null;
 constructor(private factory:(url:string)=>HTMLAudioElement=url=>new Audio(url),private settings=()=>getSettings()){}
 setCatalog(catalog:AudioCatalog){
  this.catalog=catalog;
  const next=this.catalog.cues.find(cue=>cue.key===this.desiredMusic&&cue.channel==='music');
  // A release may replace a recording without changing its logical role key.
  // Crossfade to the new URL when the catalog arrives; do not wait for a route change.
  if(this.music&&(this.music.cue.key!==next?.key||this.music.cue.url!==next?.url))this.transition();
  else this.ensureMusic();
  for(const listener of this.catalogListeners)listener();
 }
 getCatalog=()=>this.catalog;
 subscribeCatalog=(listener:()=>void)=>{this.catalogListeners.add(listener);return()=>{this.catalogListeners.delete(listener);};};
 unlock(){this.unlocked=true;this.ensureMusic();}
 entity(type:string,id:string,event:SoundEvent){return this.catalog.bindings.find(b=>b.entity_type===type&&b.entity_id===id&&b.event===event)?.cue_key;}
 playDefault(kind:'diceSingle'|'diceRoll',eventId?:string){const key=this.catalog.defaults?.[kind];if(key)this.play(key,eventId);}
 private remember(eventId:string){this.seen.add(eventId);if(this.seen.size>1500)this.seen.delete(this.seen.values().next().value!);}
 /** Timers belong to the visible presentation. Cancelling never leaves a late impact. */
 schedule(plan:readonly ScheduledSound[]):()=>void{
  const owned=new Map<string,ReturnType<typeof setTimeout>>();
  for(const event of plan){
   if(this.seen.has(event.eventId)||this.scheduled.has(event.eventId))continue;
   const cue=this.catalog.cues.find(row=>row.key===event.key);
   if(!cue||cue.channel!=='effects'||!this.unlocked||this.hidden||audioGain(cue,this.settings())===0){this.remember(event.eventId);continue;}
   if(event.delayMs<=0){this.play(event.key,event.eventId);continue;}
   const timer=setTimeout(()=>{this.scheduled.delete(event.eventId);owned.delete(event.eventId);this.play(event.key,event.eventId);},event.delayMs);
   this.scheduled.set(event.eventId,timer);owned.set(event.eventId,timer);
  }
  return()=>{for(const [id,timer]of owned){clearTimeout(timer);if(this.scheduled.get(id)===timer)this.scheduled.delete(id);}owned.clear();};
 }
 play(key:string,eventId?:string){
  if(eventId){if(this.seen.has(eventId))return;this.remember(eventId);}
  const cue=this.catalog.cues.find(c=>c.key===key),now=Date.now();
  if(!cue||cue.channel!=='effects'||!this.unlocked||this.hidden||audioGain(cue,this.settings())===0)return;
  // Explicit event IDs represent distinct confirmed contacts, even when two
  // defenders use the same cue at the same animation marker.
  if(!eventId&&now-(this.recent.get(key)??-Infinity)<70)return;
  this.recent.set(key,now);if(this.voices.size>=8){const oldest=[...this.voices].find(v=>v.cue.channel!=='music');if(oldest)this.stop(oldest);}
  this.start(cue,1);
 }
 private start(cue:AudioCue,fade:number):Voice|null{
  let voice:Voice|null=null;
  try{
   const audio=this.factory(cue.url);voice={audio,cue,fade};const active=voice;
   audio.preload='auto';audio.loop=cue.channel==='music'?false:cue.loop;audio.volume=audioGain(cue,this.settings(),fade);
   this.voices.add(active);
   audio.onended=()=>{const repeat=this.music===active&&cue.channel==='music'&&cue.loop;this.stop(active);if(repeat)this.ensureMusic();};
   audio.onerror=()=>this.stop(active);
   if(cue.channel==='music'&&cue.loop)audio.ontimeupdate=()=>this.loopMusic(active);
   void audio.play().catch(()=>this.stop(active));return active;
  }catch{if(voice)this.stop(voice);return null;}
 }
 private stop(voice:Voice){voice.audio.pause();voice.audio.onended=null;voice.audio.onerror=null;voice.audio.ontimeupdate=null;this.voices.delete(voice);if(this.music===voice)this.music=null;}
 setMusic(key:string|null){this.routeMusic=key;this.updateMusic();}
 /** undefined releases combat priority; null intentionally mutes an unmapped battle. */
 setCombatMusic(key:string|null|undefined){this.combatMusic=key;this.updateMusic();}
 private updateMusic(){const key=this.combatMusic===undefined?this.routeMusic:this.combatMusic;if(key===this.desiredMusic){this.ensureMusic();return;}this.desiredMusic=key;this.transition();}
 private ensureMusic(){if(!this.music&&this.desiredMusic)this.transition();}
 private loopMusic(voice:Voice){
  if(this.music!==voice||!this.voices.has(voice)||this.hidden||!this.unlocked||audioGain(voice.cue,this.settings())===0)return;
  const duration=voice.audio.duration,remaining=duration-voice.audio.currentTime;
  if(!Number.isFinite(duration)||duration<=0||remaining<=0)return;
  // Local music is cached after the first pass. Blend the tail into a fresh
  // beginning instead of jumping across an arbitrary MP3 boundary. This can
  // soften the transition; it does not certify a musically seamless loop.
  const overlap=Math.min(.8,duration/4);
  if(remaining<=overlap)this.transition(true,Math.max(50,remaining*1000));
 }
 private transition(restart=false,durationMs=800){
  const cue=this.catalog.cues.find(c=>c.key===this.desiredMusic&&c.channel==='music');
  if(this.fading)clearInterval(this.fading);this.fading=null;
  const previous=[...this.voices].filter(voice=>voice.cue.channel==='music');
  const reusable=restart?undefined:previous.find(voice=>voice.cue.key===cue?.key&&voice.cue.url===cue?.url);
  const fresh=cue&&this.unlocked&&!this.hidden&&audioGain(cue,this.settings())>0?(reusable??this.start(cue,0)):null;
  this.music=fresh;
  const outgoing=previous.filter(voice=>voice!==fresh).map(voice=>({voice,from:voice.fade}));
  const freshFrom=fresh?.fade??0;
  if(!outgoing.length&&!fresh)return;
  const started=Date.now();const timer=setInterval(()=>{
   const p=Math.min(1,(Date.now()-started)/durationMs);
   for(const {voice,from}of outgoing)if(this.voices.has(voice)){voice.fade=from*(1-p);voice.audio.volume=audioGain(voice.cue,this.settings(),voice.fade);}
   if(fresh&&this.voices.has(fresh)){fresh.fade=freshFrom+(1-freshFrom)*p;fresh.audio.volume=audioGain(fresh.cue,this.settings(),fresh.fade);}
   if(p===1){for(const {voice}of outgoing)this.stop(voice);clearInterval(timer);if(this.fading===timer)this.fading=null;}
  },50);
  this.fading=timer;
 }
 refresh(){for(const voice of this.voices){voice.audio.volume=audioGain(voice.cue,this.settings(),voice.fade);if(voice.audio.volume===0&&voice.cue.channel!=='music')this.stop(voice);}if(!this.settings().audioEnabled||this.settings().audioMaster===0||this.settings().audioEffects===0){for(const [id,timer]of this.scheduled){clearTimeout(timer);this.remember(id);}this.scheduled.clear();}if(!this.settings().audioEnabled||this.settings().audioMusic===0||this.settings().audioMaster===0){if(this.fading)clearInterval(this.fading);this.fading=null;for(const voice of [...this.voices])if(voice.cue.channel==='music')this.stop(voice);}else this.ensureMusic();}
 visibility(hidden:boolean){this.hidden=hidden;if(hidden){for(const [id,timer]of this.scheduled){clearTimeout(timer);this.remember(id);}this.scheduled.clear();if(this.fading)clearInterval(this.fading);this.fading=null;for(const voice of [...this.voices])this.stop(voice);}else this.ensureMusic();}
 dispose(){this.visibility(true);this.desiredMusic=null;this.routeMusic=null;this.combatMusic=undefined;}
}
// Vite may load timestamped and bare URLs for this module during hot reload.
// One player per page prevents orphaned music and multiple independent mixers.
const playerKey=Symbol.for('bag-of-holding.audio.v1');
const registry=globalThis as unknown as Record<symbol,SoundPlayer|undefined>;
// HMR can retain the earlier mixer prototype without phase scheduling. Dispose
// it before adopting the new interface instead of leaving an orphaned voice.
if(registry[playerKey]&&registry[playerKey]?.mixerVersion!==2){registry[playerKey]?.dispose();registry[playerKey]=undefined;}
if(!AUDIO_AVAILABLE)registry[playerKey]?.dispose();
export const soundPlayer=(!AUDIO_AVAILABLE?undefined:registry[playerKey])??(registry[playerKey]=new SoundPlayer());
