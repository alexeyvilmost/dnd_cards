import {useEffect,useRef} from 'react';
import type {SoloCombatState} from '../solo-combat/types';
import type {CombatBeat} from '../solo-combat/presentation';
import {playCombatBeat,enteredTerrainSounds} from './combatSounds';
import {soundPlayer} from './player';
export function useCombatAudio(state:SoloCombatState|null,playing:CombatBeat|null,opening:SoloCombatState|null,blocked:boolean){
 const previous=useRef<SoloCombatState|null>(null),ending=useRef<'victory'|'defeat'|null>(null);
 useEffect(()=>{if(opening)soundPlayer.play('combat.start',`initiative:${opening.world.id}:${opening.log[0]?.id}`);},[opening]);
 useEffect(()=>{if(state&&playing)playCombatBeat(state,playing);},[state,playing]);
 useEffect(()=>{
  const old=previous.current;previous.current=state;
  if(!state||!old)return;
  for(const cue of enteredTerrainSounds(old,state))soundPlayer.play(cue,`${cue}:${state.boardRevision}:${state.log.at(-1)?.id}`);
  if(old.outcome==='active'&&state.outcome!=='active')ending.current=state.outcome;
 },[state]);
 useEffect(()=>{if(!blocked&&ending.current&&state){const result=ending.current;ending.current=null;soundPlayer.play(`combat.${result}`,`outcome:${state.characterId}:${state.log.at(-1)?.id}`);soundPlayer.setMusic('music.camp');}},[blocked,state]);
}
