import {describe,it,expect,vi} from 'vitest';
import {playCombatBeat,enteredTerrainSounds} from './combatSounds';
import {playCommandSound,playCommittedEvents} from './commandSounds';
import type {SoundPlayer} from './player';
import type {SoloCombatState} from '../solo-combat/types';
import type {CombatBeat} from '../solo-combat/presentation';
const beat:CombatBeat={id:'one',sourceId:'hero',sourceName:'Hero',actionName:'Anything',actionId:'ability',visual:'magic',cues:[]};
const state={actionPresentation:{ability:{entityType:'action',entityId:'source'}}} as unknown as SoloCombatState;
const player=()=>({play:vi.fn(),entity:vi.fn()}) as unknown as SoundPlayer;
describe('accepted presentation audio',()=>{
 it.each(['slashing','piercing','bludgeoning','ranged','magic'] as const)('separates %s hits and misses',visual=>{
  const p=player();playCombatBeat(state,{...beat,visual},p);expect(p.play).toHaveBeenLastCalledWith(`attack.${visual}.hit`,'impact:one');
  playCombatBeat(state,{...beat,visual,cues:[{actorId:'enemy',kind:'miss',text:'Промах'}]},p);expect(p.play).toHaveBeenLastCalledWith(`attack.${visual}.miss`,'impact:one');
 });
 it('never sounds a hit while a reaction can change it',()=>{const p=player();playCombatBeat(state,{...beat,rollPhase:'before-reaction'},p);expect(p.play).not.toHaveBeenCalled();});
 it.each([['action','dragon','custom.breath'],['spell','unrelated-star','custom.star']])('reads %s assignments, independent of name', (type,id,cue)=>{
  const p=player();vi.mocked(p.entity).mockImplementation((kind,key,event)=>kind===type&&key===id&&event==='cast'?cue:undefined);
  const s={actionPresentation:{ability:{entityType:type,entityId:id}}} as unknown as SoloCombatState;
  playCombatBeat(s,{...beat,saveGroupId:'cast-group'},p);expect(p.play).toHaveBeenCalledExactlyOnceWith(cue,'cast:cast-group');
 });
 it('healing and successful commerce/rest events use their committed IDs',()=>{
  const p=player();playCombatBeat(state,{...beat,cues:[{actorId:'hero',kind:'healing',text:'+5'}]},p);expect(p.play).toHaveBeenLastCalledWith('healing','healing:one');
  playCommandSound('buy_cart','purchase-id',p);expect(p.play).toHaveBeenLastCalledWith('shop.buy','command:purchase-id');
  playCommittedEvents([{type:'long_rest'}],'rest-id',p);expect(p.play).toHaveBeenLastCalledWith('rest.long','rest:rest-id');
 });
 it('plays mud/web only on entry, not hovering or loading already inside',()=>{
  const from={tokens:{hero:{position:{x:0,y:0}}},world:{actors:{}},battleMap:{features:[{x:1,y:0,width:2,height:1,sprite:'mud',zone:{}},{x:4,y:0,width:1,height:1,sprite:'web',zone:{}}]}} as unknown as SoloCombatState;
  const at=(x:number)=>({...from,tokens:{hero:{...from.tokens.hero,position:{x,y:0}}}});
  expect(enteredTerrainSounds(from,from)).toEqual([]);expect(enteredTerrainSounds(from,at(1))).toEqual(['terrain.mud']);expect(enteredTerrainSounds(at(1),at(2))).toEqual([]);expect(enteredTerrainSounds(at(2),at(4))).toEqual(['terrain.web']);
 });
});
