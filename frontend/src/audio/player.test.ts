import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {SoundPlayer,audioGain} from './player';
import {getSettings} from '../settings';
import type {AudioCatalog,AudioCue} from './catalog';
// Test the mixer independently of the release catalog.
vi.mock('./availability',()=>({AUDIO_AVAILABLE:true}));
const cue=(key:string,channel:AudioCue['channel']='effects'):AudioCue=>({key,name:key,url:`/${key}.wav`,channel,gain:.8,loop:channel==='music',license:'original',version:1});
describe('bounded audio presentation',()=>{
 beforeEach(()=>vi.useFakeTimers());afterEach(()=>vi.useRealTimers());
 const setup=()=>{let settings={...getSettings(),audioEnabled:true};const voices:HTMLAudioElement[]=[];const player=new SoundPlayer(url=>{const v={src:url,volume:0,play:vi.fn().mockResolvedValue(undefined),pause:vi.fn(),onended:null,onerror:null} as unknown as HTMLAudioElement;voices.push(v);return v;},()=>settings);player.setCatalog({cues:[cue('hit'),cue('miss'),cue('dice.roll'),cue('camp','music'),cue('battle','music')],bindings:[],can_manage:false});return {player,voices,settings,setSettings:(next:typeof settings)=>{settings=next;player.refresh();}};};
 it('requires interaction, deduplicates events and never replays a hidden backlog',()=>{
  const {player,voices}=setup();player.play('hit','before');expect(voices).toHaveLength(0);player.unlock();player.play('hit','before');expect(voices).toHaveLength(0);
  player.play('hit','a');player.play('hit','a');expect(voices).toHaveLength(1);player.visibility(true);expect(voices[0].pause).toHaveBeenCalled();player.play('miss','hidden');player.visibility(false);player.play('miss','hidden');expect(voices).toHaveLength(1);player.dispose();
 });
 it('coalesces a tray, bounds polyphony and retains background music',()=>{
  const {player,voices}=setup();player.unlock();player.setMusic('camp');vi.advanceTimersByTime(900);
  for(let i=0;i<6;i++)player.play('dice.roll');expect(voices).toHaveLength(2);
  for(let i=0;i<12;i++){vi.advanceTimersByTime(100);player.play('hit',String(i));}
  expect(voices[0].pause).not.toHaveBeenCalled();expect(voices.filter(v=>!(v.pause as ReturnType<typeof vi.fn>).mock.calls.length)).toHaveLength(8);player.dispose();
 });
 it('crossfades, mutes immediately and releases every voice on disposal',()=>{
  const {player,voices,settings,setSettings}=setup();player.unlock();player.setMusic('camp');vi.advanceTimersByTime(900);expect(voices[0].volume).toBeGreaterThan(0);
  player.setMusic('battle');vi.advanceTimersByTime(400);expect(voices[0].volume).toBeGreaterThan(0);expect(voices[1].volume).toBeGreaterThan(0);
  setSettings({...settings,audioEnabled:false});expect(voices.every(v=>v.volume===0)).toBe(true);vi.advanceTimersByTime(500);player.dispose();expect(voices.every(v=>(v.pause as ReturnType<typeof vi.fn>).mock.calls.length>0)).toBe(true);
 });
 it('channel volumes are independent and zero is respected',()=>{const s={...getSettings(),audioMusic:0,audioEffects:.8};expect(audioGain(cue('camp','music'),s)).toBe(0);expect(audioGain(cue('hit'),s)).toBeGreaterThan(0);});
 it('a missing media implementation or rejected playback never breaks gameplay',async()=>{
  const failed=new SoundPlayer(()=>{throw Error('audio unavailable');});failed.setCatalog({cues:[cue('hit')],bindings:[],can_manage:false});failed.unlock();expect(()=>failed.play('hit')).not.toThrow();failed.dispose();
  const pause=vi.fn(),rejected=new SoundPlayer(()=>({play:vi.fn().mockRejectedValue(Error('autoplay')),pause}) as unknown as HTMLAudioElement);rejected.setCatalog({cues:[cue('hit')],bindings:[],can_manage:false});rejected.unlock();expect(()=>rejected.play('hit')).not.toThrow();await Promise.resolve();expect(pause).toHaveBeenCalled();rejected.dispose();
 });
 it('uses arbitrary entity assignments without special case names',()=>{const {player}=setup();const bindings:AudioCatalog['bindings']=[{entity_type:'action',entity_id:'alpha',event:'cast',cue_key:'hit'},{entity_type:'spell',entity_id:'beta',event:'miss',cue_key:'miss'}];player.setCatalog({...player.catalog,bindings});expect(player.entity('action','alpha','cast')).toBe('hit');expect(player.entity('spell','beta','miss')).toBe('miss');expect(player.entity('spell','alpha','cast')).toBeUndefined();player.dispose();});
 it('plays phase markers once, cancels unmounted timers and never resumes a hidden backlog',()=>{
  const {player,voices}=setup();player.unlock();
  const phases=[{key:'hit',eventId:'launch:one',delayMs:100},{key:'miss',eventId:'contact:one',delayMs:500}];
  const cancel=player.schedule(phases);player.schedule(phases);
  vi.advanceTimersByTime(99);expect(voices).toHaveLength(0);vi.advanceTimersByTime(1);expect(voices).toHaveLength(1);
  cancel();vi.advanceTimersByTime(500);expect(voices).toHaveLength(1);
  player.schedule([{key:'hit',eventId:'launch:two',delayMs:100}]);player.visibility(true);player.visibility(false);
  player.schedule([{key:'hit',eventId:'launch:two',delayMs:100}]);vi.advanceTimersByTime(500);expect(voices).toHaveLength(1);player.dispose();
 });
 it('keeps distinct simultaneous contacts while coalescing untagged previews',()=>{
  const {player,voices}=setup();player.unlock();
  player.play('hit','target:a');player.play('hit','target:b');expect(voices).toHaveLength(2);
  player.play('hit');player.play('hit');expect(voices).toHaveLength(2);player.dispose();
 });
 it('reads dice roles from data and does not fall back to procedural assets',()=>{
  const {player,voices}=setup();player.unlock();player.playDefault('diceSingle','one');expect(voices).toHaveLength(0);
  player.setCatalog({...player.catalog,defaults:{diceSingle:'miss',diceRoll:'hit'}});
  player.playDefault('diceSingle','single');player.playDefault('diceRoll','tray');expect(voices.map(voice=>voice.src)).toEqual(['/miss.wav','/hit.wav']);player.dispose();
 });
 it('prioritizes the catalog battle track and restores route music after leaving combat',()=>{
  const {player,voices}=setup();player.unlock();player.setMusic('camp');vi.advanceTimersByTime(900);
  player.setCombatMusic('battle');vi.advanceTimersByTime(900);expect(voices.at(-1)?.src).toBe('/battle.wav');
  player.setMusic('camp');vi.advanceTimersByTime(900);expect(voices).toHaveLength(2);
  player.setCombatMusic(undefined);vi.advanceTimersByTime(900);expect(voices.at(-1)?.src).toBe('/camp.wav');
  player.setCombatMusic(null);vi.advanceTimersByTime(900);expect(voices.at(-1)?.pause).toHaveBeenCalled();player.dispose();
 });
 it('crossfades to a replacement recording when the catalog changes without navigation',()=>{
  const {player,voices}=setup();player.unlock();player.setMusic('camp');vi.advanceTimersByTime(900);
  const current=voices[0];
  player.setCatalog({...player.catalog,cues:player.catalog.cues.map(row=>row.key==='camp'?{...row,url:'/camp-v3.mp3',version:3}:row)});
  expect(voices.at(-1)?.src).toBe('/camp-v3.mp3');
  vi.advanceTimersByTime(900);
  expect(current.pause).toHaveBeenCalled();
  expect(voices.at(-1)?.pause).not.toHaveBeenCalled();player.dispose();
 });
 it('turning effects off discards delayed contacts even if reenabled before their marker',()=>{
  const {player,voices,settings,setSettings}=setup();player.unlock();
  player.schedule([{key:'hit',eventId:'later',delayMs:500}]);setSettings({...settings,audioEffects:0});setSettings({...settings,audioEffects:1});
  vi.advanceTimersByTime(1000);expect(voices).toHaveLength(0);player.dispose();
 });
 it('keeps current levels through interrupted fades and reuses an already audible destination',()=>{
  const {player,voices}=setup();player.unlock();player.setMusic('camp');vi.advanceTimersByTime(200);
  const initial=voices[0].volume;player.setMusic('battle');vi.advanceTimersByTime(50);
  expect(voices[0].volume).toBeLessThan(initial);
  const campBefore=voices[0].volume,battleBefore=voices[1].volume;
  player.setMusic('camp');vi.advanceTimersByTime(50);
  expect(voices).toHaveLength(2);expect(voices[0].volume).toBeGreaterThan(campBefore);expect(voices[1].volume).toBeLessThan(battleBefore);
  vi.advanceTimersByTime(900);expect(voices[0].pause).not.toHaveBeenCalled();expect(voices[1].pause).toHaveBeenCalled();player.dispose();
 });
 it('music mute stops both sides of a crossfade and resumes exactly one track',()=>{
  const {player,voices,settings,setSettings}=setup();player.unlock();player.setMusic('camp');vi.advanceTimersByTime(900);
  player.setMusic('battle');vi.advanceTimersByTime(300);setSettings({...settings,audioMusic:0});
  expect(voices.every(voice=>vi.mocked(voice.pause).mock.calls.length>0)).toBe(true);expect(vi.getTimerCount()).toBe(0);
  setSettings({...settings,audioMusic:.5});vi.advanceTimersByTime(900);
  expect(voices.filter(voice=>!vi.mocked(voice.pause).mock.calls.length)).toHaveLength(1);expect(voices.at(-1)?.src).toBe('/battle.wav');player.dispose();
 });
 it('crossfades the real music tail into its beginning instead of using an abrupt native loop',()=>{
  const {player,voices}=setup();player.unlock();player.setMusic('camp');vi.advanceTimersByTime(900);
  const original=voices[0];expect(original.loop).toBe(false);
  Object.assign(original,{duration:30,currentTime:29.4});original.ontimeupdate?.call(original,new Event('timeupdate'));
  expect(voices).toHaveLength(2);expect(voices[1].src).toBe(original.src);expect(voices[1].volume).toBe(0);
  original.ontimeupdate?.call(original,new Event('timeupdate'));expect(voices).toHaveLength(2);
  vi.advanceTimersByTime(300);expect(original.volume).toBeGreaterThan(0);expect(voices[1].volume).toBeGreaterThan(0);
  vi.advanceTimersByTime(400);expect(original.pause).toHaveBeenCalled();expect(original.ontimeupdate).toBeNull();
  expect(voices[1].pause).not.toHaveBeenCalled();player.dispose();expect(vi.getTimerCount()).toBe(0);
 });
 it('requires unlock for music, stops every loop voice when hidden and returns with one voice',()=>{
  const {player,voices}=setup();player.setMusic('camp');expect(voices).toHaveLength(0);player.unlock();vi.advanceTimersByTime(900);
  Object.assign(voices[0],{duration:30,currentTime:29.5});voices[0].ontimeupdate?.call(voices[0],new Event('timeupdate'));
  player.visibility(true);expect(voices.every(voice=>vi.mocked(voice.pause).mock.calls.length>0)).toBe(true);expect(vi.getTimerCount()).toBe(0);
  player.visibility(false);player.visibility(false);vi.advanceTimersByTime(900);
  expect(voices.filter(voice=>!vi.mocked(voice.pause).mock.calls.length)).toHaveLength(1);player.dispose();
 });
});
