import {expect,it,vi} from 'vitest';
import {SoundPlayer,audioGain} from './player';
import {playCommandSound,playCommittedEvents} from './commandSounds';
import {getSettings} from '../settings';
import {AUDIO_AVAILABLE} from './availability';
import type {AudioCue} from './catalog';

it('enables the approved audio catalog while old interface and command effects remain silent',()=>{
 expect(AUDIO_AVAILABLE).toBe(true);
 const settings={...getSettings(),audioEnabled:true,audioMaster:1,audioMusic:1,audioEffects:1,audioUI:1};
 const factory=vi.fn(),player=new SoundPlayer(factory,()=>settings);
 const cue:AudioCue={key:'ui.click',name:'Click',channel:'ui',url:'/old-click.wav',gain:1,loop:false,license:'test',version:1};
 player.setCatalog({cues:[cue],bindings:[],can_manage:false});player.unlock();player.play('ui.click');
 const play=vi.spyOn(player,'play');
 playCommandSound('buy_cart','purchase',player);
 playCommittedEvents([{type:'long_rest'}],'rest',player);
 expect(audioGain(cue,settings)).toBe(0);expect(factory).not.toHaveBeenCalled();expect(play).not.toHaveBeenCalled();player.dispose();
});