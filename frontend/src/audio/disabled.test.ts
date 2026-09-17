import {expect,it,vi} from 'vitest';
import {SoundPlayer,audioGain} from './player';
import {getSettings} from '../settings';
import {AUDIO_AVAILABLE} from './availability';
import type {AudioCue} from './catalog';

it('release mute prevents loading media even with previously enabled personal settings',()=>{
 expect(AUDIO_AVAILABLE).toBe(false);
 const settings={...getSettings(),audioEnabled:true,audioMaster:1,audioMusic:1,audioEffects:1,audioUI:1};
 const factory=vi.fn(),player=new SoundPlayer(factory,()=>settings);
 const cues:AudioCue[]=(['music','effects','ui'] as const).map(channel=>({key:channel,name:channel,channel,url:`/${channel}.wav`,gain:1,loop:channel==='music',license:'test',version:1}));
 player.setCatalog({cues,bindings:[],can_manage:true});player.unlock();player.setMusic('music');
 player.play('effects');player.play('ui');player.visibility(true);player.visibility(false);player.refresh();
 for(const cue of cues)expect(audioGain(cue,settings)).toBe(0);
 expect(factory).not.toHaveBeenCalled();player.dispose();
});
