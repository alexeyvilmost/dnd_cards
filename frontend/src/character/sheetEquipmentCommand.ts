import type {SheetCombatParticipantSeed} from './sheetCombatSession';
import {handleCommand} from '../rules-core/handler';
import {createSequentialIdFactory} from '../rules-core/determinism';
import {prepareSheetAtomicWorldCommit} from './sheetAtomicWorldCommit';
export function prepareSheetEquipmentCommand(participant:SheetCombatParticipantSeed,commandId:string,operation:{equip:string}|{unequip:string},rng:()=>number){
 const {world,catalog}=participant.canonical;
 const result=handleCommand(world,{schemaVersion:1,type:'ChangeEquipment',commandId,expectedRevision:world.revision,
  rulesetContentHash:world.ruleset.contentHash,actorId:participant.character.id,operation},catalog,
  {rng,nextId:createSequentialIdFactory(commandId),clock:()=>world.logicalClock+1});
 if(result.status!=='accepted')throw Error(result.message);
 return prepareSheetAtomicWorldCommit({commandId,participants:[{...participant,world:result.nextState}],events:result.events});
}
