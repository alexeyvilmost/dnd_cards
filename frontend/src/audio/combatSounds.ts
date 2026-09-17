import type {SoloCombatState} from '../solo-combat/types';
import type {CombatBeat} from '../solo-combat/presentation';
import {soundPlayer,type SoundPlayer} from './player';
import {featureCells} from '../solo-combat/boardGeometry';
import {footprintCells,actorFootprint} from '../solo-combat/footprint';

/** Uses the same committed presentation as the map. Provisional rolls stay silent. */
export function playCombatBeat(state:SoloCombatState,beat:CombatBeat,player:SoundPlayer=soundPlayer){
 if(beat.rollPhase==='before-reaction')return;
 const presentation=state.actionPresentation?.[beat.actionId??''];
 const kind=presentation?.entityType??(presentation?.spellRef?'spell':'action');
 const id=presentation?.entityId??presentation?.spellRef?.id??presentation?.actionRef?.id??beat.actionId;
 const entity=(event:'cast'|'hit'|'miss'|'healing')=>id?player.entity(kind,id,event):undefined;
 const cast=entity('cast');
 const missed=beat.cues.some(c=>c.kind==='miss')||['miss','crit_miss'].includes(beat.roll?.outcome??'');
 const healed=beat.cues.some(c=>c.kind==='healing');
 const event=healed?'healing':missed?'miss':'hit';
 const specific=entity(event);
 if(cast)player.play(cast,`cast:${beat.saveGroupId??beat.sourceEntryId??beat.id}`);
 if(specific)player.play(specific,`${event}:${beat.id}`);
 else if(healed)player.play('healing',`healing:${beat.id}`);
 else if(!cast&&beat.visual)player.play(`attack.${beat.visual}.${missed?'miss':'hit'}`,`impact:${beat.id}`);
 if(beat.rollKind!=='save'&&beat.rollKind!=='check'&&beat.roll?.outcome==='crit')player.play('critical.success',`critical:${beat.id}`);
 if(beat.roll?.outcome==='crit_miss')player.play('critical.failure',`critical:${beat.id}`);
}

/** Terrain cues follow accepted positions; hovering/planning never plays footsteps. */
export function enteredTerrainSounds(before:SoloCombatState,after:SoloCombatState):string[]{
 const sounds=new Set<string>();
 for(const [id,token]of Object.entries(after.tokens)){
  const old=before.tokens[id];if(!old||old.position.x===token.position.x&&old.position.y===token.position.y)continue;
  const size=actorFootprint(after.world.actors[id],after),now=footprintCells(token.position,size),previous=footprintCells(old.position,size);
  for(const feature of after.battleMap?.features??[]){
   if(!feature.zone)continue;
   const cells=featureCells(feature),overlap=(points:typeof now)=>points.some(p=>cells.some(c=>c.x===p.x&&c.y===p.y));
   if(overlap(now)&&!overlap(previous))sounds.add(`terrain.${feature.sprite}`);
  }
 }
 return [...sounds];
}
