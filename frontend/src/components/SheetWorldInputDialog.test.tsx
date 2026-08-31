// @vitest-environment jsdom

import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorld, type ActorState, type RuleActionDefinition } from '../rules-core/domain';
import type { SheetCanonicalRuntime } from '../character/sheetCanonicalWorld';
import type { SheetWorldInputFormContext } from '../character/sheetWorldInputForm';
import {
  useSheetWorldInputDialog,
  type SheetWorldInputDialogApi,
} from './SheetWorldInputDialog';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function actor(): ActorState {
  return {
    id: 'pc:dialog', name: 'Dialog', kind: 'playerCharacter', controllerId: 'dialog-controller',
    ac: 10, capabilities: { actionIds: [] },
    character: {
      abilityMods: { str: 0, dex: 0, con: 0, int: 3, wis: 0, cha: 0 },
      profBonus: 2, level: 1,
    },
    runtime: {
      hp: { current: 10, max: 10, temp: 0 }, resources: {}, maxResources: {},
      equipment: {}, inventory: [], activeEffects: [], firedThisTurn: [],
    },
  };
}

function dialogContext(): SheetWorldInputFormContext {
  const action: RuleActionDefinition = {
    id: 'spell:minor-illusion', name: 'Малая иллюзия', kind: 'spell',
    sourceEntityIds: ['spell:minor-illusion'],
    spell: { level: 0, components: { verbal: false, somatic: true, material: true } },
    targeting: {
      minTargets: 0, maxTargets: 1, rangeFt: 30,
      requiresLineOfSight: false, allowedRelations: [],
    },
    mechanics: {},
  };
  const world = createWorld({
    id: 'dialog-world',
    ruleset: {
      systemId: 'dnd5e-2024', releaseId: 'dialog-test@1',
      contentHash: 'sha256:dialog-test', errataVersion: 'PHB-2024',
    },
    actors: [actor()],
  });
  const runtime: SheetCanonicalRuntime = {
    actorId: 'pc:dialog', world, actions: [action], cards: [], resourceBindings: {},
    catalog: { getAction: (id) => id === action.id ? action : undefined },
    actionFor: () => action,
  };
  return {
    runtime,
    action,
    form: 'minor_illusion',
    parsed: {
      status: 'valid',
      primitiveType: 'minor_illusion_world_object',
      targeting: {
        domain: 'world', actorTargets: false, shape: 'single', rangeFt: 30,
        requiresLineOfSight: false, requiresTouch: false, allowedRelations: [],
      },
      policy: {
        imageMaxCubeSideFt: 5, durationRounds: 10, maxActivePerSource: 1,
        studyAbility: 'int', studySkill: 'investigation',
      },
    },
  };
}

describe('SheetWorldInputDialog accessibility', () => {
  let container: HTMLDivElement;
  let root: Root;
  let api: SheetWorldInputDialogApi;

  function Harness() {
    const dialog = useSheetWorldInputDialog();
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

  it('uses a modal dialog, semantic fieldsets, an exact preview, and focuses the first invalid fact', async () => {
    let pending!: Promise<unknown>;
    await act(async () => {
      pending = api.request(dialogContext(), 'Малая иллюзия: факты', 'unused:illusion');
    });
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect([...container.querySelectorAll('legend')].map((node) => node.textContent)).toEqual([
      'Вариант действия',
      'Явные факты сценария',
    ]);

    const revision = container.querySelector<HTMLInputElement>('#sheet-world-board-revision')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(revision, '');
      revision.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.querySelector('pre')?.textContent).toContain('"boardRevision": ""');

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.dice-dialog-btn.primary')!.click();
      await new Promise((resolve) => setTimeout(resolve, 1));
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('ревизию доски');
    expect(document.activeElement).toBe(revision);

    await act(async () => {
      container.querySelectorAll<HTMLButtonElement>('.dice-dialog-btn')[1].click();
      await pending;
    });
  });

  it('starts from authoritative combat-board facts supplied by the caller', async () => {
    let pending!: Promise<unknown>;
    await act(async () => {
      pending = api.request(
        dialogContext(),
        'Малая иллюзия: форма и факты',
        'unused:illusion',
        {
          facts: {
            factsSource: 'board',
            boardRevision: '17',
            distanceFt: '15',
            lineOfSight: true,
          },
        },
      );
    });

    expect(container.querySelector<HTMLSelectElement>('#sheet-world-facts-source')?.value).toBe('board');
    expect(container.querySelector<HTMLInputElement>('#sheet-world-board-revision')?.value).toBe('17');
    expect(container.querySelector<HTMLInputElement>('#sheet-world-distance')?.value).toBe('15');

    await act(async () => {
      container.querySelectorAll<HTMLButtonElement>('.dice-dialog-btn')[1].click();
      await pending;
    });
  });
});
