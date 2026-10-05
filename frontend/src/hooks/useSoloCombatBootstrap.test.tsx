// @vitest-environment jsdom
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {ForgeCharacter} from '../character/types';
import type {RoguelikeRun} from '../roguelike/api';
import type {SoloCombatState} from '../solo-combat/types';
import {useSoloCombatBootstrap} from './useSoloCombatBootstrap';

const mocks=vi.hoisted(()=>({character:vi.fn(),run:vi.fn(),command:vi.fn(),initiative:vi.fn(),participant:vi.fn(),refresh:vi.fn()}));
vi.mock('../character/api',()=>({charactersV3Api:{get:mocks.character}}));
vi.mock('../roguelike/api',()=>({roguelikeApi:{get:mocks.run,command:mocks.command,initiativeOptions:mocks.initiative}}));
vi.mock('../api/client',async original=>({...await original<typeof import('../api/client')>(),actionsApi:{getActions:async()=>({actions:[]})}}));
vi.mock('../utils/cardsIndex',()=>({getCardsIndex:async()=>new Map()}));
vi.mock('../character/sheetCombatTargetRuntime',()=>({loadSheetCombatParticipant:mocks.participant}));
vi.mock('../solo-combat/persistence',()=>({readSoloCombatState:(turn:ForgeCharacter['turn_state'])=>turn?.solo_combat_v1}));
vi.mock('../solo-combat/engine',async original=>({...await original<typeof import('../solo-combat/engine')>(),refreshSoloCombatParticipants:mocks.refresh}));
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;

function deferred<T>() {let resolve!:(value:T)=>void;const promise=new Promise<T>(yes=>{resolve=yes;});return {promise,resolve};}
const character=(id:string)=>({id,user_id:'owner',runtime_revision:3,turn_state:{}} as ForgeCharacter);
const state=(id:string)=>({characterId:id,controlledCharacterIds:[id],world:{id:`world-${id}`}} as SoloCombatState);
const run=(id:string)=>({id:`run-${id}`,character_id:id,revision:5,phase:'combat',character:character(id),combat_state:state(id)} as RoguelikeRun);

describe('combat route bootstrap ownership',()=>{
  let root:Root,container:HTMLDivElement;
  let options:Omit<Parameters<typeof useSoloCombatBootstrap>[0],'id'|'roguelikeRunId'>;
  const setState=vi.fn(),setBusy=vi.fn(),setError=vi.fn(),navigate=vi.fn(),persist=vi.fn(),requestChoice=vi.fn();
  function Harness({id,roguelikeRunId}:{id:string;roguelikeRunId:string|null}){useSoloCombatBootstrap({...options,id,roguelikeRunId});return null;}
  const render=(id:string,roguelikeRunId:string|null=`run-${id}`)=>act(async()=>root.render(<Harness id={id} roguelikeRunId={roguelikeRunId}/>));
  beforeEach(()=>{
    vi.clearAllMocks();mocks.character.mockImplementation(async(id:string)=>character(id));mocks.run.mockImplementation(async(id:string)=>run(id.slice(4)));
    mocks.participant.mockResolvedValue({});mocks.refresh.mockImplementation(async({state:current})=>current);
    options={navigate,persist,requestChoice,initialRequestedRef:{current:[]},initialAlliesRef:{current:[]},
      characterRef:{current:null},trustedRunRef:{current:null},participantCharactersRef:{current:{}},
      setCharacter:vi.fn(),setParticipantCharacters:vi.fn(),setOpeningState:vi.fn(),setState,setBusy,setStaleRulesSnapshot:vi.fn(),setError};
    container=document.createElement('div');document.body.append(container);root=createRoot(container);
  });
  afterEach(async()=>{await act(async()=>root.unmount());container.remove();});

  it('does not let a late previous character response replace the current owned battle',async()=>{
    const first=deferred<ForgeCharacter>();mocks.character.mockImplementation((id:string)=>id==='a'?first.promise:Promise.resolve(character(id)));
    await render('a');await render('b');const accepted=options.trustedRunRef.current;
    await act(async()=>first.resolve(character('a')));
    expect(options.trustedRunRef.current).toBe(accepted);expect(accepted?.id).toBe('run-b');
    expect(setState).toHaveBeenLastCalledWith(state('b'));expect(mocks.command).not.toHaveBeenCalled();expect(persist).not.toHaveBeenCalled();
  });

  it.each(['new route','unmount'] as const)('discards restored participant preparation after %s',async mode=>{
    const refreshed=deferred<SoloCombatState>();mocks.refresh.mockReturnValueOnce(refreshed.promise);
    mocks.character.mockImplementation(async(id:string)=>id==='a'?{...character(id),turn_state:{solo_combat_v1:state(id)}}:character(id));
    await render('a',null);expect(mocks.refresh).toHaveBeenCalledOnce();
    if(mode==='new route')await render('b');else await act(async()=>root.render(null));
    const calls=setState.mock.calls.length,rows=options.participantCharactersRef.current;
    await act(async()=>refreshed.resolve(state('a')));
    expect(setState.mock.calls).toHaveLength(calls);expect(options.participantCharactersRef.current).toBe(rows);
    expect(persist).not.toHaveBeenCalled();
  });

  it('reconciles accepted initialization after a lost reply without initializing again',async()=>{
    const admitted={...run('a'),combat_state:undefined,trusted_combat_available:true};
    mocks.run.mockResolvedValueOnce(admitted).mockResolvedValueOnce(run('a'));
    mocks.initiative.mockResolvedValueOnce({enabled:true,run_revision:5,character_id:'a',runtime_revision:3,options:[]});
    mocks.command.mockRejectedValueOnce(new Error('lost reply'));
    await render('a');
    expect(mocks.command).toHaveBeenCalledExactlyOnceWith('run-a',5,'initialize_combat',{});
    expect(mocks.run).toHaveBeenCalledTimes(2);expect(options.trustedRunRef.current?.combat_state).toEqual(state('a'));
    expect(setState).toHaveBeenLastCalledWith(state('a'));expect(setError).toHaveBeenLastCalledWith(null);
    expect(persist).not.toHaveBeenCalled();
  });

  it('refuses mismatched run membership before any initialization or local persistence',async()=>{
    mocks.run.mockResolvedValueOnce(run('foreign'));
    await render('a');
    expect(options.trustedRunRef.current).toBeNull();expect(setState.mock.calls).toEqual([[null]]);
    expect(setError).toHaveBeenLastCalledWith('Этот лист не участвует в активной встрече забега');
    expect(mocks.command).not.toHaveBeenCalled();expect(mocks.participant).not.toHaveBeenCalled();expect(persist).not.toHaveBeenCalled();
  });
});
