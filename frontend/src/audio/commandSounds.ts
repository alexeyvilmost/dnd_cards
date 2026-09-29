import type {EngineEvent} from '../mvp/contracts';
import type {SoundPlayer} from './player';
/** Shop, rest and generic command effects are outside the approved combat
 * sound library. Retain these call boundaries without reviving legacy cues. */
export function playCommandSound(_type:string,_commandId:string,_player?:SoundPlayer):void{}
export function playCommittedEvents(_events:EngineEvent[],_commandId:string,_player?:SoundPlayer):void{}