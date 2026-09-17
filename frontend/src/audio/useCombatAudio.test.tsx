// @vitest-environment jsdom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,it,expect,vi} from 'vitest';
import {useCombatAudio} from './useCombatAudio';
import {soundPlayer} from './player';
import type {SoloCombatState} from '../solo-combat/types';
vi.mock('./player',()=>({soundPlayer:{play:vi.fn(),setMusic:vi.fn(),entity:vi.fn()}}));
(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const state=(outcome:SoloCombatState['outcome'])=>({characterId:'hero',world:{id:'encounter',actors:{}},tokens:{},log:[{id:'first'}],outcome}) as unknown as SoloCombatState;
function Harness({value,blocked=false,opening=false}:{value:SoloCombatState;blocked?:boolean;opening?:boolean}){useCombatAudio(value,null,opening?value:null,blocked);return null;}
afterEach(()=>vi.clearAllMocks());
it.each(['victory','defeat'] as const)('waits for presentation completion before %s, never replays initial history',async outcome=>{
 const root=createRoot(document.createElement('div'));
 try{
  await act(()=>root.render(<Harness value={state(outcome)}/>));expect(soundPlayer.play).not.toHaveBeenCalled();
  await act(()=>root.render(<Harness value={state('active')} opening/>));expect(soundPlayer.play).toHaveBeenCalledWith('combat.start','initiative:encounter:first');vi.mocked(soundPlayer.play).mockClear();
  const done=state(outcome);await act(()=>root.render(<Harness value={done} blocked/>));expect(soundPlayer.play).not.toHaveBeenCalled();
  await act(()=>root.render(<Harness value={done}/>));expect(soundPlayer.play).toHaveBeenCalledExactlyOnceWith(`combat.${outcome}`,'outcome:hero:first');
  await act(()=>root.render(<Harness value={{...done}}/>));expect(soundPlayer.play).toHaveBeenCalledTimes(1);
 }finally{await act(()=>root.unmount());}
});
