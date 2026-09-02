// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingResolution } from '../rules-core/domain';
import SheetPendingCombatPanel, { sheetReactionDecisionOptions } from './SheetPendingCombatPanel';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SOURCE = '11111111-1111-4111-8111-111111111111';
const TARGET = '22222222-2222-4222-8222-222222222222';

function targetSave(): PendingResolution {
  return {
    id: 'save:1',
    type: 'target_save',
    openedByCommandId: 'command:1',
    openedAtRevision: 1,
    deadlineLogicalClock: 5,
    sourceActorId: SOURCE,
    targetActorId: TARGET,
    actionId: 'burning-hands',
    facts: {
      factsSource: 'scenario', boardRevision: 0, relation: 'enemy',
      distanceFt: 10, lineOfSight: true, cover: 'none',
    },
    request: {
      id: 'request:1', type: 'saving_throw', actorId: TARGET,
      ability: 'dex', dc: 13, avoidsConditions: [],
    },
  };
}

function missileReaction(): PendingResolution {
  return {
    id: 'reaction:1',
    type: 'magic_missile_reaction',
    openedByCommandId: 'command:2',
    openedAtRevision: 1,
    deadlineLogicalClock: 5,
    sourceActorId: SOURCE,
    targetActorId: TARGET,
    actionId: 'magic-missile',
    spell: { baseLevel: 1, castLevel: 1, grantId: 'missile-grant', mode: 'normal' },
    dartTargetIds: [TARGET, TARGET, TARGET],
    targets: [{
      targetActorId: TARGET,
      facts: {
        factsSource: 'scenario', boardRevision: 0, relation: 'enemy',
        distanceFt: 30, lineOfSight: true, cover: 'none',
      },
    }],
    protectedTargetIds: [],
    remainingReactions: [],
    request: {
      id: 'request:2', type: 'reaction', actorId: TARGET,
      trigger: {
        type: 'targeted_by_magic_missile', sourceActorId: SOURCE,
        actionId: 'magic-missile', dartCount: 3,
      },
      options: [{
        actionId: 'shield',
        label: 'Shield',
        spellSources: [{
          grantId: 'shield-grant', sourceId: 'wizard', spellcastingAbility: 'int',
          payment: { kind: 'slot', resource: 'spell_slot_1' },
        }],
      }],
    },
  };
}

function concentrationSave(): PendingResolution {
  return JSON.parse(JSON.stringify({
    id: 'concentration:1',
    type: 'concentration_save',
    openedByCommandId: 'command:3',
    openedAtRevision: 4,
    deadlineLogicalClock: 9,
    actorId: TARGET,
    concentrationId: 'concentration:bless',
    damage: 22,
    request: {
      id: 'request:3', type: 'saving_throw', actorId: TARGET,
      ability: 'con', dc: 11, avoidsConditions: [],
    },
  })) as PendingResolution;
}

function damageReaction(): PendingResolution {
  const runtime = {
    hp: { current: 20, max: 20, temp: 0 },
    resources: { reaction: 1, giant_legacy: 1 },
    maxResources: { reaction: 1, giant_legacy: 1 },
    equipment: {}, inventory: [], activeEffects: [],
  };
  return JSON.parse(JSON.stringify({
    id: 'damage-reaction:1',
    type: 'damage_reaction',
    openedByCommandId: 'command:damage',
    openedAtRevision: 7,
    deadlineLogicalClock: 12,
    sourceActorId: SOURCE,
    targetActorId: TARGET,
    actionId: 'heavy-strike',
    action: {
      id: 'heavy-strike', name: 'Heavy Strike', kind: 'nonSpell',
      sourceEntityIds: ['test:heavy-strike'],
      targeting: {
        minTargets: 1, maxTargets: 1, rangeFt: 5,
        requiresLineOfSight: true, allowedRelations: ['enemy'],
      },
      mechanics: { effects: [] },
    },
    facts: {
      factsSource: 'scenario', boardRevision: 0, relation: 'enemy',
      distanceFt: 5, lineOfSight: true, cover: 'none',
    },
    targetRuntimeBeforeDamage: runtime,
    sourceRuntimeAfter: runtime,
    targetRuntimeAfter: { ...runtime, hp: { current: 12, max: 20, temp: 0 } },
    damage: [{ amount: 8, damageType: 'bludgeoning' }],
    preDamageTargetEvents: [], attackEvents: [], retaliationEvents: [],
    retaliationSourceEntityIds: [], obligationIds: [], followUps: [],
    request: {
      id: 'request:damage', type: 'reaction', actorId: TARGET,
      trigger: {
        type: 'damage_taken', sourceActorId: SOURCE,
        actionId: 'heavy-strike', amount: 8, damageTypes: ['bludgeoning'],
      },
      options: [{ actionId: 'stone-endurance', label: 'Каменная стойкость' }],
    },
  })) as PendingResolution;
}

