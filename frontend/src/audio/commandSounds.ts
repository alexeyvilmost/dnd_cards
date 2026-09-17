import type {EngineEvent} from '../mvp/contracts';
import type {SoundPlayer} from './player';
import {soundPlayer} from './player';
const commands:Record<string,string>={buy:'shop.buy',buy_cart:'shop.buy',pin:'shop.pin',refresh_shop:'shop.refresh',transfer_item:'item.transfer',short_rest:'rest.short',long_rest:'rest.long',confirm_level_up:'level.up'};
export function playCommandSound(type:string,commandId:string,player:SoundPlayer=soundPlayer){const cue=commands[type];if(cue)player.play(cue,`command:${commandId}`);}
export function playCommittedEvents(events:EngineEvent[],commandId:string,player:SoundPlayer=soundPlayer){
 if(events.some(e=>e.type==='healing'&&e.amount>0))player.play('healing',`healing:${commandId}`);
 if(events.some(e=>e.type==='long_rest'))player.play('rest.long',`rest:${commandId}`);
 else if(events.some(e=>e.type==='short_rest'))player.play('rest.short',`rest:${commandId}`);
}
