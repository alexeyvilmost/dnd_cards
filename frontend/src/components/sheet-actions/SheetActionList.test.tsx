// @vitest-environment jsdom
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {Action, Spell} from '../../types';
import type {SheetAction} from '../../character/actionSheet';
import {sheetActionAvailability, type SheetActionAvailabilityInput} from './actionAvailability';
import SheetActionList, {type SheetActionListProps} from './SheetActionList';

vi.mock('../../utils/resources', async original => ({...await original<typeof import('../../utils/resources')>(), useResourceOptions: () => []}));
vi.mock('../../utils/mastery', () => ({useMasteryEffects: () => [], findMastery: () => undefined}));
vi.mock('../../hooks/usePinMode', () => ({usePinMode: () => ({pinModeActive: false})}));
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

function context(): SheetActionAvailabilityInput {
  return {
    canonicalBuild: {runtime: null, error: null}, campActionAllowsAlly: () => false,
    character: {id: 'owned-sheet', character_type: 'free', runtime_revision: 4},
    runtime: {hp: {current: 10, max: 10, temp: 0}, resources: {charge: 1}, maxResources: {charge: 3}, inventory: [], equipment: {}, activeEffects: []},
    ctx: {abilityMods: {str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0}, profBonus: 2, level: 1},
    contextualCostProjection: {issues: new Map()}, canonicalFor: () => undefined,
    combatContinuation: {session: null, error: null}, certifiedCombat: {loading: false, error: null, catalog: null},
    requireCombatSessionAuthority: () => { throw Error('No session in this fixture'); },
    equipCards: new Map(), passives: [], selectedSheetTarget: null, targetAc: null, targetSaveMod: null,
    deniedActionReason: () => null, busy: false, freeuseFor: () => null,
  };
}
function action(id: string, amount: number): SheetAction {
  const mechanics = {activation: {mode: 'active', cost: [{resource: 'charge', amount}]}};
  return {id, name: `Способность ${id}`, group: 'class', mechanics,
    actionRef: {
      id, name: `Способность ${id}`, description: `Описание ${id}`, mechanics,
      card_number: id, rarity: 'common', resource: 'action', action_type: 'class_feature',
      created_at: '2026-10-04T00:00:00Z', updated_at: '2026-10-04T00:00:00Z',
    } satisfies Action};
}
function props(input = context()): SheetActionListProps {
  const actions = [action('первая', 1), action('вторая', 2)];
  return {actions, allActions: actions, spellsOnly: false, actionsAsIcons: false, runtime: input.runtime,
    ctx: input.ctx, passives: input.passives, canonicalBuild: input.canonicalBuild,
    disabledInfo: row => sheetActionAvailability(row, input), runAction: vi.fn()};
}

describe('shared sheet availability and canonical presentation', () => {
  let root: Root, host: HTMLDivElement;
  beforeEach(() => {host = document.createElement('div'); document.body.append(host); root = createRoot(host);});
  afterEach(async () => {await act(async () => root.unmount()); host.remove();});

  it('reads two different declarations through the existing cost engine without spending or mutating them', () => {
    const input = context(), actions = [action('arbitrary-A', 1), action('unrelated-B', 2)];
    const before = JSON.stringify({runtime: input.runtime, actions});
    expect(actions.map(row => sheetActionAvailability(row, input))).toEqual([
      {disabled: false}, {disabled: true, reason: 'Недостаточно ресурсов'},
    ]);
    expect(JSON.stringify({runtime: input.runtime, actions})).toBe(before);
    input.runtime.resources.charge = 2;
    expect(actions.map(row => sheetActionAvailability(row, input).disabled)).toEqual([false, false]);
    input.panelDisabledReason = 'Результат команды ещё не подтверждён';
    expect(actions.map(row => sheetActionAvailability(row, input))).toEqual(actions.map(() => ({disabled: true, reason: input.panelDisabledReason})));
  });

  it.each([false, true])('keeps preview, focus and disabled activation in icon=%s', async icons => {
    const view = props();
    await act(async () => root.render(<SheetActionList {...view} actionsAsIcons={icons} />));
    const buttons = host.querySelectorAll<HTMLButtonElement>('[data-action-id] button');
    expect(buttons).toHaveLength(2);
    expect(buttons[1].getAttribute('aria-disabled')).toBe('true');
    expect(host.querySelector('[title]')).toBeNull();
    await act(async () => buttons[1].focus());
    expect(document.activeElement).toBe(buttons[1]);
    expect(document.querySelector('.forge-effect-popover')?.textContent).toContain('Описание вторая');
    expect(document.querySelector('.forge-effect-popover')?.textContent).toContain('Недостаточно ресурсов');
    await act(async () => buttons[1].click());
    expect(view.runAction).not.toHaveBeenCalled();
    await act(async () => buttons[0].click());
    expect(view.runAction).toHaveBeenCalledExactlyOnceWith(view.actions[0]);
    expect(host.querySelectorAll(icons ? '.cs-action-tile' : '.sheet-item-row')).toHaveLength(2);
  });

  it.each([false, true])('mobile inspection delegates the same entity without executing it in icon=%s', async icons => {
    const view = props(), inspect = vi.fn();
    await act(async () => root.render(<SheetActionList {...view} actionsAsIcons={icons} onInspectAction={inspect} disableHoverPreviews />));
    const unavailable = host.querySelectorAll<HTMLButtonElement>('[data-action-id] button')[1];
    await act(async () => {unavailable.focus(); unavailable.click();});
    expect(inspect).toHaveBeenCalledWith(view.actions[1], expect.any(Function), 'Недостаточно ресурсов');
    expect(view.runAction).not.toHaveBeenCalled();
    expect(document.querySelector('.forge-effect-popover')).toBeNull();
  });

  it('keeps build failure distinct from unprepared state and reaction spells visible only in their catalog', async () => {
    const input = context(); input.canonicalBuild.error = Error('Каталог ещё загружается');
    const spell = {id: 'declared-reaction', name: 'Заявленная защита', level: 1, school: 'abjuration', description: 'Описание защиты'} as Spell;
    const row: SheetAction = {id: spell.id, name: spell.name, group: 'spell', spellRef: spell,
      mechanics: {activation: {mode: 'active', cost: [{resource: 'spell_slot', level: 1}]}}};
    const view = {...props(input), actions: [row], allActions: [row], spellsOnly: true};
    await act(async () => root.render(<SheetActionList {...view} />));
    expect(host.textContent).toContain('Каталог ещё загружается');
    expect(host.textContent).not.toContain('Заклинание не подготовлено');
    row.mechanics.activation = {mode: 'reaction', trigger: {events: ['hit_by_attack']}};
    await act(async () => root.render(<SheetActionList {...view} />));
    expect(host.textContent).toContain('Доступно только в окне реакции');
    await act(async () => root.render(<SheetActionList {...view} spellsOnly={false} />));
    expect(host.querySelector('[data-action-id]')).toBeNull();
    expect(view.runAction).not.toHaveBeenCalled();
  });
});