describe('SheetPendingCombatPanel', () => {
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

  it('routes the owner sheet to the target sheet while the target owns the save decision', async () => {
    await act(async () => root.render(
      <SheetPendingCombatPanel
        pending={targetSave()}
        viewingCharacterId={SOURCE}
        actorNames={{ [TARGET]: 'Target' }}
        onResolve={() => undefined}
      />,
    ));
    const link = container.querySelector<HTMLAnchorElement>('a');
    expect(link?.href).toContain(`/characters-v3/${TARGET}`);
    expect(container.textContent).toContain('Target');
  });

  it('requires an explicit d20 on the reloaded target sheet and returns no UI-authored DC', async () => {
    const onResolve = vi.fn();
    await act(async () => root.render(
      <SheetPendingCombatPanel
        pending={targetSave()}
        viewingCharacterId={TARGET}
        actorNames={{ [TARGET]: 'Target' }}
        onResolve={onResolve}
      />,
    ));
    expect(container.textContent).toContain('СЛ 13');
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Результат d20 спасброска"]')!;
    const apply = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('Применить d20'))!;
    expect(input.value).toBe('');
    expect(apply.disabled).toBe(true);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, '1');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(apply.disabled).toBe(false);
    await act(async () => apply.click());
    expect(onResolve).toHaveBeenCalledWith({
      kind: 'roll', roll: { mode: 'manual', dice: [{ sides: 20, value: 1 }] },
    });
  });

  it('projects exact reaction grant/payment and keeps decline explicit', async () => {
    const pending = missileReaction();
    if (pending.type !== 'magic_missile_reaction') throw new Error('fixture');
    expect(sheetReactionDecisionOptions(pending.request.options)).toEqual([{
      id: 'shield:shield-grant:slot:spell_slot_1',
      label: 'Shield · Ячейка 1-го круга',
      response: {
        kind: 'reaction', actionId: 'shield',
        spell: { grantId: 'shield-grant', mode: 'normal', preferFreeUse: false },
      },
    }]);
    const onResolve = vi.fn();
    await act(async () => root.render(
      <SheetPendingCombatPanel
        pending={pending}
        viewingCharacterId={TARGET}
        actorNames={{ [TARGET]: 'Target' }}
        onResolve={onResolve}
      />,
    ));
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('button')];
    await act(async () => buttons.find((button) => button.textContent?.includes('Shield'))!.click());
    expect(onResolve).toHaveBeenLastCalledWith({
      kind: 'reaction', actionId: 'shield',
      spell: { grantId: 'shield-grant', mode: 'normal', preferFreeUse: false },
    });
    await act(async () => buttons.find((button) => button.textContent?.includes('Не использовать'))!.click());
    expect(onResolve).toHaveBeenLastCalledWith({ kind: 'reaction', actionId: null });
  });

  it('renders a persisted generic pre-damage reaction with exact damage and accept/skip choices', async () => {
    const onResolve = vi.fn();
    await act(async () => root.render(
      <SheetPendingCombatPanel
        pending={damageReaction()}
        viewingCharacterId={TARGET}
        actorNames={{ [TARGET]: 'Варувар' }}
        onResolve={onResolve}
      />,
    ));

    expect(container.querySelector('[data-testid="sheet-combat-damage-reaction"]')).not.toBeNull();
    expect(container.textContent).toContain('Реакция перед получением урона');
    expect(container.textContent).toContain('Варувар: входящий урон — 8 (bludgeoning)');
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('button')];
    await act(async () => buttons.find((button) => button.textContent?.includes('Каменная стойкость'))!.click());
    expect(onResolve).toHaveBeenLastCalledWith({ kind: 'reaction', actionId: 'stone-endurance' });
    await act(async () => buttons.find((button) => button.textContent?.includes('Не использовать'))!.click());
    expect(onResolve).toHaveBeenLastCalledWith({ kind: 'reaction', actionId: null });
  });

  it('routes and resolves a reloaded concentration save on the damaged actor sheet', async () => {
    const pending = concentrationSave();
    const onResolve = vi.fn();
    await act(async () => root.render(
      <SheetPendingCombatPanel
        pending={pending}
        viewingCharacterId={SOURCE}
        actorNames={{ [TARGET]: 'Concentrating Target' }}
        onResolve={onResolve}
      />,
    ));
    expect(container.querySelector<HTMLAnchorElement>('a')?.href)
      .toContain(`/characters-v3/${TARGET}`);

    await act(async () => root.render(
      <SheetPendingCombatPanel
        pending={pending}
        viewingCharacterId={TARGET}
        actorNames={{ [TARGET]: 'Concentrating Target' }}
        onResolve={onResolve}
      />,
    ));
    expect(container.textContent).toContain('Концентрация: спасбросок CON');
    expect(container.textContent).toContain('СЛ 11');
    expect(container.textContent).toContain('Получено урона: 22');
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Результат d20 спасброска"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, '12');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const apply = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('Применить d20'))!;
    await act(async () => apply.click());
    expect(onResolve).toHaveBeenCalledWith({
      kind: 'roll', roll: { mode: 'manual', dice: [{ sides: 20, value: 12 }] },
    });
  });

  it('passes an exact data-owned boon id for after-failure saving throws', async () => {
    const onResolve = vi.fn();
    await act(async () => root.render(
      <SheetPendingCombatPanel
        pending={concentrationSave()}
        viewingCharacterId={TARGET}
        actorNames={{ [TARGET]: 'Target' }}
        decidingRuntime={{
          hp: { current: 10, max: 10, temp: 0 },
          resources: {}, maxResources: {}, equipment: {}, inventory: [],
          activeEffects: [{
            id: 'boon:bardic', name: 'Вдохновение барда', source: 'Бард',
            mechanics: {
              kind: 'boon', id: 'bardic_inspiration', die: '1d6',
              applies_to: ['saving_throw'], timing: ['after_failure'],
            },
            entityRef: { kind: 'effect', id: 'effect:bardic-inspiration' },
          }],
        }}
        onResolve={onResolve}
      />,
    ));
    const select = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Милость после провала спасброска"]',
    )!;
    expect(select.textContent).toContain('Вдохновение барда');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(select, 'boon:bardic');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const auto = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('Бросить автоматически'))!;
    await act(async () => auto.click());
    expect(onResolve).toHaveBeenCalledWith({
      kind: 'roll', roll: { mode: 'system' }, boonEffectId: 'boon:bardic',
    });
  });
});
