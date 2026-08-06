// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryRulesWorldStore } from '../rules-session/store';
import { readProdSnapshotCatalogs } from '../canon/prodSnapshotL1Fixtures';
import {
  PROTECTION_2024_CAPABILITY_ID,
} from '../rules-core/protection';
import { PROTECTION_2024_SOURCE_ENTITY_IDS } from '../rules-core/testing/fightingStyleFixtures';
import { RulesLab } from './RulesLab';
import {
  createRulesLabWorld,
  openRulesLabSession,
  RulesLabRollQueue,
  type RulesLabDependencies,
} from './rulesLabFixture';
import type { PersistentRulesSession } from '../rules-session/RulesSession';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function dependenciesFor(store: InMemoryRulesWorldStore): RulesLabDependencies {
  return {
    open: () => openRulesLabSession(store),
    reset: async () => undefined,
  };
}

describe('RulesLab browser acceptance adapter', () => {
  let container: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = null;
  });

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount());
      root = null;
    }
    document.body.replaceChildren();
  });

  async function mount(dependencies: RulesLabDependencies): Promise<void> {
    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(RulesLab, { dependencies }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await vi.waitFor(() => {
      expect(
        container.querySelector('[data-testid="rules-lab-actor-fighter"]'),
        container.innerHTML,
      ).not.toBeNull();
    });
  }

  async function renderScenario(
    scenarioId: string,
    dependencies: RulesLabDependencies,
  ): Promise<void> {
    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(RulesLab, { dependencies, scenarioId }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  function testNode(testId: string): HTMLElement {
    const node = container.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
    if (!node) throw new Error(`Missing data-testid=${testId}`);
    return node;
  }

  function button(testId: string): HTMLButtonElement {
    return testNode(testId) as HTMLButtonElement;
  }

  async function clickAndWaitForRevision(testId: string, revision: number): Promise<void> {
    await act(async () => {
      button(testId).click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await vi.waitFor(() => expect(testNode('rules-lab-revision').textContent).toBe(String(revision)));
  }

  it('projects exactly two PCs and runs action, check and save only in a valid turn phase', async () => {
    const deterministicWorld = createRulesLabWorld();
    const deterministicFighter = deterministicWorld.actors.fighter;
    const deterministicWeapon = deterministicFighter.character.equippedCards?.find((card) => (
      card.id === deterministicFighter.runtime.equipment.main_hand
    ));
    const rollProbe = new RulesLabRollQueue();
    const attackDie = Math.floor(rollProbe.rng() * 20) + 1;
    const damageDie = Math.floor(rollProbe.rng() * 6) + 1;
    expect(deterministicWeapon?.mechanics).toMatchObject({
      weapon_profile: {
        weapon_type: 'mace',
        attack_ability: 'str',
        damage_lines: [{ dice: '1d6', type: 'bludgeoning' }],
      },
    });
    expect({ attackDie, damageDie, strengthModifier: deterministicFighter.character.abilityMods.str })
      .toEqual({ attackDie: 14, damageDie: 2, strengthModifier: 3 });

    await mount(dependenciesFor(new InMemoryRulesWorldStore()));

    expect(testNode('rules-lab-scenario-nav').getAttribute('aria-label')).toContain('Сценарии');
    expect(testNode('rules-lab-scenario-baseline').getAttribute('href')).toBe('/rules-lab/baseline');
    expect(testNode('rules-lab-scenario-baseline').getAttribute('aria-current')).toBe('page');
    expect(container.querySelectorAll('[data-testid^="rules-lab-actor-"]')).toHaveLength(2);
    expect(container.querySelector('[data-testid="rules-lab-summoned-actors"]')).toBeNull();
    expect(testNode('rules-lab-object-state').textContent).toContain('не сдвинут');
    expect(testNode('rules-lab-actor-fighter').textContent).toContain('CLASS-warrior');
    expect(testNode('rules-lab-actor-wizard').textContent).toContain('CLASS-wizard');
    expect(button('rules-lab-action').disabled).toBe(true);
    expect(testNode('rules-lab-action-reason').textContent).toContain('запустите столкновение');

    const allButtons = [...container.querySelectorAll<HTMLButtonElement>('button')];
    expect(allButtons.length).toBeGreaterThanOrEqual(9);
    for (const candidate of allButtons) {
      expect(candidate.dataset.testid).toMatch(/^rules-lab-/);
      const describedBy = candidate.getAttribute('aria-describedby');
      expect(describedBy).toBeTruthy();
      expect(describedBy ? document.getElementById(describedBy) : null).not.toBeNull();
    }

    await clickAndWaitForRevision('rules-lab-start-encounter', 1);
    expect(testNode('rules-lab-round').textContent).toBe('1');
    expect(button('rules-lab-action').disabled).toBe(true);
    expect(testNode('rules-lab-action-reason').textContent).toContain('начните ход');

    await clickAndWaitForRevision('rules-lab-start-turn', 2);
    expect(button('rules-lab-action').disabled).toBe(false);
    expect(button('rules-lab-action').textContent).toContain('Attack');
    await clickAndWaitForRevision('rules-lab-action', 3);
    expect(testNode('rules-lab-attack-state').textContent).toBe('1/1');
    expect(testNode('rules-lab-hp-wizard').textContent).toBe('10/10');
    expect(button('rules-lab-action').textContent).toContain('Булава');
    expect(button('rules-lab-action').disabled).toBe(false);
    await clickAndWaitForRevision('rules-lab-action', 4);
    expect(testNode('rules-lab-hp-wizard').textContent).toBe('5/10');
    expect(testNode('rules-lab-effects-wizard').textContent).toContain('Нет активных эффектов');
    expect(testNode('rules-lab-events').textContent).toContain('core.attack.weapon');
    expect(testNode('rules-lab-events').textContent).toContain('урон 5 (bludgeoning)');
    expect(testNode('rules-lab-pending-state').textContent).toBe('нет');
    expect(testNode('rules-lab-attack-state').textContent).toBe('нет');
    expect(button('rules-lab-action').disabled).toBe(true);
    expect(testNode('rules-lab-action-reason').textContent).toContain('уже потрачен');

    await clickAndWaitForRevision('rules-lab-check', 5);
    await clickAndWaitForRevision('rules-lab-save', 6);
    expect(testNode('rules-lab-roll-queue').textContent).toContain('16');
    expect(testNode('rules-lab-events').textContent).toContain('Спасбросок');
  });

  it('restores a pending decision after remount and resumes it without paying twice', async () => {
    const store = new InMemoryRulesWorldStore();
    const dependencies = dependenciesFor(store);
    await mount(dependencies);

    await clickAndWaitForRevision('rules-lab-start-encounter', 1);
    await clickAndWaitForRevision('rules-lab-start-turn', 2);
    await clickAndWaitForRevision('rules-lab-end-turn', 3);
    await clickAndWaitForRevision('rules-lab-start-turn', 4);
    await clickAndWaitForRevision('rules-lab-action', 5);

    expect(testNode('rules-lab-pending-state').textContent).toBe('target_save');
    expect(button('rules-lab-action').textContent).toContain('Волна грома');
    expect(testNode('rules-lab-pending-detail').textContent).toContain('СЛ 12');
    expect(testNode('rules-lab-resources-wizard').textContent).toContain('1/2');
    expect(testNode('rules-lab-object-state').textContent).toContain('10 фт.');

    await act(async () => root?.unmount());
    root = null;
    container.replaceChildren();
    await mount(dependencies);

    expect(testNode('rules-lab-revision').textContent).toBe('5');
    expect(testNode('rules-lab-pending-state').textContent).toBe('target_save');
    expect(testNode('rules-lab-object-state').textContent).toContain('10 фт.');
    expect(testNode('rules-lab-live-status').textContent).toContain('восстановлен');
    expect(button('rules-lab-end-turn').disabled).toBe(true);
    expect(testNode('rules-lab-end-turn-reason').textContent).toContain('завершите открытое решение');

    await clickAndWaitForRevision('rules-lab-resolve-fail', 6);
    expect(testNode('rules-lab-pending-state').textContent).toBe('нет');
    expect(testNode('rules-lab-hp-fighter').textContent).toBe('5/14');
    expect(testNode('rules-lab-effects-fighter').textContent).toContain('Нет активных эффектов');
    expect(testNode('rules-lab-events').textContent).toContain('урон 9 (thunder)');
    expect(testNode('rules-lab-resources-wizard').textContent).toContain('1/2');

    const queueAfterResolution = testNode('rules-lab-roll-queue').textContent;
    await act(async () => root?.unmount());
    root = null;
    container.replaceChildren();
    await mount(dependencies);
    expect(testNode('rules-lab-revision').textContent).toBe('6');
    expect(testNode('rules-lab-roll-queue').textContent).toBe(queueAfterResolution);
  });

  it('renders a restored Protection decision explicitly before the attack roll', async () => {
    const world = createRulesLabWorld();
    const shield = readProdSnapshotCatalogs().cards.find((card) => card.card_number === 'CARD-0200');
    if (!shield) throw new Error('Missing canonical physical Shield fixture');
    const fighter = world.actors.fighter;
    fighter.capabilities.featureSources = {
      ...(fighter.capabilities.featureSources ?? {}),
      [PROTECTION_2024_CAPABILITY_ID]: [...PROTECTION_2024_SOURCE_ENTITY_IDS],
    };
    fighter.character.knownCards = [shield];
    fighter.character.equippedCards = [shield];
    fighter.runtime.equipment.off_hand = shield.id;
    fighter.runtime.inventory = [{ cardId: shield.id, qty: 1 }];
    world.revision = 7;
    world.pendingResolution = {
      id: 'rules-lab:protection:resolution',
      type: 'protection_reaction',
      openedByCommandId: 'rules-lab:protection:attack',
      openedAtRevision: 7,
      deadlineLogicalClock: 20,
      sourceActorId: 'wizard',
      targetActorId: 'wizard',
      actionId: 'rules-lab:test-attack',
      facts: {
        factsSource: 'scenario', boardRevision: 7, distanceFt: 5,
        lineOfSight: true, cover: 'none', relation: 'self',
      },
      attackContinuationKind: 'catalog',
      preRollDisadvantageReasons: [],
      protectionCandidates: [{
        factsSource: 'scenario', boardRevision: 7, protectorActorId: 'fighter',
        protectorCanSeeAttacker: true, protectorDistanceToTargetFt: 5,
      }],
      remainingReactions: [],
      request: {
        id: 'rules-lab:protection:request',
        type: 'reaction',
        actorId: 'fighter',
        trigger: {
          type: 'protection_before_attack', sourceActorId: 'wizard', targetActorId: 'wizard',
          actionId: 'rules-lab:test-attack', attackId: 'rules-lab:protection:attack',
        },
        options: [{ actionId: PROTECTION_2024_CAPABILITY_ID, label: 'Protection' }],
      },
    };
    // This is a projection-only fixture. Persisting a hand-mutated snapshot is
    // intentionally forbidden now that RulesSession verifies snapshot replay.
    const dependencies: RulesLabDependencies = {
      open: async () => ({
        session: {
          getState: () => world,
          subscribe: () => () => undefined,
        } as unknown as PersistentRulesSession,
        rollQueue: new RulesLabRollQueue(),
        initialEvents: [],
        close: async () => undefined,
      }),
      reset: async () => undefined,
    };
    await mount(dependencies);

    expect(testNode('rules-lab-pending-state').textContent).toBe('protection_reaction');
    expect(testNode('rules-lab-pending-detail').textContent).toContain('до броска атаки');
    expect(testNode('rules-lab-pending-detail').textContent).toContain('может защитить');
    expect(button('rules-lab-protection-use').disabled).toBe(false);
    expect(button('rules-lab-protection-decline').disabled).toBe(false);
    expect(button('rules-lab-resolve-fail').disabled).toBe(true);
    expect(button('rules-lab-resolve-success').disabled).toBe(true);
  });

  it('fails closed for an unknown scenario without opening or resetting any world', async () => {
    const dependencies: RulesLabDependencies = {
      open: vi.fn(async () => {
        throw new Error('unknown scenario must not open a session');
      }),
      reset: vi.fn(async () => undefined),
    };

    await renderScenario('not-registered', dependencies);

    expect(testNode('rules-lab-unknown-scenario').textContent).toContain('Неизвестный сценарий');
    expect(testNode('rules-lab-error').textContent).toContain('не зарегистрирован');
    expect(testNode('rules-lab-open-baseline').getAttribute('href')).toBe('/rules-lab/baseline');
    expect(dependencies.open).not.toHaveBeenCalled();
    expect(dependencies.reset).not.toHaveBeenCalled();
  });
});
