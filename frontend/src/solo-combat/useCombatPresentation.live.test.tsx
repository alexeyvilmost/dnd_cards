// @vitest-environment jsdom
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {ActorState} from '../rules-core/domain';
import type {CombatLogEntry, SoloCombatState} from './types';
import type {RollLog} from '../mvp/contracts';
import {useCombatPresentation} from './useCombatPresentation';
import {combatAnimationTiming} from './animationTiming';
import {MOVEMENT_STEP_SECONDS,movementDurationForTransition} from '../battle3d/movementAnimation';
import {setSetting} from '../settings';
import compiled from '../pages/rulesLabFixture.generated.json';

(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
const actor = compiled.roots.magicInitiateFighter.actor as unknown as ActorState;
const roll: RollLog = {kind: 'd20', dice: [{sides: 20, result: 16}], modifiers: [], total: 16,
  advantage: 'none', outcome: 'hit', target: {type: 'ac', value: 12}, text: '16'};
const state = (log: CombatLogEntry[], hp: number): SoloCombatState => ({
  characterId: 'hero', outcome: 'active', log,
  sideByActorId: {hero: 'party', first: 'enemy', second: 'enemy'},
  world: {actors: Object.fromEntries(['hero', 'first', 'second'].map(id => [id, {...actor, id, name: id,
    runtime: {...actor.runtime, hp: {current: id === 'hero' ? hp : 20, max: 20, temp: 0}}}])),
    scene: {mode: 'encounter', round: 1, initiative: ['hero', 'first', 'second'], activeIndex: 0, turnStarted: true}},
  tokens: Object.fromEntries(['hero', 'first', 'second'].map((id, x) => [id, {actorId: id, color: 'red', position: {x, y: 1}}])),
  catalogActions: [],
} as unknown as SoloCombatState);
const hit = (source: string, amount: number): CombatLogEntry => ({id: `${source}-hit`, round: 1, actorId: source,
  text: 'Сохранённый результат', records: [
    {kind: 'engine', ordinal: 0, sourceActorId: source, actorId: source, targetIds: ['hero'], event: {type: 'roll', label: 'Атака', roll}},
    {kind: 'engine', ordinal: 1, sourceActorId: source, actorId: source, targetIds: ['hero'], event: {type: 'damage', amount, damageType: 'slashing'}},
  ]});
let current: ReturnType<typeof useCombatPresentation>;
function Harness({combat, opening = null}: {combat: SoloCombatState; opening?: SoloCombatState | null}) {current = useCombatPresentation(combat, opening); return null;}

describe('live combat presentation without authority changes', () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    vi.useFakeTimers();
    let stored: string | null = null;
    vi.stubGlobal('localStorage', {getItem: () => stored, setItem: (_key: string, value: string) => {stored = value;}});
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
    setSetting('combatRollMode', 'standard'); setSetting('enemyCombatRollMode', 'standard');
  });
  afterEach(async () => {await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals();});

  it('keeps HP before each of two enemy hits until its visible contact, then reconciles the saved state', async () => {
    const before = state([], 20);
    const committed = state([hit('first', 4), hit('second', 5)], 11);
    const saved = JSON.stringify(committed);
    await act(async () => root.render(<Harness combat={before}/>));
    await act(async () => root.render(<Harness combat={committed}/>));
    expect(current.displayState?.world.actors.hero.runtime.hp.current).toBe(20);
    expect(current.displayState?.log).toEqual([]);
    expect(current.beat?.sourceId).toBe('first');
    await act(async () => current.closeAttack());
    const contact = Math.floor(combatAnimationTiming(current.playing?.animation).contactMs);
    await act(async () => vi.advanceTimersByTime(contact - 1));
    expect(current.displayState?.world.actors.hero.runtime.hp.current).toBe(20);
    await act(async () => vi.advanceTimersByTime(1));
    expect(current.displayState?.world.actors.hero.runtime.hp.current).toBe(16);
    expect(current.displayState?.log).toEqual([]);
    await act(async () => vi.advanceTimersByTime(1800 - contact));
    expect(current.beat?.sourceId).toBe('second');
    expect(current.displayState?.world.actors.hero.runtime.hp.current).toBe(16);
    expect(current.displayState?.log.map(entry => entry.id)).toEqual(['first-hit']);
    await act(async () => current.closeAttack());
    await act(async () => vi.advanceTimersByTime(contact));
    expect(current.displayState?.world.actors.hero.runtime.hp.current).toBe(11);
    await act(async () => vi.advanceTimersByTime(1800 - contact));
    expect(current.blocked).toBe(false);
    expect(current.displayState).toBe(committed);
    expect(JSON.stringify(committed)).toBe(saved);
  });

  it('does not animate, reroll or reapply already saved enemy hits on reload or an identical command response', async () => {
    const committed = state([hit('first', 4), hit('second', 5)], 11);
    await act(async () => root.render(<Harness combat={committed}/>));
    expect(current.displayState).toBe(committed);
    expect(current.blocked).toBe(false); expect(current.playing).toBeNull();
    await act(async () => root.render(<Harness combat={JSON.parse(JSON.stringify(committed)) as SoloCombatState}/>));
    await act(async () => vi.advanceTimersByTime(10000));
    expect(current.displayState?.world.actors.hero.runtime.hp.current).toBe(11);
    expect(current.blocked).toBe(false); expect(current.playing).toBeNull(); expect(current.beat).toBeUndefined();
  });

  it('applies a contact once even if animation settings change while the result remains visible', async () => {
    await act(async () => root.render(<Harness combat={state([], 20)}/>));
    await act(async () => root.render(<Harness combat={state([hit('first', 4), hit('second', 5)], 11)}/>));
    await act(async () => current.closeAttack());
    const contact = Math.floor(combatAnimationTiming(current.playing?.animation).contactMs);
    await act(async () => vi.advanceTimersByTime(contact));
    expect(current.displayState?.world.actors.hero.runtime.hp.current).toBe(16);
    await act(async () => setSetting('enemyCombatRollMode', 'field'));
    await act(async () => vi.advanceTimersByTime(contact));
    expect(current.displayState?.world.actors.hero.runtime.hp.current).toBe(16);
  });

  it('uses the exact opening snapshot before initial enemy hits without replaying its existing initiative history', async () => {
    const initial: CombatLogEntry = {id: 'initiative', round: 1, actorId: 'hero', text: 'Инициатива', records: []};
    const opening = state([initial], 20);
    const committed = state([initial, hit('first', 4), hit('second', 5)], 11);
    await act(async () => root.render(<Harness combat={committed} opening={opening}/>));
    expect(current.initiative).toBe(opening);
    expect(current.displayState?.world.actors.hero.runtime.hp.current).toBe(20);
    expect(current.displayState?.log.map(entry => entry.id)).toEqual(['initiative']);
    await act(async () => current.closeInitiative());
    expect(current.beat?.sourceId).toBe('first');
    await act(async () => current.closeAttack());
    await act(async () => vi.advanceTimersByTime(1800));
    expect(current.displayState?.world.actors.hero.runtime.hp.current).toBe(16);
    expect(current.beat?.sourceId).toBe('second');
    await act(async () => current.closeAttack());
    await act(async () => vi.advanceTimersByTime(1800));
    expect(current.displayState).toBe(committed);
  });

  it('finishes the actual enemy detour before presenting its attack instead of using endpoint distance', async () => {
    const before = state([], 20);
    const from = before.tokens.first.position;
    const to = {x: 2, y: 1};
    before.monsterMovement = {actorId: 'first', steps: [
      {x: 1, y: 2}, {x: 1, y: 3}, {x: 1, y: 4}, {x: 2, y: 4}, {x: 3, y: 4},
      {x: 3, y: 3}, {x: 3, y: 2}, {x: 3, y: 1}, to,
    ]};
    const move: CombatLogEntry = {id: 'detour', round: 1, actorId: 'first', text: 'Перемещение', records: [
      {kind: 'movement', ordinal: 0, sourceActorId: 'first', actorId: 'first', targetIds: ['first'], movement: {from, to}},
    ]};
    const committed = state([move, hit('first', 4)], 16);
    committed.tokens.first = {...committed.tokens.first, position: to};
    const duration = movementDurationForTransition(before, committed, 'first');
    expect(duration).toBe(9 * 190);
    await act(async () => root.render(<Harness combat={before}/>));
    await act(async () => root.render(<Harness combat={committed}/>));
    expect(current.playing?.sourceEntryId).toBe('detour');
    await act(async () => vi.advanceTimersByTime(duration - 1));
    expect(current.playing?.sourceEntryId).toBe('detour');
    expect(current.beat).toBeUndefined();
    expect(current.displayState?.world.actors.hero.runtime.hp.current).toBe(20);
    await act(async () => vi.advanceTimersByTime(1));
    expect(current.beat?.sourceEntryId).toBe('first-hit');
  });

  it.each([2,4])('uses the same pace for %i cells of ordinary movement and approach, then a separate attack', async count => {
    const before=state([],20);
    before.tokens.hero.position={x:1,y:1};
    before.tokens.first.position={x:8,y:8};before.tokens.second.position={x:9,y:8};
    const points=[before.tokens.hero.position,...Array.from({length:count},(_,index)=>({x:index+2,y:1}))];
    before.playerMovement={actorId:'hero',origin:points[0],steps:points.slice(1)};
    const moves:CombatLogEntry[]=points.slice(1).map((to,index)=>({id:`step-${index}`,round:1,actorId:'hero',text:'Перемещение',records:[
      {kind:'movement',ordinal:0,sourceActorId:'hero',actorId:'hero',targetIds:['hero'],movement:{from:points[index],to}},
    ]}));
    const moved=structuredClone(before);moved.log=moves;moved.tokens.hero.position=points.at(-1)!;delete moved.playerMovement;
    const stepMs=MOVEMENT_STEP_SECONDS*1000,duration=count*stepMs;
    await act(async()=>root.render(<Harness combat={before}/>));
    await act(async()=>root.render(<Harness combat={moved}/>));
    expect(current.playing?.sourceEntryId).toBe(moves.at(-1)!.id);
    await act(async()=>vi.advanceTimersByTime(duration-1));
    expect(current.playing).not.toBeNull();
    await act(async()=>vi.advanceTimersByTime(1));
    expect(current.playing).toBeNull();expect(current.blocked).toBe(false);

    const attack:CombatLogEntry={id:'approach-attack',round:1,actorId:'hero',text:'Атака',records:[
      {kind:'engine',ordinal:0,sourceActorId:'hero',actorId:'hero',targetIds:['first'],event:{type:'roll',label:'Атака',roll}},
      {kind:'engine',ordinal:1,sourceActorId:'hero',actorId:'hero',targetIds:['first'],event:{type:'damage',amount:4,damageType:'slashing'}},
    ]};
    const approached=structuredClone(moved);approached.log=[...moves,attack];approached.world.actors.first.runtime.hp.current=16;
    const authoritative=JSON.stringify(approached);
    await act(async()=>root.render(<Harness combat={before}/>));
    await act(async()=>root.render(<Harness combat={approached}/>));
    for(const move of moves) {
      expect(current.playing?.sourceEntryId).toBe(move.id);
      await act(async()=>vi.advanceTimersByTime(stepMs-1));
      expect(current.playing?.sourceEntryId).toBe(move.id);expect(current.beat).toBeUndefined();
      await act(async()=>vi.advanceTimersByTime(1));
    }
    expect(current.beat?.sourceEntryId).toBe(attack.id);
    expect(current.displayState?.world.actors.first.runtime.hp.current).toBe(20);
    await act(async()=>current.closeAttack());
    await act(async()=>vi.advanceTimersByTime(stepMs));
    expect(current.playing?.sourceEntryId).toBe(attack.id);
    await act(async()=>vi.advanceTimersByTime(1800-stepMs));
    expect(current.displayState).toBe(approached);
    expect(JSON.stringify(approached)).toBe(authoritative);
  });
});
