// @vitest-environment jsdom

import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import contentPatchJson from '../canon/data/micro-mvp-l1-content-patch.v1.json';
import { compileMechanicsTargeting } from '../rules-core/actionTargeting';
import type { RuleActionDefinition } from '../rules-core/domain';
import {
  useSheetCombatTargetDialog,
  type SheetCombatTargetDialogApi,
} from './SheetCombatTargetDialog';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function changeValue(element: HTMLInputElement | HTMLSelectElement, value: string): void {
  const prototype = element instanceof HTMLSelectElement
    ? HTMLSelectElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (!setter) throw new Error('DOM value setter is unavailable');
  setter.call(element, value);
  element.dispatchEvent(new Event(
    element instanceof HTMLSelectElement ? 'change' : 'input',
    { bubbles: true },
  ));
}

const action: RuleActionDefinition = {
  id: 'thunderwave@test',
  name: 'Thunderwave',
  kind: 'spell',
  sourceEntityIds: ['spell:thunderwave'],
  spell: { level: 1, components: { verbal: true, somatic: true, material: false } },
  mechanics: { primitive: { type: 'area_object_push' }, targeting: { shape: 'area' } },
  targeting: {
    minTargets: 0,
    maxTargets: 8,
    rangeFt: 15,
    requiresLineOfSight: false,
    allowedRelations: ['self', 'ally', 'enemy', 'neutral'],
  },
};

const patch = contentPatchJson as unknown as {
  mechanicsPatches: {
    actions: Array<{ entityId: string; cardNumber: string; mechanics: Record<string, unknown> }>;
  };
};

function realBoundWeaponAction(): RuleActionDefinition {
  const row = patch.mechanicsPatches.actions.find((candidate) => (
    (candidate.mechanics.primitive as Record<string, unknown> | undefined)?.type === 'weapon_attack'
  ));
  if (!row) throw new Error('Content patch misses weapon_attack');
  const mechanics = JSON.parse(JSON.stringify(row.mechanics)) as Record<string, unknown>;
  const activation = mechanics.activation as { cost: Array<Record<string, unknown>> };
  activation.cost = activation.cost.filter((cost) => cost.resource !== 'equipped_weapon_ammo');
  (mechanics.targeting as Record<string, unknown>).range_ft = 47;
  return {
    id: row.entityId,
    name: row.cardNumber,
    kind: 'nonSpell',
    sourceEntityIds: [row.entityId, row.cardNumber],
    mechanics,
    targeting: compileMechanicsTargeting(mechanics),
  };
}

