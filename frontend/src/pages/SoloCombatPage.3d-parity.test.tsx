// @vitest-environment jsdom
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {MemoryRouter, Route, Routes} from 'react-router-dom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {readFileSync} from 'node:fs';
import type {BattleSceneProps} from '../battle3d/types';
import type {ActorState, RuleActionDefinition, RulesetReference} from '../rules-core/domain';
import {createWorld} from '../rules-core/domain';
import {stepRoguelikeCombat, type RoguelikeCombatEnvelope, type RoguelikeCombatIntent} from '../roguelike/combatWorker';
import type {RoguelikeRun} from '../roguelike/api';
import type {ForgeCharacter} from '../character/types';
import type {SoloCombatState} from '../solo-combat/types';
import {executeCombatAction} from '../solo-combat/engine';
import compiled from './rulesLabFixture.generated.json';
import {setSetting} from '../settings';
import SoloCombatPage from './SoloCombatPage';

const mocks = vi.hoisted(() => ({
  characterGet:vi.fn(), runGet:vi.fn(), command:vi.fn(),
  choiceRequest:vi.fn(async () => ({})), scene:{current:null as BattleSceneProps | null},
}));
vi.mock('../character/api', () => ({charactersV3Api:{get:mocks.characterGet}}));
vi.mock('../roguelike/api', () => ({roguelikeApi:{get:mocks.runGet, command:mocks.command}}));
vi.mock('../api/client', async original => ({...await original<typeof import('../api/client')>(),
  resourcesApi:{getResources:async () => ({resources:[]})},
}));
vi.mock('../contexts/ChoiceDialogContext', () => ({useChoiceDialog:() => ({request:mocks.choiceRequest})}));
vi.mock('../audio/useCombatAudio', () => ({useCombatAudio:() => undefined}));
vi.mock('../dice/CommittedD20', () => ({D20_ROLL_DURATION_MS:1450,D20_SELECTION_DURATION_MS:400,
  CommittedDie:({value,sides}:{value:number;sides:number}) => <span data-testid="committed-die" data-sides={sides}>{value}</span>,
}));
// Only graphics is replaced. Page lifecycle, real hotbar, shared map projection,
// target/movement handlers, dialogs, command transport and worker remain real.
vi.mock('../battle3d/BattleScene', () => ({default:(props:BattleSceneProps) => {
  mocks.scene.current = props;
  return <div data-testid="mock-r3f">{props.cells.map(cell => <button key={`${cell.position.x}:${cell.position.y}`}
    aria-label={cell.label} data-actor-id={cell.actorId} disabled={cell.blocked && !cell.actorId}
    onMouseEnter={() => props.onHover(cell.position, {x:100,y:100})} onMouseLeave={() => props.onHover(null)}
    onClick={() => props.onCell(cell.position)}>{cell.label}</button>)}</div>;
}}));

