import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {SoundPlayer,audioGain} from './player';
import {getSettings} from '../settings';
import type {AudioCatalog,AudioCue} from './catalog';
// Retain mixer coverage while the release switch is off.
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
});