describe('SheetCombatTargetDialog explicit facts', () => {
  let container: HTMLDivElement;
  let root: Root;
  let api: SheetCombatTargetDialogApi;

  function Harness() {
    const dialog = useSheetCombatTargetDialog();
    useEffect(() => { api = dialog; }, [dialog]);
    return <>{dialog.dialog}</>;
  }

  beforeEach(async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<Harness />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('does not predeclare a target, geometry, provenance, relation, sight, cover, or revision', async () => {
    let pending!: Promise<unknown>;
    await act(async () => {
      pending = api.request({
        title: 'Thunderwave facts',
        action,
        candidates: [{ id: 'target', name: 'Target' }],
        requireTarget: true,
      });
    });
    const fieldset = document.querySelector('fieldset')!;
    expect(document.querySelector('[data-testid="sheet-combat-target-list"]')).not.toBeNull();
    expect(fieldset.classList.contains('sheet-target-card')).toBe(true);
    expect(fieldset.classList.contains('dice-dialog-list')).toBe(false);
    const checkbox = fieldset.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(checkbox.checked).toBe(false);
    await act(async () => checkbox.click());
    const numbers = fieldset.querySelectorAll<HTMLInputElement>('input[type="number"]');
    expect([...numbers].map((input) => input.value)).toEqual(['', '']);
    const selects = fieldset.querySelectorAll<HTMLSelectElement>('select');
    expect([...selects].map((select) => select.value)).toEqual(['', '', 'unknown', '']);
    await act(async () => {
      document.querySelector<HTMLButtonElement>('.dice-dialog-btn.primary')!.click();
    });
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('явно укажите');
    await act(async () => {
      document.querySelectorAll<HTMLButtonElement>('.dice-dialog-btn')[1].click();
      await pending;
    });
  });

  it('opens a materialized weapon action by click and returns only explicit target facts', async () => {
    const weapon = realBoundWeaponAction();
    let result: Awaited<ReturnType<SheetCombatTargetDialogApi['request']>> | undefined;

    function WeaponHarness() {
      const dialog = useSheetCombatTargetDialog();
      return <>
        <button type="button" onClick={() => {
          void dialog.request({
            title: `${weapon.name}: цели и факты`,
            action: weapon,
            candidates: [{ id: 'target', name: 'Target' }],
            requireTarget: true,
          }).then((value) => { result = value; });
        }}>{weapon.name}</button>
        {dialog.dialog}
      </>;
    }

    await act(async () => root.render(<WeaponHarness />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button')!.click();
    });
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.textContent).toContain('47 фт.');
    const fieldset = dialog.querySelector('fieldset')!;
    await act(async () => fieldset.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    const selects = fieldset.querySelectorAll<HTMLSelectElement>('select');
    const numbers = fieldset.querySelectorAll<HTMLInputElement>('input[type="number"]');
    await act(async () => {
      changeValue(selects[0], 'enemy');
      changeValue(numbers[0], '23');
      changeValue(numbers[1], '9');
      changeValue(selects[1], 'board');
      changeValue(selects[2], 'yes');
      changeValue(selects[3], 'three_quarters');
    });
    await act(async () => {
      dialog.querySelector<HTMLButtonElement>('.dice-dialog-btn.primary')!.click();
      await Promise.resolve();
    });
    expect(result).toEqual({
      targets: [{
        targetId: 'target',
        factsSource: 'board',
        boardRevision: 9,
        relation: 'enemy',
        distanceFt: 23,
        lineOfSight: true,
        cover: 'three_quarters',
      }],
    });
  });

  it('preselects a scene target and asks only for its distance', async () => {
    let result: Awaited<ReturnType<SheetCombatTargetDialogApi['request']>> | undefined;
    await act(async () => {
      void api.request({
        title: 'Атака: цели и факты',
        action: realBoundWeaponAction(),
        candidates: [{
          id: 'scene-target:training-dummy',
          name: 'Пугало',
          description: 'Тренировочная цель · КЗ 10',
          defaultSelected: true,
          factEntryMode: 'distance_only',
          defaultFacts: {
            factsSource: 'scenario',
            boardRevision: 12,
            relation: 'enemy',
            lineOfSight: true,
            cover: 'none',
          },
        }],
        requireTarget: true,
      }).then((value) => { result = value; });
    });
    const fieldset = document.querySelector<HTMLFieldSetElement>(
      '[data-target-id="scene-target:training-dummy"]',
    )!;
    expect(fieldset.classList.contains('sheet-target-card--scene')).toBe(true);
    expect(fieldset.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(true);
    expect(fieldset.querySelectorAll('select')).toHaveLength(0);
    const numbers = fieldset.querySelectorAll<HTMLInputElement>('input[type="number"]');
    expect(numbers).toHaveLength(1);
    await act(async () => changeValue(numbers[0], '30'));
    await act(async () => {
      document.querySelector<HTMLButtonElement>('.dice-dialog-btn.primary')!.click();
      await Promise.resolve();
    });
    expect(result).toEqual({
      targets: [{
        targetId: 'scene-target:training-dummy',
        factsSource: 'scenario',
        boardRevision: 12,
        relation: 'enemy',
        distanceFt: 30,
        lineOfSight: true,
        cover: 'none',
      }],
    });
  });

  it('replaces the implicit scene default when a real single target is selected', async () => {
    let pending!: Promise<unknown>;
    await act(async () => {
      pending = api.request({
        title: 'Атака: выбор цели',
        action: realBoundWeaponAction(),
        candidates: [{
          id: 'scene-target:training-dummy',
          name: 'Пугало',
          defaultSelected: true,
          factEntryMode: 'distance_only',
          defaultFacts: {
            factsSource: 'scenario',
            boardRevision: 0,
            relation: 'enemy',
            lineOfSight: true,
            cover: 'none',
          },
        }, {
          id: 'character:target',
          name: 'Настоящий персонаж',
        }],
        requireTarget: true,
      });
    });
    const dummy = document.querySelector<HTMLInputElement>(
      '[data-target-id="scene-target:training-dummy"] input[type="checkbox"]',
    )!;
    const character = document.querySelector<HTMLInputElement>(
      '[data-target-id="character:target"] input[type="checkbox"]',
    )!;
    expect(dummy.checked).toBe(true);
    expect(character.checked).toBe(false);
    await act(async () => character.click());
    expect(dummy.checked).toBe(false);
    expect(character.checked).toBe(true);
    await act(async () => {
      document.querySelectorAll<HTMLButtonElement>('.dice-dialog-btn')[1].click();
      await pending;
    });
  });
});
