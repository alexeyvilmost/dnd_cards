import type {SoloCombatState} from '../types';
import type {DurableContinuationKey} from './durableContinuationMatrix';
export interface DurableReplayCase {id:string;name:string;phases:DurableContinuationKey[];source:string;test:string;args:unknown[];calls:Array<{key:string;input:unknown[];result:unknown}>;result:SoloCombatState}
export function replayDurableCase(engine:typeof import('../engine'),row:DurableReplayCase):SoloCombatState;
