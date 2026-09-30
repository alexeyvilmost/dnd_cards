import type {ActorState} from '../rules-core/domain';
import type {GridPosition,RecentStraightMovement} from './types';
import {payloadsOf} from '../engine/mechanicsView';
import {collectModifiers,foldModifiers} from '../engine/modifiers';
import {matchesWhen} from '../engine/circumstances';
import {projectRuntimeCharacter} from '../engine/runtimeCharacterProjection';
export function actorLongJumpFt(actor:ActorState,from:GridPosition,to:GridPosition,runup?:RecentStraightMovement,round?:number):number{
 const character=projectRuntimeCharacter(actor.character,actor.runtime);
 const strength=character.abilityScores?.str;
 if(typeof strength!=='number'||!Number.isFinite(strength)||strength<0)return 0;
 const direction={x:Math.sign(to.x-from.x),y:Math.sign(to.y-from.y)};
 const running=!!runup&&!runup.interrupted&&runup.distanceFt>=10&&runup.round===round
  &&runup.to.x===from.x&&runup.to.y===from.y&&runup.direction.x===direction.x&&runup.direction.y===direction.y;
 const context={state:actor.runtime,character};
 const standing=[...(actor.passives??[]),...actor.runtime.activeEffects.filter(e=>e.roundsLeft===undefined||e.roundsLeft>0).map(e=>e.mechanics)]
  .flatMap(payloadsOf).some(payload=>payload.kind==='movement_policy'&&payload.standing_jump===true&&matchesWhen(payload.when as Record<string,unknown>[]|undefined,context));
 const modifiers=collectModifiers(actor.runtime,actor.passives??[],{roll:'jump_distance',evalCtx:context,formulaCtx:{abilityMods:character.abilityMods,profBonus:character.profBonus,selfLevel:character.level}});
 return Math.max(0,Math.floor(foldModifiers(running||standing?strength:strength/2,modifiers).value));
}

/** Upper limit for the movement picker. A valid run-up can extend only its
 * own direction; route previews and execution still check each destination. */
export function maximumActorLongJumpFt(actor:ActorState,from:GridPosition,runup?:RecentStraightMovement,round?:number):number{
 const direction=runup?.direction??{x:1,y:0};
 return actorLongJumpFt(actor,from,{x:from.x+direction.x,y:from.y+direction.y},runup,round);
}
