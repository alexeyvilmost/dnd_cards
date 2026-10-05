// @vitest-environment jsdom
import {act, StrictMode} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {ForgeCharacter} from '../character/types';
import type {SoloCombatState} from '../solo-combat/types';
import {useSoloCombatPersistence} from './useSoloCombatPersistence';

const api=vi.hoisted(()=>({patchRuntime:vi.fn(),postRuntimeCommand:vi.fn()}));
vi.mock('../character/api',()=>({charactersV3Api:api}));
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(reason:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function character(id:string,revision=4):ForgeCharacter{return {
  id,name:id,user_id:'owner',runtime_revision:revision,turn_state:{preserved:'unrelated'},
  system_id:'dnd5e-2024',ruleset_version:'2024',character_type:'free',character_schema_version:1,
  level:1,max_hp:10,current_hp:9,speed:30,proficiency_bonus:2,access_mode:'owner',
  created_at:'2026-10-04T00:00:00Z',updated_at:'2026-10-04T00:00:00Z',
};}
function state(ids:string[]):SoloCombatState{
  const runtime={hp:{current:9,max:10,temp:0},resources:{charge:1},maxResources:{charge:2},activeEffects:[],inventory:[{cardId:'declared-item',qty:2}],equipment:{}};
  return {schemaVersion:1,characterId:ids[0],controlledCharacterIds:ids,runtimeRevision:4,
    participantRuntimeRevisions:Object.fromEntries(ids.map(id=>[id,4])),outcome:'active',outcomeFinalized:true,
    world:{id:'world-owned',revision:12,ruleset:{systemId:'dnd5e-2024',releaseId:'pinned',contentHash:'original-content',errataVersion:'1'},
      actors:Object.fromEntries(ids.map(id=>[id,{id,runtime:structuredClone(runtime)}])),objects:{}},
    log:[],rng:{seed:'unchanged',counter:13},actionPresentation:{},
  } as unknown as SoloCombatState;
}

describe('legacy combat persistence route ownership',()=>{
  let root:Root,host:HTMLDivElement,id:string;
  let commands:ReturnType<typeof useSoloCombatPersistence>;
  let options:Omit<Parameters<typeof useSoloCombatPersistence>[0],'id'>;
  const setCharacter=vi.fn(),setParticipantCharacters=vi.fn(),setState=vi.fn(),setBusy=vi.fn(),setError=vi.fn(),navigate=vi.fn();
  function Harness(){commands=useSoloCombatPersistence({...options,id});return null;}
  const render=()=>act(async()=>root.render(<StrictMode><Harness/></StrictMode>));
  async function leave(mode:'route'|'unmount'){
    if(mode==='route'){id='b';options.characterRef.current=character('b');options.participantCharactersRef.current={b:character('b')};await render();}
    else await act(async()=>root.render(null));
    setCharacter.mockClear();setParticipantCharacters.mockClear();setState.mockClear();setBusy.mockClear();setError.mockClear();navigate.mockClear();
  }
  beforeEach(async()=>{
    vi.clearAllMocks();id='a';options={roguelikeRunId:null,characterRef:{current:character('a')},participantCharactersRef:{current:{a:character('a'),ally:character('ally')}},setCharacter,setParticipantCharacters,setState,setBusy,setError,navigate};
    host=document.createElement('div');document.body.append(host);root=createRoot(host);await render();
  });
  afterEach(async()=>{await act(async()=>root.unmount());host.remove();});

  it.each([['single','route'],['party','route'],['single','unmount'],['party','unmount']] as const)('ignores late %s save publication and busy reset after %s',async(kind,mode)=>{
    const response=deferred<unknown>();const operation=kind==='single'?api.patchRuntime:api.postRuntimeCommand;operation.mockReturnValueOnce(response.promise);
    const next=state(kind==='single'?['a']:['a','ally']),before=JSON.stringify(next);
    let saving!:Promise<void>;await act(async()=>{saving=commands.persist(next);});
    expect(operation).toHaveBeenCalledTimes(1);const request=structuredClone(operation.mock.calls[0]);
    await leave(mode);const current=options.characterRef.current,participants=options.participantCharactersRef.current;
    await act(async()=>{response.resolve(kind==='single'?character('a',5):{participants:['a','ally'].map(character_id=>({character_id,runtime_revision:5,character:character(character_id,5)}))});await saving;});
    expect(options.characterRef.current).toBe(current);expect(options.participantCharactersRef.current).toBe(participants);
    expect(setCharacter).not.toHaveBeenCalled();expect(setParticipantCharacters).not.toHaveBeenCalled();expect(setState).not.toHaveBeenCalled();expect(setBusy).not.toHaveBeenCalled();
    expect(operation).toHaveBeenCalledTimes(1);expect(operation.mock.calls[0]).toEqual(request);expect(JSON.stringify(next)).toBe(before);
  });

  it.each(['route','unmount'] as const)('does not publish a late apply error after %s',async mode=>{
    const response=deferred<ForgeCharacter>();api.patchRuntime.mockReturnValueOnce(response.promise);
    await act(async()=>commands.apply(state(['a'])));await leave(mode);
    await act(async()=>response.reject(Error('Old local save failed')));
    expect(setError).not.toHaveBeenCalled();expect(setBusy).not.toHaveBeenCalled();expect(api.patchRuntime).toHaveBeenCalledTimes(1);
  });

  it.each([['success','route'],['error','route'],['success','unmount'],['error','unmount']] as const)('does not publish late reset %s or navigate after %s',async(outcome,mode)=>{
    const response=deferred<ForgeCharacter>();api.patchRuntime.mockReturnValueOnce(response.promise);
    let resetting!:Promise<void>;await act(async()=>{resetting=commands.resetStaleCombat();});await leave(mode);const current=options.characterRef.current;
    await act(async()=>{if(outcome==='success')response.resolve(character('a',5));else response.reject(Error('Old reset failed'));await resetting;});
    expect(options.characterRef.current).toBe(current);expect(setCharacter).not.toHaveBeenCalled();expect(setError).not.toHaveBeenCalled();expect(setBusy).not.toHaveBeenCalled();expect(navigate).not.toHaveBeenCalled();
    expect(api.patchRuntime).toHaveBeenCalledTimes(1);
  });

  it.each(['single','party'] as const)('preserves canonical %s save payload and publishes the accepted revision once',async kind=>{
    const next=state(kind==='single'?['a']:['a','ally']),before=JSON.stringify(next);
    if(kind==='single')api.patchRuntime.mockResolvedValueOnce(character('a',8));
    else api.postRuntimeCommand.mockResolvedValueOnce({participants:['a','ally'].map(character_id=>({character_id,runtime_revision:8,character:character(character_id,8)}))});
    await act(async()=>commands.persist(next));
    expect(setState).toHaveBeenCalledOnce();expect(setState.mock.calls[0][0].runtimeRevision).toBe(8);
    expect(options.characterRef.current?.runtime_revision).toBe(8);expect(setBusy.mock.calls).toEqual([[true],[false]]);expect(JSON.stringify(next)).toBe(before);
    if(kind==='single')expect(api.patchRuntime).toHaveBeenCalledWith('a',expect.objectContaining({expected_runtime_revision:4,inventory_items:[{card_id:'declared-item',qty:2}]}),undefined);
    else{
      const payload=api.postRuntimeCommand.mock.calls[0][0];expect(typeof payload.command_id).toBe('string');expect(payload.command_id.length).toBeGreaterThan(8);
      expect(payload.ruleset_ref).toEqual({system_id:'dnd5e-2024',release_id:'pinned',content_hash:'original-content',errata_version:'1'});
      expect(payload.participants.map((entry:{character_id:string;expected_runtime_revision:number})=>[entry.character_id,entry.expected_runtime_revision])).toEqual([['a',4],['ally',4]]);
    }
  });

  it.each(['success','error'] as const)('keeps the current route reset %s behavior',async outcome=>{
    if(outcome==='success')api.patchRuntime.mockResolvedValueOnce(character('a',5));
    else api.patchRuntime.mockRejectedValueOnce(Error('Current reset failed'));
    await act(async()=>commands.resetStaleCombat());
    expect(api.patchRuntime).toHaveBeenCalledWith('a',{expected_runtime_revision:4,turn_state:{preserved:'unrelated'}},undefined);
    if(outcome==='success'){
      expect(options.characterRef.current?.runtime_revision).toBe(5);expect(navigate).toHaveBeenCalledExactlyOnceWith('/characters-v3/a');expect(setError).not.toHaveBeenCalled();
    }else{
      expect(setError).toHaveBeenCalledExactlyOnceWith('Current reset failed');expect(setBusy.mock.calls).toEqual([[true],[false]]);expect(navigate).not.toHaveBeenCalled();
    }
  });

  it('does not submit a stale callback after leaving its route and returning to the same character',async()=>{
    const stale=commands;await leave('route');id='a';options.characterRef.current=character('a');await render();
    await act(async()=>{stale.apply(state(['a']));await stale.persist(state(['a']));await stale.resetStaleCombat();});
    expect(api.patchRuntime).not.toHaveBeenCalled();expect(api.postRuntimeCommand).not.toHaveBeenCalled();expect(setBusy).not.toHaveBeenCalled();expect(setError).not.toHaveBeenCalled();
  });
});
