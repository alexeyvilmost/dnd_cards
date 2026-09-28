// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SoloCombatState } from '../solo-combat/types';
import TacticalBattleMap from './TacticalBattleMap';
import compiled from '../pages/rulesLabFixture.generated.json';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('TacticalBattleMap world-object clarity', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
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

});
