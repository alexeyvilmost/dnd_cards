import type {WorldState,GameCommand,CommandResult,PendingResolution} from '../domain';
import type {handleCommand} from '../handler';

export interface PendingReplayCase {
  phase:PendingResolution['type'];
  name:string;
  source:string;
  world:WorldState;
  command:GameCommand;
  catalogMethods:string[];
  dieAware:boolean;
  calls:Array<{name:string;args:unknown[];value?:unknown}>;
  result:Extract<CommandResult,{status:'accepted'}>;
}
export function replayPendingCase(handler:typeof handleCommand,row:PendingReplayCase):CommandResult;
