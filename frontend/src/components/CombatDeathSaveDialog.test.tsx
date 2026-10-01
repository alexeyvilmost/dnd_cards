// @vitest-environment jsdom
import {act, StrictMode} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createWorld, type ActorState} from '../rules-core/domain';
import {emptyDeathSaves} from '../engine/deathSaves';
import {prepareCombatDeathSave, resolveCombatDeathSave} from '../solo-combat/engine';
import type {SoloCombatState} from '../solo-combat/types';
import CombatDeathSaveDialog from './CombatDeathSaveDialog';

(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

function encounter(actorId: string, natural: number, inspiration = 0) {
  const actor: ActorState = {id: actorId, name: actorId, kind: 'playerCharacter', controllerId: actorId,
    ac: 12, capabilities: {actionIds: []},
    character: {baseSpeed: 30, abilityMods: {str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0}, profBonus: 2, level: 1},
    runtime: {hp: {current: 0, max: 12, temp: 0}, resources: {action: 1, heroic_inspiration: inspiration},
      maxResources: {action: 1}, inventory: [], equipment: {}, activeEffects: [],
      deathSaves: {...emptyDeathSaves(), successes: 1, failures: 1}, firedThisTurn: ['system:death-save-due']}};
  const enemy: ActorState = {...structuredClone(actor), id: 'enemy', name: 'enemy', kind: 'monster',
    runtime: {...structuredClone(actor.runtime), hp: {current: 10, max: 10, temp: 0}}};
  const world = createWorld({id: `encounter-${actorId}`, actors: [actor, enemy],
    ruleset: {systemId: 'dnd5e-2024', releaseId: 'test', contentHash: 'test', errataVersion: 'test'}});
  world.scene = {mode: 'encounter', round: 1, activeIndex: 0, initiative: [actorId, 'enemy'], turnStarted: true};
  const state = {schemaVersion: 1, deathSavesVersion: 1, characterId: actorId, controlledCharacterIds: [actorId],
    runtimeRevision: 0, world, tokens: {}, sideByActorId: {[actorId]: 'party', enemy: 'enemy'}, combatAreas: {},
    boardRevision: 0, catalogActions: [], playerActionIds: [], certifiedPlayerActionIds: [], movementRemainingFt: {},
    log: [], outcome: 'active', actionPresentation: {}} as unknown as SoloCombatState;
  return prepareCombatDeathSave(state, () => (natural - .5) / 20);
}

describe('death-save offer and confirmed presentation', () => {
  let root: Root, container: HTMLDivElement;
  const resolve = vi.fn();
  const render = async (state: SoloCombatState, extra: {busy?: boolean; blocked?: boolean; error?: boolean} = {}) =>
    act(async () => root.render(<StrictMode><CombatDeathSaveDialog state={state} busy={false} blocked={false}
      error={false} preferences={{}} onResolve={resolve} {...extra}/></StrictMode>));
  beforeEach(() => {
    vi.useFakeTimers(); resolve.mockClear();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    let stored: string | null = null;
    vi.stubGlobal('localStorage', {getItem: () => stored, setItem: (_key: string, value: string) => {stored = value;}});
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount()); container.remove();
    vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  });
  it.each([['fighter', 14, 2, 1], ['cleric', 1, 1, 3]] as const)(
    '%s skips the empty provisional window, then shows the saved %i and committed counters',
    async (actorId, natural, successes, failures) => {
      const held = encounter(actorId, natural), before = JSON.stringify(held);
      await render(held);
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(resolve).toHaveBeenCalledTimes(1);
      expect(resolve).toHaveBeenCalledWith();
      expect(JSON.stringify(held)).toBe(before);
      await render(JSON.parse(before));
      expect(resolve).toHaveBeenCalledTimes(1);
      const confirmed = resolveCombatDeathSave(held, undefined, () => {throw Error('must replay saved die');});
      await render(confirmed);
      await act(async () => vi.advanceTimersByTime(1450));
      expect(document.querySelector('.combat-roll-equation strong')?.textContent).toBe(String(natural));
      expect(document.querySelector(`[aria-label="Успехи: ${successes} из 3"]`)).not.toBeNull();
      expect(document.querySelector(`[aria-label="Провалы: ${failures} из 3"]`)).not.toBeNull();
      expect(document.body.textContent).not.toContain('Результат ещё не подтверждён');
      expect(resolve).toHaveBeenCalledTimes(1); // acknowledgement remains the player's choice
    });
  it('keeps an affordable influence manual and preserves the same die after acceptance', async () => {
    const held = encounter('wizard', 9, 1);
    await render(held); await act(async () => vi.advanceTimersByTime(1450));
    expect(resolve).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Результат ещё не подтверждён');
    const dialog = document.querySelector('[role="dialog"]'), die = document.querySelector('.committed-die');
    const confirmed = resolveCombatDeathSave(held, undefined, () => {throw Error('must not reroll');});
    expect(confirmed.pendingDeathSave!.roll.dice.map(die => die.result)).toEqual([9]);
    await render(confirmed);
    expect(document.querySelector('[role="dialog"]')).toBe(dialog);
    expect(document.querySelector('.committed-die')).toBe(die);
    expect(document.querySelector('.committed-die.is-rolling')).toBeNull();
    expect(document.body.textContent).not.toContain('Результат ещё не подтверждён');
  });
  it('waits for animation/network gates, then sends only one confirmation', async () => {
    const held = encounter('ranger', 11);
    await render(held, {blocked: true}); await render(held, {busy: true});
    expect(resolve).not.toHaveBeenCalled();
    await render(held); await render(held, {busy: true}); await render(held);
    expect(resolve).toHaveBeenCalledTimes(1);
  });
  it('leaves an unconfirmed result retryable after an authoritative error', async () => {
    const held = encounter('bard', 12);
    await render(held, {error: true}); await act(async () => vi.advanceTimersByTime(1450));
    expect(resolve).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Результат ещё не подтверждён');
    await act(async () => document.querySelector<HTMLButtonElement>('.combat-presentation-continue')!.click());
    expect(resolve).toHaveBeenCalledTimes(1);
  });
});
