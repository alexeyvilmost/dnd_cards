import type {SoloCombatState} from '../solo-combat/types';
import type {CombatBeat} from '../solo-combat/presentation';
import {combatBeatSoundMarkers} from '../solo-combat/animationTiming';
import type {AudioCatalog,SoundEvent} from './catalog';
import {soundPlayer,type SoundPlayer,type ScheduledSound} from './player';

/** Identity comes from the accepted beat and its saved log envelope. Current
 * equipment/action presentation must never change the sound of that event. */
function entityCandidates(state:SoloCombatState,beat:CombatBeat):{type?:string;id:string}[]{
 const entry=state.log?.find(row=>row.id===beat.sourceEntryId);
 const record=entry?.records?.find(row=>`${entry.id}:${row.ordinal}`===beat.id);
 const candidates:{type?:string;id:string}[]=[];
 if(beat.entityRef)candidates.push({type:beat.entityRef.kind,id:beat.entityRef.id});
 if(record?.attackPresentation?.weaponCardId)candidates.push({type:'card',id:record.attackPresentation.weaponCardId});
 for(const id of [...(beat.sourceEntityIds??[]),...(record?.sourceEntityIds??[])]){
  const typed=/^(action|spell|card|item):(.+)$/.exec(id);
  candidates.push(typed?{type:typed[1]==='item'?'card':typed[1],id:typed[2]}:{id});
 }
 if(beat.actionId)candidates.push({id:beat.actionId});
 return candidates;
}

function resolver(state:SoloCombatState,beat:CombatBeat,catalog:AudioCatalog){
 const candidates=entityCandidates(state,beat);
 const hasCue=(key:string|undefined)=>key&&catalog.cues.some(cue=>cue.key===key&&cue.channel==='effects')?key:undefined;
 const entity=(event:SoundEvent)=>{
  for(const candidate of candidates){
   const binding=catalog.bindings.find(row=>row.entity_id===candidate.id&&(!candidate.type||row.entity_type===candidate.type)&&row.event===event);
   const key=hasCue(binding?.cue_key);if(key)return key;
  }
  return undefined;
 };
 // An authored visual variant inherits its declared base's phases while keeping
 // its own timing. Entity bindings and explicit variant phases still override.
 const profile={...catalog.profiles?.[beat.animation?.baseProfileKey??''],...catalog.profiles?.[beat.animation?.key??'']};
 return (event:SoundEvent)=>event==='launch'
  ? entity('launch')??entity('cast')??hasCue(profile?.launch)??hasCue(profile?.cast)
  : entity(event)??hasCue(profile?.[event]);
}

function contactEvent(beat:CombatBeat):'hit'|'miss'|'healing'|undefined{
 if(beat.cues.some(cue=>cue.kind==='healing'))return 'healing';
 if(beat.cues.some(cue=>cue.kind==='damage')||(beat.damage?.length??0)>0)return 'hit';
 if(beat.cues.some(cue=>cue.kind==='miss')||['miss','crit_miss'].includes(beat.roll?.outcome??''))return 'miss';
 if(beat.rollKind!=='save'&&beat.rollKind!=='check'&&['hit','crit'].includes(beat.roll?.outcome??''))return 'hit';
 return undefined;
}

/** A read-only phase plan shared with visual timing. Missing outcomes stay
 * unknown; merely lacking a miss never proves a hit. */
export function combatBeatAudioPlan(state:SoloCombatState,beat:CombatBeat,catalog:AudioCatalog,reducedMotion=false):ScheduledSound[]{
 if(beat.rollPhase==='before-reaction'||beat.suppressAnimation)return [];
 const markers=combatBeatSoundMarkers(beat,reducedMotion);if(!markers)return [];
 const sound=resolver(state,beat,catalog),scope=`combat:${state.world?.id??''}:${beat.saveGroupId??beat.id}`;
 const plan:ScheduledSound[]=[];
 const add=(event:SoundEvent,key:string|undefined,delayMs:number|undefined,owner=beat.id)=>{
  if(key&&delayMs!==undefined)plan.push({key,eventId:`${scope}:${owner}:${event}`,delayMs});
 };
 add('charge',sound('charge'),markers.chargeMs,'source');
 add('launch',sound('launch'),markers.launchMs,'source');
 const rows=beat.saveRows??[beat];
 const groupEvents=new Set<string>();
 for(const row of rows){
  if(row.rollPhase==='before-reaction')continue;
  // A grouped secondary row suppresses only the repeated area animation;
  // its recorded damage/healing/miss remains part of the one confirmed cast.
  const rowMarkers=rows.length>1&&row.suppressAnimation?markers:combatBeatSoundMarkers(row,reducedMotion);
  if(!rowMarkers)continue;
  const event=contactEvent(row),rowSound=resolver(state,row,catalog);
  if(event){
   const key=rowSound(event)??sound(event);
   const coalescingKey=`${event}:${key}`;
   if(!groupEvents.has(coalescingKey)){
    add(event,key,event==='miss'?rowMarkers.missMs:rowMarkers.contactMs,row.id);
    if(rows.length>1)groupEvents.add(coalescingKey);
   }
  }
 }
 // Activation is an explicit profile/entity event, never an inferred attack.
 if(rows.some(row=>row.rollPhase!=='before-reaction'&&row.cues.some(cue=>cue.kind==='effect'||cue.kind==='healing'))){
  const activation=sound('activate');
  if(!plan.some(event=>event.key===activation&&event.delayMs===markers.contactMs))add('activate',activation,markers.contactMs,'source');
 }
 return plan.sort((a,b)=>a.delayMs-b.delayMs);
}

export function playCombatBeat(state:SoloCombatState,beat:CombatBeat,player:SoundPlayer=soundPlayer,reducedMotion=false):()=>void{
 return player.schedule(combatBeatAudioPlan(state,beat,player.catalog,reducedMotion));
}
