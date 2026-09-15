// @vitest-environment jsdom
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import CombatPresentationDialog from './CombatPresentationDialog';
import {getSettings, setSetting} from '../settings';
import type {CombatBeat} from '../solo-combat/presentation';

(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
const beat: CombatBeat = {id: 'a', sourceId: 'hero', sourceName: 'Герой', targetId: 'enemy', targetName: 'Враг', actionName: 'Удар', cues: [],
  roll: {kind: 'd20', dice: [{sides: 20, result: 1}], modifiers: [{source: 'Сила', value: 20}], advantage: 'none',
    target: {type: 'ac', value: 15}, total: 21, outcome: 'miss', text: 'Натуральная единица'}};
const hit: CombatBeat = {...beat, roll: {...beat.roll!, outcome: 'crit', dice: [{sides:20,result:20}], total:25},
  damage: [{amount:9,damageType:'slashing',roll:{kind:'damage',dice:[{sides:8,result:6},{sides:6,result:3}],modifiers:[],advantage:'none',total:9,text:'6 + 3 = 9'}}]};

describe('combat roll dialog', () => {
  let root: Root;
  let container: HTMLDivElement;
  it('keeps the equation visible and both provenance columns collapsed by default', async()=>{
    setSetting('combatRollMode','fast');
    await act(async()=>root.render(<CombatPresentationDialog beat={{...beat,roll:{...beat.roll!,target:{type:'ac',value:15,
      breakdown:{value:15,parts:[{source:'Кожаный доспех',value:11},{source:'Ловкость цели',value:4}]}}}}} onClose={()=>{}}/>));
    expect(document.querySelector('.combat-roll-equation')?.textContent).toContain('1 + 20 =21');
    const details=document.querySelector<HTMLDetailsElement>('.combat-roll-details')!;
    expect(details.open).toBe(false);
    await act(async()=>details.querySelector('summary')!.click());
    expect(details.open).toBe(true);
    expect(details.querySelectorAll('.combat-roll-detail-columns > section')).toHaveLength(2);
    expect(details.textContent).toContain('Кожаный доспех');
  });
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    let stored: string | null = null;
    vi.stubGlobal('localStorage', {getItem: () => stored, setItem: (_key: string, value: string) => {stored = value;}});
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  });
  it('keeps the dialog and attack die mounted when accepting a held roll, then rolls only damage', async () => {
    setSetting('combatRollMode', 'standard');
    const held = {...hit, id: 'held', damage: undefined};
    await act(async () => root.render(<CombatPresentationDialog beat={held} provisional onClose={()=>{}}/>));
    await act(async () => vi.advanceTimersByTime(1450));
    const dialog = document.querySelector('[role="dialog"]');
    const die = document.querySelector('.combat-attack-dice .committed-die');
    await act(async () => root.render(<CombatPresentationDialog beat={{...hit, id:'committed'}} onClose={()=>{}}/>));
    expect(document.querySelector('[role="dialog"]')).toBe(dialog);
    expect(document.querySelector('.combat-attack-dice .committed-die')).toBe(die);
    expect(document.querySelector('.combat-attack-dice .is-rolling')).toBeNull();
    expect(document.querySelector('.combat-damage-breakdown .is-rolling')).not.toBeNull();
    await act(async () => vi.advanceTimersByTime(1450));
    expect(document.querySelector<HTMLButtonElement>('.combat-presentation-continue')!.disabled).toBe(false);
  });
  afterEach(async () => {
    await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  });
  it('animates all area saves together then all damage together in one dialog',async()=>{
    const rows=[1,2,3].map(n=>({...hit,id:`save-${n}`,rollKind:'save' as const,targetName:`Враг ${n}`,roll:{...hit.roll!,kind:'save' as const,outcome:n===1?'success' as const:'fail' as const,target:{type:'dc' as const,value:15}}}));
    await act(async()=>root.render(<CombatPresentationDialog beat={{...rows[0],saveRows:rows}} onClose={()=>{}}/>));
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.querySelectorAll('.combat-save-row')).toHaveLength(3);
    expect(document.querySelectorAll('.is-rolling')).toHaveLength(3);
    await act(async()=>vi.advanceTimersByTime(1450));
    expect(document.querySelectorAll('.combat-save-damage .is-rolling')).toHaveLength(6);
    expect(document.querySelector('.combat-critical-banner')).toBeNull();
    await act(async()=>vi.advanceTimersByTime(1450));
    expect(document.querySelectorAll('.is-rolling')).toHaveLength(0);
    expect(document.querySelectorAll('.combat-save-damage strong')).toHaveLength(3);
    expect(document.querySelector<HTMLButtonElement>('.combat-presentation-continue')!.disabled).toBe(false);
  });
  it('animates the committed d20 before enabling Continue and compares numbers truthfully for natural one', async () => {
    await act(async () => root.render(<CombatPresentationDialog beat={beat} onClose={() => {}}/>));
    expect(document.querySelector<HTMLButtonElement>('.combat-presentation-continue')!.disabled).toBe(true);
    expect(document.querySelector('.committed-die.is-rolling')).not.toBeNull();
    await act(async () => vi.advanceTimersByTime(1450));
    expect(document.querySelector<HTMLButtonElement>('.combat-presentation-continue')!.disabled).toBe(false);
    expect(document.querySelector('.combat-roll-equation')!.textContent).toContain('≥');
    expect(document.querySelector('h3')!.textContent).toBe('Промах');
  });
  it('shows the full result immediately in fast mode and shares the persisted selector with settings', async () => {
    setSetting('combatRollMode', 'fast');
    const close = vi.fn();
    await act(async () => root.render(<CombatPresentationDialog beat={beat} onClose={close}/>));
    expect(document.querySelector('.committed-die')).not.toBeNull();
    expect(document.querySelector('.committed-die.is-rolling')).toBeNull();
    expect(document.querySelector<HTMLButtonElement>('.combat-presentation-continue')!.disabled).toBe(false);
    expect(document.querySelector('select')).toBeNull();
    await act(async () => document.querySelector<HTMLButtonElement>('.combat-presentation-settings')!.click());
    await act(async () => {
      const select = document.querySelector('select')!;
      select.value = 'skip'; select.dispatchEvent(new Event('change', {bubbles: true}));
    });
    expect(getSettings().combatRollMode).toBe('skip');
    expect(close).toHaveBeenCalledTimes(1);
  });
  it('shows the revised defense immediately without throwing the committed die again', async () => {
    setSetting('combatRollMode', 'standard');
    await act(async () => root.render(<CombatPresentationDialog beat={{...beat, rollPhase: 'after-reaction'}} onClose={() => {}}/>));
    expect(document.querySelector('.committed-die')).not.toBeNull();
    expect(document.querySelector('.committed-die.is-rolling')).toBeNull();
    expect(document.querySelector<HTMLButtonElement>('.combat-presentation-continue')!.disabled).toBe(false);
    expect(document.body.textContent).toContain('Сохранён исходный бросок.');
  });
  it('reveals the same committed result early without closing or rerolling', async () => {
    const close=vi.fn();
    await act(async()=>root.render(<CombatPresentationDialog beat={beat} onClose={close}/>));
    await act(async()=>document.querySelector<HTMLButtonElement>('.combat-reveal-result')!.click());
    expect(document.querySelector('[aria-label="к20: 1"]')).not.toBeNull();
    expect(document.querySelector('.combat-roll-equation')!.textContent).toContain('21');
    expect(document.body.textContent).toContain('Натуральная 1 — автоматический промах');
    expect(close).not.toHaveBeenCalled();
  });
  it('shows committed damage dice and the final resistance calculation after a hit', async () => {
    setSetting('combatRollMode', 'fast');
    const damageBeat: CombatBeat = {...beat,
      roll: {...beat.roll!, outcome: 'hit'},
      damage: [{amount: 4, damageType: 'slashing', beforeResistance: 9, adjustment: 'resistance',
        roll: {kind: 'damage', dice: [{sides: 8, result: 6}], modifiers: [{source: 'Сила', value: 3}],
          advantage: 'none', total: 9, text: 'к8: 6 +3 [Сила] = 9'}}],
    };
    await act(async () => root.render(<CombatPresentationDialog beat={damageBeat} onClose={() => {}}/>));
    expect(document.querySelector('.combat-damage-breakdown')?.textContent).toContain('к8');
    expect(document.querySelector('.combat-damage-breakdown')?.textContent).toContain('6 +3 [Сила] = 9');
    expect(document.querySelector('.combat-damage-breakdown')?.textContent).toContain('9 до сопротивления → 4');
  });
  it('uses the enemy preference independently of own attacks',async()=>{
    setSetting('enemyCombatRollMode','skip');
    const close=vi.fn();
    await act(async()=>root.render(<CombatPresentationDialog beat={beat} onClose={close}/>));
    expect(document.querySelector('.committed-die.is-rolling')).not.toBeNull();
    expect(close).not.toHaveBeenCalled();
    await act(async()=>root.render(<CombatPresentationDialog beat={{...beat,id:'enemy',audience:'enemy'}} onClose={close}/>));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(close).toHaveBeenCalledOnce();
    expect(getSettings().combatRollMode).toBe('standard');
  });
  it('rolls damage only after the attack lands, then reveals its authoritative sum',async()=>{
    await act(async()=>root.render(<CombatPresentationDialog beat={hit} onClose={()=>{}}/>));
    expect(document.querySelector('.combat-damage-breakdown')).toBeNull();
    await act(async()=>vi.advanceTimersByTime(1450));
    expect(document.querySelector('.is-critical-success.has-critical-motion')).not.toBeNull();
    expect(document.querySelectorAll('.combat-damage-rolls .is-rolling')).toHaveLength(2);
    expect(document.querySelector('.combat-damage-packet')?.textContent).not.toContain('6 + 3 = 9');
    expect(document.querySelector<HTMLButtonElement>('.combat-presentation-continue')!.disabled).toBe(true);
    await act(async()=>vi.advanceTimersByTime(1450));
    expect(document.querySelectorAll('.combat-damage-rolls .is-rolling')).toHaveLength(0);
    expect(document.querySelector('[aria-label="к8: 6"] canvas')).not.toBeNull();
    expect(document.querySelector('.combat-damage-packet')?.textContent).toContain('6 + 3 = 9');
    expect(document.querySelector<HTMLButtonElement>('.combat-presentation-continue')!.disabled).toBe(false);
  });
  it('can reveal both phases early without restarting the damage throw',async()=>{
    await act(async()=>root.render(<CombatPresentationDialog beat={hit} onClose={()=>{}}/>));
    await act(async()=>document.querySelector<HTMLButtonElement>('.combat-reveal-result')!.click());
    expect(document.querySelector('.is-rolling')).toBeNull();
    await act(async()=>vi.advanceTimersByTime(1450));
    expect(document.querySelector('.is-rolling')).toBeNull();
    expect(document.querySelector('.combat-damage-packet')?.textContent).toContain('6 + 3 = 9');
  });
  it('animates damage after a defensive reaction without rerolling the attack',async()=>{
    await act(async()=>root.render(<CombatPresentationDialog beat={{...hit,rollPhase:'after-reaction'}} onClose={()=>{}}/>));
    expect(document.querySelector('.combat-attack-dice .is-rolling')).toBeNull();
    expect(document.querySelectorAll('.combat-damage-rolls .is-rolling')).toHaveLength(2);
    await act(async()=>vi.advanceTimersByTime(1450));
    expect(document.querySelector<HTMLButtonElement>('.combat-presentation-continue')!.disabled).toBe(false);
  });
  it('marks only the kept natural one, not a discarded twenty',async()=>{
    await act(async()=>root.render(<CombatPresentationDialog beat={{...beat,roll:{...beat.roll!,advantage:'disadvantage',dice:[{sides:20,result:20,discarded:true},{sides:20,result:1}]}}} onClose={()=>{}}/>));
    await act(async()=>vi.advanceTimersByTime(1450));
    expect(document.querySelectorAll('.is-critical-failure')).toHaveLength(1);
    expect(document.querySelector('.is-critical-success')).toBeNull();
    expect(document.querySelector('.combat-critical-banner')?.textContent).toContain('КРИТИЧЕСКИЙ ПРОВАЛ');
  });
  it('honors reduced motion for both phases and critical effects',async()=>{
    vi.stubGlobal('matchMedia',()=>({matches:true}));
    await act(async()=>root.render(<CombatPresentationDialog beat={hit} onClose={()=>{}}/>));
    expect(document.querySelector('.is-rolling,.has-critical-motion')).toBeNull();
    expect(document.querySelector('.combat-critical-banner')?.textContent).toContain('КРИТИЧЕСКИЙ УСПЕХ');
    expect(document.querySelector<HTMLButtonElement>('.combat-presentation-continue')!.disabled).toBe(false);
  });
  it('shows damage on a successful save without applying critical attack rules to a natural one',async()=>{
    const save:CombatBeat={...hit,rollKind:'save',rollerName:'Враг',rollLabel:'Дыхание дракона: спасбросок Ловкости',
      roll:{...hit.roll!,kind:'save',outcome:'success',dice:[{sides:20,result:1}],total:21,target:{type:'dc',value:15}}};
    await act(async()=>root.render(<CombatPresentationDialog beat={save} onClose={()=>{}}/>));
    await act(async()=>vi.advanceTimersByTime(1450));
    expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Спасбросок');
    expect(document.querySelector('h3')?.textContent).toBe('Спасбросок успешен');
    expect(document.querySelector('.combat-roll-equation')?.textContent).toContain('СЛ 15');
    expect(document.querySelector('.combat-critical-banner')).toBeNull();
    expect(document.body.textContent).not.toContain('автоматический промах');
    expect(document.querySelectorAll('.combat-damage-rolls .is-rolling')).toHaveLength(2);
    await act(async()=>vi.advanceTimersByTime(1450));
    expect(document.querySelector('.combat-damage-breakdown')?.textContent).toContain('6 + 3 = 9');
  });
});
