// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SoloCombatState } from '../solo-combat/types';
import {createWorld,type ActorState,type RuleActionDefinition} from '../rules-core/domain';
import TacticalBattleMap from './TacticalBattleMap';
import compiled from '../pages/rulesLabFixture.generated.json';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const renderer = vi.hoisted(() => ({combat3d: false}));
vi.mock('../settings', async(importOriginal) => {
  const original = await importOriginal<typeof import('../settings')>();
  return {...original, useSiteSettings: () => ({...original.useSiteSettings(), combat3d: renderer.combat3d})};
});
vi.mock('../battle3d/BattleScene', () => ({default: ({onUnavailable}: {onUnavailable:(reason:string)=>void}) =>
  <button type="button" onClick={()=>onUnavailable('Тестовая недоступность 3D')}>Отключить тестовый 3D</button>}));

describe('TacticalBattleMap world-object clarity', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    renderer.combat3d = false;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  it.each([false, true])('cancels targeting on a battlefield right click (3D: %s) without submitting a cell action', async combat3d => {
    renderer.combat3d = combat3d;
    const base = structuredClone(compiled.roots.magicInitiateFighter.actor);
    const state = {world:{actors:{hero:{...base,id:'hero'}},objects:{},scene:{mode:'encounter',initiative:['hero'],activeIndex:0,round:1}},
      tokens:{hero:{actorId:'hero',position:{x:1,y:1}}},characterId:'hero',sideByActorId:{hero:'party'},catalogActions:[],combatAreas:{}} as unknown as SoloCombatState;
    const onCancelSelection = vi.fn(), onCell = vi.fn();
    await act(async () => root.render(<TacticalBattleMap state={state} actorId="hero" selectedActionId={null}
      movementMode={false} onCell={onCell} onCancelSelection={onCancelSelection}/>));
    const map = container.querySelector('[data-testid="battle-map-3d"], [data-testid="tactical-map-viewport"]')!;
    const event = new MouseEvent('contextmenu', {bubbles:true,cancelable:true,button:2});
    await act(async () => map.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(onCancelSelection).toHaveBeenCalledOnce();
    expect(onCell).not.toHaveBeenCalled();
  });

  it.each(['switch', 'fallback'] as const)('centers a real 2D viewport after initial 3D %s without stale fit flags', async(mode)=>{
    const frames=new Map<number,FrameRequestCallback>();
    let sequence=0;
    vi.spyOn(window,'requestAnimationFrame').mockImplementation(callback=>{frames.set(++sequence,callback);return sequence;});
    vi.spyOn(window,'cancelAnimationFrame').mockImplementation(id=>{frames.delete(id);});
    vi.spyOn(HTMLElement.prototype,'clientWidth','get').mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype,'clientHeight','get').mockReturnValue(500);
    const base=structuredClone(compiled.roots.magicInitiateFighter.actor);
    const state={world:{actors:{hero:{...base,id:'hero'}},objects:{},scene:{mode:'encounter',initiative:['hero'],activeIndex:0,round:1}},
      tokens:{hero:{actorId:'hero',position:{x:1,y:1}}},characterId:'hero',sideByActorId:{hero:'party'},catalogActions:[],combatAreas:{}} as unknown as SoloCombatState;
    const render=()=>root.render(<TacticalBattleMap state={state} actorId="hero" selectedActionId={null} movementMode={false} onCell={()=>{}}/>);
    renderer.combat3d=true;
    await act(async()=>render());
    expect(container.querySelector('[data-testid="tactical-map-viewport"]')).toBeNull();
    expect(frames.size).toBe(0);
    if(mode==='switch') {
      renderer.combat3d=false;
      await act(async()=>render());
    } else {
      await act(async()=>container.querySelector<HTMLButtonElement>('button')!.click());
    }
    for(let pass=0;pass<3&&frames.size;pass++) {
      const queued=[...frames.values()];
      frames.clear();
      await act(async()=>queued.forEach(callback=>callback(0)));
    }
    const viewport=container.querySelector<HTMLElement>('[data-testid="tactical-map-viewport"]')!;
    expect(viewport.scrollLeft).toBe(520);
    expect(viewport.scrollTop).toBe(370);
    expect(container.querySelector('[data-testid="tactical-map"]')?.getAttribute('data-zoom')).toBe('1');
    if(mode==='fallback') expect(container.textContent).toContain('Тестовая недоступность 3D');
    const offsets={left:viewport.scrollLeft,top:viewport.scrollTop};
    const wheel=new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:-100});
    await act(async()=>viewport.dispatchEvent(wheel));
    expect(wheel.defaultPrevented).toBe(true);
    expect(container.querySelector('[data-testid="tactical-map"]')?.getAttribute('data-zoom')).toBe('1.1');
    expect({left:viewport.scrollLeft,top:viewport.scrollTop}).toEqual(offsets);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it.each([[10,20],[7,14]])('shades lost hits on the token for %i/%i without facing arrows or a map strip', async(hp,maxHp) => {
    const base=structuredClone(compiled.roots.magicInitiateFighter.actor);
    const actor={...base,id:'hero',runtime:{...base.runtime,hp:{current:hp,max:maxHp,temporary:0}}};
    const state={world:{actors:{hero:actor},objects:{},scene:{mode:'encounter',initiative:['hero'],activeIndex:0,round:1}},
      tokens:{hero:{actorId:'hero',position:{x:1,y:1},facing:'north'}},characterId:'hero',sideByActorId:{hero:'party'},catalogActions:[],combatAreas:{}} as unknown as SoloCombatState;
    await act(async()=>root.render(<TacticalBattleMap state={state} actorId="hero" selectedActionId={null} movementMode={false} onCell={()=>{}}/>));
    expect((container.querySelector('.battle-token__lost-health') as HTMLElement).style.height).toBe('50%');
    expect(container.querySelector('.battle-token__hp')).toBeNull();
    expect(container.querySelector('.battle-token__facing')).toBeNull();
    expect(container.querySelector('.tactical-map-controls')).toBeNull();
    expect(container.querySelector('.tactical-map-pan-space')).not.toBeNull();
  });

  it('animates a committed step between cells and settles at the authoritative destination',async()=>{
    const callbacks: FrameRequestCallback[]=[];
    vi.spyOn(window,'requestAnimationFrame').mockImplementation(callback=>{callbacks.push(callback);return callbacks.length;});
    vi.spyOn(window,'cancelAnimationFrame').mockImplementation(()=>{});
    const clock=vi.spyOn(performance,'now').mockReturnValue(0);
    const base=structuredClone(compiled.roots.magicInitiateFighter.actor);
    const before={world:{actors:{hero:{...base,id:'hero'}},objects:{},scene:{mode:'encounter',initiative:['hero'],activeIndex:0,round:1}},
      tokens:{hero:{actorId:'hero',position:{x:1,y:1}}},characterId:'hero',sideByActorId:{hero:'party'},catalogActions:[],combatAreas:{},
      playerMovement:{actorId:'hero',steps:[{x:2,y:1}]}} as unknown as SoloCombatState;
    const render=(state:SoloCombatState)=>root.render(<TacticalBattleMap state={state} actorId="hero" selectedActionId={null} movementMode={false} onCell={()=>{}}/>);
    await act(async()=>render(before));
    const after={...before,tokens:{hero:{...before.tokens.hero,position:{x:2,y:1}}},playerMovement:undefined};
    await act(async()=>render(after));
    const moving=container.querySelector('.battle-token-motion') as HTMLElement;
    expect(moving.style.translate).toBe('-80px 0px');
    clock.mockReturnValue(95);
    await act(async()=>callbacks.pop()!(95));
    expect(moving.style.translate).toBe('-40px 0px');
    clock.mockReturnValue(190);
    await act(async()=>callbacks.pop()!(190));
    expect(moving.style.translate).toBe('0px 0px');
  });

  it('shows the destination immediately when reduced motion is requested', async()=>{
    vi.stubGlobal('matchMedia', vi.fn(()=>({matches:true,addEventListener:()=>{},removeEventListener:()=>{}} as unknown as MediaQueryList)));
    const base=structuredClone(compiled.roots.magicInitiateFighter.actor);
    const before={world:{actors:{hero:{...base,id:'hero'}},objects:{},scene:{mode:'encounter',initiative:['hero'],activeIndex:0,round:1}},
      tokens:{hero:{actorId:'hero',position:{x:3,y:2}}},characterId:'hero',sideByActorId:{hero:'party'},catalogActions:[],combatAreas:{},
      playerMovement:{actorId:'hero',steps:[{x:3,y:3}]}} as unknown as SoloCombatState;
    const render=(state:SoloCombatState)=>root.render(<TacticalBattleMap state={state} actorId="hero" selectedActionId={null} movementMode={false} onCell={()=>{}}/>);
    await act(async()=>render(before));
    await act(async()=>render({...before,tokens:{hero:{...before.tokens.hero,position:{x:3,y:3}}},playerMovement:undefined}));
    expect((container.querySelector('.battle-token-motion') as HTMLElement).style.translate).toBe('0px 0px');
  });

  it('shows one enemy hover card after 250ms, without duplicate numbers, while camera input can stay enabled',async()=>{
    vi.useFakeTimers();
    const base=structuredClone(compiled.roots.magicInitiateFighter.actor);
    const enemy={...base,id:'enemy',name:'Страж',runtime:{...base.runtime,hp:{current:7,max:14,temp:0}}};
    const state={characterId:'hero',sideByActorId:{hero:'party',enemy:'enemy',second:'enemy'},
      world:{actors:{hero:{...base,id:'hero'},enemy,second:{...enemy,id:'second'}},objects:{},scene:{mode:'encounter',initiative:['hero','enemy','second'],activeIndex:0,round:1}},
      tokens:{hero:{actorId:'hero',position:{x:0,y:0}},enemy:{actorId:'enemy',position:{x:2,y:1}},second:{actorId:'second',position:{x:4,y:1}}},
      catalogActions:[],combatAreas:{},movementRemainingFt:{hero:30}} as unknown as SoloCombatState;
    const onCell=vi.fn();
    await act(async()=>root.render(<TacticalBattleMap state={state} actorId="hero" selectedActionId={null} movementMode={false} actionsDisabled onCell={onCell}/>));
    expect(container.querySelector('.battle-token__duplicate')).toBeNull();
    const cell=container.querySelector<HTMLButtonElement>('[data-actor-id="enemy"]')!;
    await act(async()=>cell.dispatchEvent(new MouseEvent('mouseover',{bubbles:true,clientX:120,clientY:100})));
    await act(async()=>{await vi.advanceTimersByTimeAsync(249);});
    expect(document.querySelector('.combat-actor-hover-preview')).toBeNull();
    await act(async()=>{await vi.advanceTimersByTimeAsync(1);});
    const preview=document.querySelector('.combat-actor-hover-preview')!;
    expect(preview.textContent).toContain('Страж');
    expect(preview.textContent).toContain('7 / 14');
    expect(preview.textContent).toContain('Нажмите I, чтобы узнать подробнее');
    expect(preview.textContent).not.toContain('Страж · 1');
    expect(preview.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('7');
    await act(async()=>cell.click());
    expect(onCell).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('pans during presentation delivery while cell commands remain blocked',async()=>{
    const base=structuredClone(compiled.roots.magicInitiateFighter.actor);
    const state={characterId:'hero',sideByActorId:{hero:'party'},
      world:{actors:{hero:{...base,id:'hero'}},objects:{},scene:{mode:'encounter',initiative:['hero'],activeIndex:0,round:1}},
      tokens:{hero:{actorId:'hero',position:{x:0,y:0}}},catalogActions:[],combatAreas:{},movementRemainingFt:{hero:30}} as unknown as SoloCombatState;
    const onCell=vi.fn();
    await act(async()=>root.render(<TacticalBattleMap state={state} actorId="hero" selectedActionId={null} movementMode={false} actionsDisabled onCell={onCell}/>));
    const viewport=container.querySelector<HTMLElement>('[data-testid="tactical-map-viewport"]')!;
    viewport.scrollLeft=800;viewport.scrollTop=500;
    viewport.setPointerCapture=vi.fn();viewport.releasePointerCapture=vi.fn();viewport.hasPointerCapture=()=>true;
    const pointer=(type:string,x:number,y:number)=>{
      const event=new MouseEvent(type,{bubbles:true,button:0,clientX:x,clientY:y});
      Object.defineProperties(event,{pointerId:{value:1},isPrimary:{value:true}});
      return event;
    };
    await act(async()=>viewport.dispatchEvent(pointer('pointerdown',100,100)));
    await act(async()=>viewport.dispatchEvent(pointer('pointermove',140,130)));
    expect(viewport.scrollLeft).toBe(760);expect(viewport.scrollTop).toBe(470);
    expect(viewport.getAttribute('data-panning')).toBe('true');
    await act(async()=>viewport.dispatchEvent(pointer('pointerup',140,130)));
    await act(async()=>container.querySelector<HTMLButtonElement>('[data-actor-id="hero"]')!.click());
    expect(onCell).not.toHaveBeenCalled();
  });

  it.each([
    {clientX: 300, clientY: 210, deltaY: -100, deltaX: 0, left: 35, top: 60, scrollLeft: 860, scrollTop: 550},
    {clientX: 745, clientY: 125, deltaY: 0, deltaX: 100, left: 80, top: 95, scrollLeft: 750, scrollTop: 390},
  ])('zooms at the mouse while delivery is blocked, without changing the anchored cell: $clientX/$clientY',async(view)=>{
    vi.spyOn(window,'requestAnimationFrame').mockReturnValue(1);
    vi.spyOn(window,'cancelAnimationFrame').mockImplementation(()=>{});
    vi.spyOn(HTMLElement.prototype,'clientWidth','get').mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype,'clientHeight','get').mockReturnValue(500);
    const originalRect=HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){
      if(this.dataset.testid!=='tactical-map')return originalRect.call(this);
      const viewport=this.closest<HTMLElement>('[data-testid="tactical-map-viewport"]')!;
      const cellSize=parseFloat(this.style.getPropertyValue('--tactical-cell-size'));
      const left=view.left+800-viewport.scrollLeft,top=view.top+500-viewport.scrollTop;
      const width=Number(this.style.getPropertyValue('--board-width'))*cellSize;
      const height=Number(this.style.getPropertyValue('--board-height'))*cellSize;
      return {left,top,width,height,x:left,y:top,right:left+width,bottom:top+height,toJSON:()=>({})};
    });
    const base=structuredClone(compiled.roots.magicInitiateFighter.actor);
    const state={characterId:'hero',sideByActorId:{hero:'party'},
      world:{actors:{hero:{...base,id:'hero'}},objects:{},scene:{mode:'encounter',initiative:['hero'],activeIndex:0,round:1}},
      tokens:{hero:{actorId:'hero',position:{x:0,y:0}}},catalogActions:[],combatAreas:{},movementRemainingFt:{hero:30}} as unknown as SoloCombatState;
    const onCell=vi.fn();
    await act(async()=>root.render(<TacticalBattleMap state={state} actorId="hero" selectedActionId={null} movementMode={false} actionsDisabled onCell={onCell}/>));
    const viewport=container.querySelector<HTMLElement>('[data-testid="tactical-map-viewport"]')!;
    const map=container.querySelector<HTMLElement>('[data-testid="tactical-map"]')!;
    viewport.scrollLeft=view.scrollLeft;viewport.scrollTop=view.scrollTop;
    const cellUnderPointer=()=>{
      const rect=map.getBoundingClientRect(),cellSize=parseFloat(map.style.getPropertyValue('--tactical-cell-size'));
      return {x:(view.clientX-rect.left)/cellSize,y:(view.clientY-rect.top)/cellSize};
    };
    const before=cellUnderPointer();
    const wheel=new WheelEvent('wheel',{...view,bubbles:true,cancelable:true});
    await act(async()=>viewport.dispatchEvent(wheel));
    expect(wheel.defaultPrevented).toBe(true);
    expect(map.getAttribute('data-zoom')).toBe(view.deltaY<0?'1.1':'0.9');
    expect(cellUnderPointer().x).toBeCloseTo(before.x,10);
    expect(cellUnderPointer().y).toBeCloseTo(before.y,10);
    expect(viewport.scrollLeft).not.toBe(view.scrollLeft);
    expect(onCell).not.toHaveBeenCalled();
    // Batched native events must not drop the second step through a stale closure.
    await act(async()=>{
      viewport.dispatchEvent(new WheelEvent('wheel',{clientX:view.clientX,clientY:view.clientY,deltaY:-100,bubbles:true,cancelable:true}));
      viewport.dispatchEvent(new WheelEvent('wheel',{clientX:view.clientX,clientY:view.clientY,deltaY:-100,bubbles:true,cancelable:true}));
    });
    expect(map.getAttribute('data-zoom')).toBe(view.deltaY<0?'1.3':'1.1');
    expect(cellUnderPointer().x).toBeCloseTo(before.x,10);
    expect(cellUnderPointer().y).toBeCloseTo(before.y,10);
  });

  it('cancels native wheel scrolling for vertical, horizontal and zero-delta wheels',async()=>{
    vi.spyOn(window,'requestAnimationFrame').mockReturnValue(1);
    vi.spyOn(window,'cancelAnimationFrame').mockImplementation(()=>{});
    const base=structuredClone(compiled.roots.magicInitiateFighter.actor);
    const state={characterId:'hero',sideByActorId:{hero:'party'},
      world:{actors:{hero:{...base,id:'hero'}},objects:{},scene:{mode:'encounter',initiative:['hero'],activeIndex:0,round:1}},
      tokens:{hero:{actorId:'hero',position:{x:0,y:0}}},catalogActions:[],combatAreas:{},movementRemainingFt:{hero:30}} as unknown as SoloCombatState;
    await act(async()=>root.render(<TacticalBattleMap state={state} actorId="hero" selectedActionId={null} movementMode={false} onCell={()=>{}}/>));
    const viewport=container.querySelector<HTMLElement>('[data-testid="tactical-map-viewport"]')!;
    viewport.scrollLeft=800;viewport.scrollTop=500;
    for(const [deltaY,deltaX,zoom] of [[-100,0,'1.1'],[0,100,'1'],[0,0,'1']] as const) {
      const wheel=new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY,deltaX});
      await act(async()=>viewport.dispatchEvent(wheel));
      expect(wheel.defaultPrevented).toBe(true);
      expect(container.querySelector('[data-testid="tactical-map"]')?.getAttribute('data-zoom')).toBe(zoom);
      expect(viewport.scrollLeft).toBe(800);expect(viewport.scrollTop).toBe(500);
    }
    expect(viewport.classList.contains('site-scrollbar')).toBe(false);
  });

  it.each([[3,2],[4,3]])('renders size %i as one token over %i squared clickable cells',async(size,side)=>{
    const base=structuredClone(compiled.roots.magicInitiateFighter.actor);
    const state={tacticalFootprints:'sized',world:{actors:{hero:{...base,id:'hero',character:{...base.character,baseSize:size}}},objects:{},
      scene:{mode:'encounter',initiative:['hero'],activeIndex:0,round:1}},
      tokens:{hero:{actorId:'hero',position:{x:1,y:1},tokenUrl:'/portrait.png'}},
      characterId:'hero',sideByActorId:{hero:'party'},catalogActions:[],combatAreas:{}} as unknown as SoloCombatState;
    let clicked='';
    await act(async()=>root.render(<TacticalBattleMap state={state} actorId="hero" selectedActionId={null} movementMode={false}
      onCell={(_position,id)=>{clicked=id??'';}}/>));
    expect(container.querySelectorAll('[data-actor-id="hero"]')).toHaveLength(side*side);
    expect(container.querySelectorAll('.battle-token')).toHaveLength(1);
    expect((container.querySelector('.battle-token') as HTMLElement).style.getPropertyValue('--token-size')).toBe(String(side));
    const cells=container.querySelectorAll<HTMLButtonElement>('[data-actor-id="hero"]');
    await act(async()=>cells[cells.length-1].click());
    expect(clicked).toBe('hero');
  });

  it('shows an inspectable Minor Illusion token with its description and counterplay', async () => {
    const state = {
      world: {
        scene: { mode: 'encounter', initiative: ['wizard'], activeIndex: 0, round: 1 },
        actors: {},
        objects: {
          illusion: {
            id: 'illusion', name: 'Minor Illusion', kind: 'spell_effect', size: 'medium',
            sourceActorId: 'wizard', sourceActionId: 'spell:minor-illusion', roundsLeft: 10,
            illusion: {
              form: 'image', description: 'Закрытая железная дверь', spellSaveDc: 13,
              studyAbility: 'int', studySkill: 'investigation', imageCubeSideFt: 5,
              discernedByActorIds: [], physicallyRevealedToActorIds: [],
            },
          },
        },
      },
      tokens: {},
      worldObjectPositions: { illusion: { x: 2, y: 3 } },
      catalogActions: [],
      movementRemainingFt: {},
    } as unknown as SoloCombatState;

    await act(async () => root.render(
      <TacticalBattleMap
        state={state}
        actorId="wizard"
        selectedActionId={null}
        movementMode={false}
        onCell={() => {}}
      />,
    ));

    const cell = container.querySelector<HTMLButtonElement>('[aria-label*="Закрытая железная дверь"]');
    expect(cell?.getAttribute('aria-label')).toContain('Интеллект (Расследование) против СЛ 13');
    expect(cell?.getAttribute('aria-label')).toContain('физическое взаимодействие раскрывает иллюзию');
    expect(cell?.querySelector('[data-world-object-id="illusion"]')?.textContent)
      .toContain('Закрытая железная дверь');
  });
  it.each([false, true])('keeps a living occupant clickable above a fallen token, reversed=%s', async reversed => {
    const tokens = [
      ['living', {actorId: 'living', position: {x: 2, y: 3}}],
      ['fallen', {actorId: 'fallen', position: {x: 2, y: 3}}],
    ];
    const state = {
      world: {scene: {mode: 'encounter', initiative: ['living'], activeIndex: 0, round: 1},
        actors: {
          living: {id: 'living', name: 'Живая крыса', runtime: {hp: {current: 7, max: 7}, activeEffects: []}},
          fallen: {id: 'fallen', name: 'Поверженная крыса', runtime: {hp: {current: 0, max: 7}, activeEffects: []}},
        }, objects: {}},
      tokens: Object.fromEntries(reversed ? tokens.reverse() : tokens),
      catalogActions: [], movementRemainingFt: {},
    } as unknown as SoloCombatState;
    const clicks: (string | undefined)[] = [];
    await act(async () => root.render(<TacticalBattleMap state={state} actorId="living"
      selectedActionId={null} movementMode={false} onCell={(_position, id) => clicks.push(id)} />));
    const cell = container.querySelector<HTMLButtonElement>('[aria-label*="Живая крыса"]');
    expect(cell?.getAttribute('aria-label')).toContain('7/7 HP');
    await act(async () => cell!.click());
    expect(clicks).toEqual(['living']);
    expect(container.querySelector('[aria-label*="Поверженная крыса"]')).toBeNull();
  });
  it('previews contextual movement cost, remaining feet, route, and a translucent token', async () => {
    const actor = compiled.roots.magicInitiateFighter.actor;
    const defaultAttack = {
      id: 'default-attack', name: 'Атака оружием',
      targeting: {minTargets: 1, maxTargets: 1, rangeFt: 5},
      mechanics: {primitive: {type: 'weapon_attack'}},
    };
    const state = {
      characterId: 'hero', sideByActorId: {hero: 'party'},
      world: {scene: {mode: 'encounter', initiative: ['hero'], activeIndex: 0, round: 1},
        actors: {hero: {...actor, id: 'hero', name: 'Герой'}}, objects: {}},
      tokens: {hero: {actorId: 'hero', color: '#fff', position: {x: 0, y: 0}}},
      catalogActions: [defaultAttack], movementRemainingFt: {hero: 30}, combatAreas: {}, movementModeByActor: {},
    } as unknown as SoloCombatState;
    await act(async () => root.render(<TacticalBattleMap state={state} actorId="hero"
      selectedActionId={null} defaultActionId={defaultAttack.id}
      implicitActionsEnabled movementMode={false} onCell={() => {}} />));
    expect(container.querySelector('.combat-hit-chance')).toBeNull();
    const cell = container.querySelector<HTMLButtonElement>('[aria-label="Клетка 3, 1"]')!;
    await act(async () => cell.dispatchEvent(new MouseEvent('mouseover', {bubbles: true})));
    expect(document.querySelector('.combat-move-preview')?.textContent).toContain('Перемещение 10 фт.');
    expect(document.querySelector('.combat-move-preview')?.textContent).toContain('Останется 20 фт.');
    expect(cell.querySelector('.battle-token--ghost')).not.toBeNull();
    expect(container.querySelectorAll('.is-route-preview')).toHaveLength(2);
  });

  it('shows terrain hover preview after 500ms over cover scenery', async () => {
    vi.useFakeTimers();
    const actor = compiled.roots.magicInitiateFighter.actor;
    const state = {
      characterId: 'hero', sideByActorId: {hero: 'party'},
      world: {scene: {mode: 'encounter', initiative: ['hero'], activeIndex: 0, round: 1},
        actors: {hero: {...actor, id: 'hero', name: 'Герой'}}, objects: {}},
      tokens: {hero: {actorId: 'hero', color: '#fff', position: {x: 0, y: 0}}},
      battleMap: {
        id: 'preview-map', name: 'Тест', width: 6, height: 4, maxFootprint: 1, maxActors: 4,
        background: '', description: '',
        features: [{id: 'crate', name: 'Ящик', x: 2, y: 1, width: 1, height: 1, sprite: 'barrel',
          blocksMovement: true, cover: 'half'}],
      },
      catalogActions: [], movementRemainingFt: {hero: 30}, combatAreas: {},
    } as unknown as SoloCombatState;
    await act(async () => root.render(<TacticalBattleMap state={state} actorId="hero"
      selectedActionId={null} movementMode={false} onCell={() => {}} />));
    const cell = container.querySelector<HTMLButtonElement>('[aria-label*="Ящик"]')!;
    await act(async () => {
      cell.dispatchEvent(new MouseEvent('mouseover', {bubbles: true, clientX: 120, clientY: 80}));
    });
    expect(document.querySelector('.battle-map-cell-preview')).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(document.querySelector('.battle-map-cell-preview')?.textContent).toContain('Ящик');
    expect(document.querySelector('.battle-map-cell-preview')?.textContent).toContain('Половинное укрытие');
    vi.useRealTimers();
  });

  it('combines the enemy and attack preview, showing КД without attack modifiers or zero cover',async()=>{
    vi.useFakeTimers();
    const base=structuredClone(compiled.roots.magicInitiateFighter.actor) as unknown as ActorState;
    const action:RuleActionDefinition={id:'preview-attack',name:'Произвольная атака',kind:'nonSpell',sourceEntityIds:['preview-attack'],
      targeting:{minTargets:1,maxTargets:1,rangeFt:5,requiresLineOfSight:true,allowedRelations:['enemy']},
      mechanics:{activation:{mode:'active',cost:[{resource:'action',amount:1}]},effects:[{resolution:'attack_roll',vs:'ac',ability:'str',attack_kind:'weapon_melee',attack_bonus_override:4,on_hit:[]}]}};
    const world=createWorld({id:'preview-world',ruleset:{systemId:'dnd5e-2024',releaseId:'test',contentHash:'test',errataVersion:'test'},
      actors:[{...base,id:'hero',capabilities:{actionIds:[action.id]}},{...structuredClone(base),id:'enemy',name:'Защитник'}]});
    world.scene={mode:'encounter',initiative:['hero','enemy'],activeIndex:0,round:1,turnStarted:true};
    const state={characterId:'hero',sideByActorId:{hero:'party',enemy:'enemy'},
      world,log:[],outcome:'active',playerActionIds:[action.id],certifiedPlayerActionIds:[],schemaVersion:1,runtimeRevision:0,
      tokens:{hero:{actorId:'hero',position:{x:0,y:0}},enemy:{actorId:'enemy',position:{x:1,y:0}}},
      catalogActions:[action],combatAreas:{},movementRemainingFt:{hero:30}} as unknown as SoloCombatState;
    await act(async()=>root.render(<TacticalBattleMap state={state} actorId="hero" selectedActionId={action.id} movementMode={false} onCell={()=>{}}/>));
    await act(async()=>container.querySelector('[data-actor-id="enemy"]')!.dispatchEvent(new MouseEvent('mouseover',{bubbles:true})));
    await act(async()=>{await vi.advanceTimersByTimeAsync(250);});
    const cards=document.querySelectorAll('.combat-enemy-preview');
    expect(cards).toHaveLength(1);
    expect(cards[0].textContent).toContain('Защитник');
    expect(cards[0].textContent).toContain('Попадание');
    expect(cards[0].textContent).toMatch(/КД \d+/);
    expect(cards[0].textContent).not.toMatch(/модификатор|Без укрытия|\+0/i);
    expect(cards[0].querySelector('.combat-hit-chance__cover')).toBeNull();
    expect(cards[0].querySelector('[role="progressbar"]')).not.toBeNull();
    expect(document.querySelector('.combat-map-tooltip.combat-hit-chance')).toBeNull();
  });

  it('highlights dangerous movement cells and explains their damage from area data',async()=>{
    const base=structuredClone(compiled.roots.magicInitiateFighter.actor);
    const area={id:'surface-a',name:'Поверхность А',zoneType:'custom',sourceActorId:'environment',sourceActionId:'source',sourceEntityIds:['source'],
      origin:{x:1,y:0},cells:[{x:1,y:0}],duration:{type:'permanent'},triggers:['move'],
      hazard:{id:'hazard-a',name:'Опасность А',sourceKind:'environment',sourceEntityIds:['source'],resolution:'automatic',effects:[{kind:'damage',dice:'1d6',type:'fire'}]}};
    const state={characterId:'hero',sideByActorId:{hero:'party'},
      world:{actors:{hero:{...base,id:'hero'}},objects:{},scene:{mode:'encounter',initiative:['hero'],activeIndex:0,round:1}},
      tokens:{hero:{actorId:'hero',position:{x:0,y:0}}},catalogActions:[],combatAreas:{'surface-a':area},movementRemainingFt:{hero:30}} as unknown as SoloCombatState;
    await act(async()=>root.render(<TacticalBattleMap state={state} actorId="hero" selectedActionId={null} movementMode onCell={()=>{}}/>));
    expect(container.querySelector('[data-movement-hazard="true"]')?.classList.contains('is-movement-hazard')).toBe(true);
    const cell=container.querySelector<HTMLButtonElement>('[aria-label="Клетка 3, 1"]')!;
    await act(async()=>cell.dispatchEvent(new MouseEvent('mouseover',{bubbles:true})));
    const preview=document.querySelector('.combat-move-preview')!;
    expect(preview.textContent).toContain('Поверхность А');
    expect(preview.textContent).toContain('1к6 урона (Огонь)');
    expect(preview.textContent).toContain('за каждые 5 фт. движения');
  });

});
