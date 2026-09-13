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

describe('combat roll dialog', () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    vi.useFakeTimers();
    let stored: string | null = null;
    vi.stubGlobal('localStorage', {getItem: () => stored, setItem: (_key: string, value: string) => {stored = value;}});
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals();
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
});
