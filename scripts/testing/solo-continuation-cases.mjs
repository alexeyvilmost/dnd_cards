import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const decode=value=>value&&typeof value==='object'?value.__captureUndefined?undefined:value.__captureFunction?undefined:Array.isArray(value)?value.map(decode):Object.fromEntries(Object.entries(value).map(([key,entry])=>[key,decode(entry)])):value;
export function soloContinuationCases() {
  const base=new URL('../../frontend/src/solo-combat/testing/fixtures/durable-continuations-v1/',import.meta.url);
  const manifest=JSON.parse(readFileSync(new URL('manifest.json',base),'utf8'));
  const bytes=gunzipSync(readFileSync(new URL(manifest.file,base)));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),'d1741084ee1b348b77556e0fd69a01d21e09ab9ea4988b66401c9f933d781a25');
  const {cases}=JSON.parse(bytes.toString('utf8'));assert.equal(cases.length,222);
  const boundaries=JSON.parse(readFileSync(new URL('worker-boundaries.json',base),'utf8'));
  assert.equal(boundaries.schemaVersion,1);assert.equal(Object.keys(boundaries.rejections).length,2);
  for(const id of Object.keys(boundaries.rejections))assert.ok(cases.some(row=>row.id===id),'Unknown boundary fixture');
  return cases.map(row=>{
    const args=decode(row.args),state=args[0].world?args[0]:args[0].state;let intent;
    switch(row.name){
      case 'autoResolveSystemDecisions':case 'resumePendingMovement':case 'runMonsterTurn':intent={type:'resume'};break;
      case 'resolveD20Interrupt':intent={type:'d20_interrupt',actorId:args[1],effectId:args[3]};break;
      case 'resolveTriggeredCombatAction':intent={type:'triggered_action',actionId:args[1],choices:args[3],targetIds:args[4]};break;
      case 'resolveCombatDeathSave':intent={type:'death_save',actorId:state.pendingDeathSave.actorId,phase:state.pendingDeathSave.phase,effectId:args[1]};break;
      case 'resolvePlayerSavingThrow':intent={type:'saving_throw',selectedAbility:args[1].selectedAbility};break;
      case 'resolvePlayerReaction':intent={type:'reaction',response:args[1]};break;
      case 'resolveSoloCombatInterception':intent={type:'interception',actorId:args[1]};break;
      case 'resolveSoloCombatTurnStart':intent={type:'turn_start',targetActorId:args[1]};break;
      case 'resolveSoloCombatAlertSwap':intent={type:'alert_swap',actorId:args[1],allyActorId:args[2]};break;
      case 'declineAdditionalMovement':intent={type:'decline_movement',actorId:state.pendingAdditionalMovement.actorId};break;
      case 'moveActor':case 'moveActorAlongRoute':intent={type:'move',actorId:args[0].actorId,destination:args[0].destination};break;
      case 'resolvePlayerShoveOutcome':intent={type:'shove_outcome',outcome:args[1]};break;
      default:throw Error(`No canonical worker intent for ${row.name}`);
    }
    // The pure board API also supports monster movement and deliberately
    // skeletal death-save inputs. Exercise their worker boundary rejection,
    // without pretending those two snapshots are complete player commands.
    const expectedRejection=Object.hasOwn(boundaries.rejections,row.id);
    return {id:row.id,phases:row.phases,name:row.name,state,intent,expectedRejection};
  });
}