(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT = true;

const HASH = `sha256:${'a'.repeat(64)}`;
const HERO = 'parity-archer';
const ENEMY = 'parity-guard';
const OTHER = 'parity-other-guard';

function attack(id:string, name:string, range=60):RuleActionDefinition {
  return {id, name, kind:'nonSpell', sourceEntityIds:[`source:${id}`],
    targeting:{minTargets:1,maxTargets:1,rangeFt:range,requiresLineOfSight:true,allowedRelations:['enemy']},
    mechanics:{activation:{mode:'active',cost:[{resource:'action',amount:1}]},
      targeting:{domain:'actor',actor_targets:true,shape:'single',min_targets:1,max_targets:1,range_ft:range,allowed_relations:['enemy'],requires_line_of_sight:true},
      effects:[{resolution:'attack_roll',ability:'dex',attack_kind:range>5?'weapon_ranged':'weapon_melee',attack_bonus_override:50,vs:'ac',
        on_hit:[{kind:'damage',amount:'3',type:'piercing'}]}]}};
}

function fixtureState():SoloCombatState {
  const ranged = attack('parity-shot','Проверочный выстрел');
  const enemyAttack = attack('parity-spear','Проверочное копьё',5);
  const area:RuleActionDefinition = {id:'parity-area',name:'Проверочная сфера',kind:'nonSpell',sourceEntityIds:['source:area'],
    targeting:{minTargets:1,maxTargets:8,rangeFt:60,requiresLineOfSight:true,allowedRelations:['enemy']},
    mechanics:{activation:{mode:'active',cost:[{resource:'action',amount:1}]},
      targeting:{domain:'actor',actor_targets:true,shape:'area',area:{kind:'sphere',radius_ft:10}},
      effects:[{resolution:'save',who:'target',ability:'dex',dc:30,on_fail:[{kind:'damage',amount:'4',type:'cold'}],on_success:[]}]}};
  const actors = [HERO, ENEMY, OTHER].map((id):ActorState => {
    const base = structuredClone(compiled.roots.magicInitiateFighter.actor) as unknown as ActorState;
    return {...base,id,name:id===HERO?'Лучник':id===ENEMY?'Стражник':'Другой стражник',
      kind:id===HERO?'playerCharacter':'monster',controllerId:id===HERO?'parity-user':'system',
      character:{...base.character,baseSize:2,baseSpeed:30,characterSpeed:30},
      capabilities:{actionIds:id===HERO?[ranged.id,area.id]:[enemyAttack.id]},
      passives:id===HERO?[]:[{id:'ai',kind:'monster_ai',strategy:'melee_chase'}],
      runtime:{...base.runtime,hp:{current:100,max:100,temp:0},activeEffects:[],
        resources:{action:1,bonus_action:1,reaction:1,heroic_inspiration:0},
        maxResources:{action:1,bonus_action:1,reaction:1,heroic_inspiration:0}},
    };
  });
  const world = createWorld({id:'parity-world',ruleset:compiled.source.ruleset as RulesetReference,actors});
  world.scene = {mode:'encounter',initiative:[HERO,ENEMY,OTHER],activeIndex:0,round:1,turnStarted:true};
  return {schemaVersion:1,tacticalFootprints:'sized',routeCommandVersion:1,characterId:HERO,controlledCharacterIds:[HERO],
    runtimeRevision:0,world,catalogActions:[ranged,area,enemyAttack],sideByActorId:{[HERO]:'party',[ENEMY]:'enemy',[OTHER]:'enemy'},
    actorPresentation:{},actionPresentation:{},playerActionIds:[ranged.id,area.id],certifiedPlayerActionIds:[],
    monsterActionIds:{[ENEMY]:[enemyAttack.id],[OTHER]:[enemyAttack.id]},opportunityActionIds:{},resourceBindings:{},
    tokens:{[HERO]:{actorId:HERO,color:'#6bb',position:{x:2,y:5}},[ENEMY]:{actorId:ENEMY,color:'#b66',position:{x:6,y:3}},[OTHER]:{actorId:OTHER,color:'#b66',position:{x:7,y:3}}},
    combatAreas:{},boardRevision:0,movementRemainingFt:{[HERO]:30,[ENEMY]:30,[OTHER]:30},initiativeBonuses:{},
    initiative:[HERO,ENEMY,OTHER].map((actorId,index) => ({actorId,die:18-index,bonus:0,total:18-index})),
    log:[],outcome:'active'};
}

function characterFor(state:SoloCombatState, actorId=state.characterId):ForgeCharacter {
  const actor = state.world.actors[actorId];
  return {id:actorId,name:actor.name,user_id:'parity-user',access_mode:'owner',level:1,system_id:'dnd5e-2024',ruleset_version:'2024',
    runtime_revision:state.runtimeRevision,current_hp:actor.runtime.hp.current,max_hp:actor.runtime.hp.max,
    resources:actor.runtime.resources,max_resources:actor.runtime.maxResources,active_effects:[],turn_state:{}} as unknown as ForgeCharacter;
}

describe('real combat page uses one canonical pipeline in 2D and 3D', () => {
  let container:HTMLDivElement, root:Root, envelope:RoguelikeCombatEnvelope, run:RoguelikeRun;
  const settle = async () => act(async () => {await new Promise(resolve => setTimeout(resolve, 0));});
  const button = (text:string) => Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(row => row.textContent?.trim()===text || row.getAttribute('aria-label')===text)!;
  const click = async (element:HTMLElement) => {expect(element).toBeTruthy(); await act(async () => element.click()); await settle();};
  const mapButton = (label:string) => container.querySelector<HTMLButtonElement>(`[data-testid="${mocks.scene.current?'mock-r3f':'tactical-map'}"] button[aria-label="${label}"]`)!;
  const actorButton = (id:string) => container.querySelector<HTMLButtonElement>(`[data-testid="${mocks.scene.current?'mock-r3f':'tactical-map'}"] button[data-actor-id="${id}"]`)!;
  const choose = (id:string) => click(container.querySelector<HTMLButtonElement>(`[data-action-id="${id}"] button`)!);
  const mount = async (three:boolean, state=fixtureState()) => {
    setSetting('combat3d',three);
    envelope={schemaVersion:1,artifactHash:HASH,entropy:{seed:'parity-seed',cursor:0},state};
    run={id:'parity-run',character_id:state.characterId,revision:1,phase:'combat',status:'active',combat_state:state,character:characterFor(state),
      characters:(state.controlledCharacterIds??[state.characterId]).map(id=>characterFor(state,id)),encounter:{}} as RoguelikeRun;
    mocks.characterGet.mockResolvedValue(run.character);
    mocks.runGet.mockImplementation(async () => structuredClone(run));
    mocks.command.mockImplementation(async (_id:string, revision:number, kind:string, payload:{intent:RoguelikeCombatIntent}) => {
      expect(kind).toBe('combat_intent'); expect(revision).toBe(run.revision);
      envelope=stepRoguelikeCombat(envelope,payload.intent,HASH).envelope;
      run={...run,revision:run.revision+1,combat_state:envelope.state,character:characterFor(envelope.state),
        characters:(envelope.state.controlledCharacterIds??[envelope.state.characterId]).map(id=>characterFor(envelope.state,id))};
      return structuredClone(run);
    });
    await act(async () => root.render(<MemoryRouter initialEntries={[`/characters-v3/${state.characterId}/combat?roguelike=parity-run`]}>
      <Routes><Route path="/characters-v3/:id/combat" element={<SoloCombatPage/>}/></Routes>
    </MemoryRouter>));
    await settle();
    expect(container.querySelectorAll('.initiative-card')).toHaveLength(state.initiative.length);
  };
  beforeEach(() => {
    vi.clearAllMocks(); mocks.scene.current=null;
    const storage = new Map<string,string>();
    vi.stubGlobal('localStorage',{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key)});
    vi.stubGlobal('matchMedia',()=>({matches:true,addEventListener:()=>{},removeEventListener:()=>{}}));
    container=document.createElement('div');document.body.append(container);root=createRoot(container);
  });
  afterEach(async () => {await act(async()=>root.unmount());container.remove();vi.unstubAllGlobals();});

  it('opens combat settings and keeps selected action, initiative and world while switching renderers', async () => {
    await mount(false);
    await choose('parity-shot');
    const before=JSON.stringify(envelope);
    const initiative=container.querySelector('.initiative-ribbon')!.innerHTML;
    expect(container.querySelector('[data-action-id="parity-shot"]')!.className).toContain('is-selected');
    await click(button('Настройки боя'));
    const dialog=document.querySelector('[role="dialog"][aria-label="Настройки"]')!;
    expect(dialog.textContent).toContain('3D бои');
    await click(dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
    expect(container.querySelector('[data-testid="mock-r3f"]')).not.toBeNull();
    expect(container.querySelector('[data-action-id="parity-shot"]')!.className).toContain('is-selected');
    expect(container.querySelector('.initiative-ribbon')!.innerHTML).toBe(initiative);
    expect(JSON.stringify(envelope)).toBe(before);
    expect(mocks.command).not.toHaveBeenCalled();
    await click(button('Закрыть настройки'));
    await act(async()=>setSetting('combat3d',false));mocks.scene.current=null;
    expect(container.querySelector('[data-testid="tactical-map"]')).not.toBeNull();
    expect(container.querySelector('[data-action-id="parity-shot"]')!.className).toContain('is-selected');
  });

  it.each([false,true])('ranged selection, canonical command and real roll dialog work with 3D=%s', async three => {
    await mount(three);
    await choose('parity-shot');
    await act(async()=>actorButton(ENEMY).dispatchEvent(new MouseEvent('mouseover',{bubbles:true})));
    expect(document.querySelector('.combat-hit-chance')?.textContent).toContain('КД');
    if(three) expect(mocks.scene.current?.trajectory).not.toBeNull();
    await click(actorButton(ENEMY));
    expect(mocks.command.mock.calls[0]?.[3].intent).toMatchObject({type:'approach_action',actorId:HERO,actionId:'parity-shot',targetActorId:ENEMY});
    expect(envelope.state.world.actors[HERO].runtime.resources.action).toBe(0);
    expect(envelope.state.tokens[HERO].position).toEqual({x:2,y:5});
    expect(document.querySelector('[role="dialog"][aria-label="Бросок атаки"]')).not.toBeNull();
    expect(envelope.state.log.some(entry=>entry.records?.some(record=>record.event?.type==='roll'))).toBe(true);
  });

  it.each([false,true])('empty-cell area targeting and movement use canonical geometry with 3D=%s', async three => {
    await mount(three);
    await click(mapButton('Клетка 4, 6'));
    expect(mocks.command.mock.calls[0]?.[3].intent).toEqual({type:'move',actorId:HERO,destination:{x:3,y:5}});
    expect(envelope.state.tokens[HERO].position).toEqual({x:3,y:5});
    expect(envelope.state.movementRemainingFt[HERO]).toBe(25);
    await choose('parity-area');
    const cell=mapButton('Клетка 7, 5');
    await act(async()=>cell.dispatchEvent(new MouseEvent('mouseover',{bubbles:true})));
    if(three) expect(mocks.scene.current?.cells.filter(row=>row.areaPreview && row.actorId).map(row=>row.actorId).sort()).toEqual([ENEMY,OTHER].sort());
    await click(cell);
    expect(container.querySelector('.combat-error')?.textContent).toBeFalsy();
    expect(mocks.command.mock.calls.at(-1)?.[3].intent).toMatchObject({type:'action',actionId:'parity-area',worldPosition:{x:6,y:4},targetIds:[ENEMY,OTHER]});
    expect(envelope.state.world.actors[ENEMY].runtime.hp.current).toBe(96);
    expect(envelope.state.world.actors[OTHER].runtime.hp.current).toBe(96);
    expect(envelope.state.world.actors[HERO].runtime.resources.action).toBe(0);
  });

  it.each([false,true])('the same worker executes both enemy turns after ending a player turn with 3D=%s', async three => {
    await mount(three);
    await click(button('Завершить ход'));
    expect(mocks.command.mock.calls[0]?.[3].intent).toEqual({type:'end_turn',actorId:HERO});
    expect(envelope.state.world.scene).toMatchObject({mode:'encounter',round:2,activeIndex:0,initiative:[HERO,ENEMY,OTHER]});
    expect(envelope.state.log.some(entry=>entry.actorId===ENEMY)).toBe(true);
    expect(envelope.state.log.some(entry=>entry.actorId===OTHER)).toBe(true);
    expect(envelope.state.world.actors[HERO].runtime.hp.current).toBeLessThan(100);
    expect(envelope.state.world.actors[HERO].runtime.resources.action).toBe(1);
  });

  it('switching renderers preserves a held roll and its canonical decision until confirmation', async () => {
    const state=fixtureState();
    state.world.actors[HERO].runtime.resources.heroic_inspiration=1;
    state.world.actors[HERO].runtime.maxResources.heroic_inspiration=1;
    await mount(true,state);
    await choose('parity-shot');
    await click(actorButton(ENEMY));
    expect(envelope.state.pendingD20Interrupt?.held).toBeTruthy();
    const held=structuredClone(envelope.state.pendingD20Interrupt!.held!.roll);
    const before=JSON.stringify(envelope);
    const dialog=document.querySelector('[role="dialog"][aria-label="Бросок атаки"]')!;
    expect(dialog.textContent).toContain('Результат ещё не подтверждён');
    expect(envelope.state.world.actors[ENEMY].runtime.hp.current).toBe(100);
    await act(async()=>setSetting('combat3d',false));
    expect(document.querySelector('[role="dialog"][aria-label="Бросок атаки"]')).toBe(dialog);
    expect(JSON.stringify(envelope)).toBe(before);
    expect(mocks.command).toHaveBeenCalledTimes(1);
    await click(button('Продолжить'));
    expect(mocks.command.mock.calls.at(-1)?.[3].intent).toEqual({type:'d20_interrupt',actorId:null});
    expect(envelope.state.pendingD20Interrupt).toBeUndefined();
    expect(envelope.state.world.actors[ENEMY].runtime.hp.current).toBeLessThan(100);
    expect(envelope.state.world.actors[HERO].runtime.resources.heroic_inspiration).toBe(1);
    const attackRolls=envelope.state.log.flatMap(entry=>entry.records??[]).flatMap(record=>
      record.event?.type==='roll' && record.event.roll.kind==='d20' ? [record.event.roll] : []);
    expect(attackRolls.at(-1)?.dice).toEqual(held.dice);
  });

  it.each([false,true])('restores and resolves a canonical defensive reaction with 3D=%s', async three => {
    const state=fixtureState();
    const defense:RuleActionDefinition={id:'parity-ward',name:'Проверочная защита',kind:'nonSpell',sourceEntityIds:['source:ward'],
      targeting:{minTargets:0,maxTargets:1,rangeFt:0,requiresLineOfSight:false,allowedRelations:['self']},
      mechanics:{activation:{mode:'reaction',trigger:{event:'hit_by_attack'},cost:[{resource:'reaction',amount:1}]},
        targeting:{domain:'actor',actor_targets:false,shape:'self',min_targets:0,max_targets:1,range_ft:0,requires_line_of_sight:false,allowed_relations:['self']},
        effects:[],attack_defense:{scope:'triggering_attack',ac_bonus:100}}};
    state.catalogActions.push(defense);
    state.world.actors[HERO].capabilities.actionIds.push(defense.id);
    state.world.scene={mode:'encounter',initiative:[HERO,ENEMY,OTHER],activeIndex:1,round:1,turnStarted:true};
    state.tokens[ENEMY].position={x:3,y:5};
    const pending=executeCombatAction({state,actorId:ENEMY,actionId:'parity-spear',targetIds:[HERO],rng:()=>.5});
    expect(pending.world.pendingResolution).toMatchObject({type:'attack_reaction',request:{actorId:HERO,trigger:{type:'hit_by_attack'}}});
    await mount(three,pending);
    const dialog=document.querySelector('[role="dialog"][aria-label="По вам попали"]')!;
    expect(dialog).not.toBeNull();
    expect(dialog.querySelector(`button[aria-label="${defense.name}"]`)).not.toBeNull();
    expect(envelope.state.world.actors[HERO].runtime.hp.current).toBe(100);
    const before=JSON.stringify(envelope);
    await act(async()=>setSetting('combat3d',!three));
    expect(document.querySelector('[role="dialog"][aria-label="По вам попали"]')).toBe(dialog);
    expect(JSON.stringify(envelope)).toBe(before);
    expect(mocks.command).not.toHaveBeenCalled();
    await click(button(defense.name));
    expect(mocks.command).toHaveBeenCalledTimes(1);
    expect(mocks.command.mock.calls[0][3].intent).toEqual({type:'reaction',response:{kind:'reaction',actionId:defense.id}});
    expect(envelope.state.world.pendingResolution).toBeNull();
    expect(document.querySelector('[role="dialog"][aria-label="По вам попали"]')).toBeNull();
    expect(container.querySelector('.combat-error')?.textContent).toBeFalsy();
  });

  it.skipIf(!process.env.BATTLE3D_COMBAT_SNAPSHOT)('loads an isolated saved encounter and changes only its renderer', async () => {
    const state=JSON.parse(readFileSync(process.env.BATTLE3D_COMBAT_SNAPSHOT!, 'utf8')) as SoloCombatState;
    const snapshot=JSON.stringify(state);
    await mount(true,state);
    const active=container.querySelector('.initiative-card.is-active')!.getAttribute('aria-label');
    const actions=Array.from(container.querySelectorAll('.combat-sheet-action')).map(element=>({id:element.getAttribute('data-action-id'),disabled:element.querySelector('button')?.disabled}));
    expect(actions.length).toBeGreaterThan(0);
    expect(mocks.scene.current?.state.world).toEqual(state.world);
    await act(async()=>setSetting('combat3d',false));
    expect(container.querySelector('[data-testid="tactical-map"]')).not.toBeNull();
    expect(container.querySelector('.initiative-card.is-active')!.getAttribute('aria-label')).toBe(active);
    expect(Array.from(container.querySelectorAll('.combat-sheet-action')).map(element=>({id:element.getAttribute('data-action-id'),disabled:element.querySelector('button')?.disabled}))).toEqual(actions);
    await act(async()=>setSetting('combat3d',true));
    expect(mocks.scene.current?.state.world).toEqual(state.world);
    expect(JSON.stringify(state)).toBe(snapshot);
    expect(mocks.command).not.toHaveBeenCalled();
  });
});
