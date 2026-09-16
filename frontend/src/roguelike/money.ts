import type {RoguelikeRun} from './api';
import {walletInCopper} from '../utils/money';
export function runMoneyCopper(run:RoguelikeRun):number{
 return walletInCopper({...run.character?.currency,gold:run.gold});
}
