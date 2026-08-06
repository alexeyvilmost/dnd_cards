// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ONLINE_ENCOUNTER_MANUAL_EFFECT_BLOCK_REASON,
} from '../character/manualEffectMutationPolicy';
import type { ForgeCharacter } from '../character/types';
import type { PassiveEffect } from '../types';
import MobileEntityCatalog, {
  MOBILE_CONDITION_EVENT_JOURNAL_LIMITATION,
  saveMobileCatalogSelection,
  type CatalogEntity,
} from './MobileEntityCatalog';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  getCharacter: vi.fn(),
  patchRuntime: vi.fn(),
  postRuntimeCommand: vi.fn(),
  getEffects: vi.fn(),
  getCard: vi.fn(),
  loadAssembly: vi.fn(),
  expandItemGrantedEffects: vi.fn(),
  executeManualEffectCommand: vi.fn(),
}));

vi.mock('react-router-dom', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-router-dom')>(),
  useNavigate: () => mocks.navigate,
  useParams: () => ({ id: 'character:mobile', type: 'conditions' }),
}));

vi.mock('../settings', () => ({
  useSiteSettings: () => ({ allowSheetEntityAdditions: true }),
}));

vi.mock('../character/api', () => ({
  charactersV3Api: {
    get: mocks.getCharacter,
    patchRuntime: mocks.patchRuntime,
    postRuntimeCommand: mocks.postRuntimeCommand,
  },
}));

vi.mock('../api/client', () => ({
  actionsApi: { getActions: vi.fn() },
  cardsApi: { getCards: vi.fn(), getCard: mocks.getCard },
  effectsApi: { getEffects: mocks.getEffects },
  featsApi: { getFeats: vi.fn() },
  resourcesApi: { getResources: vi.fn() },
  spellsApi: { getSpells: vi.fn() },
}));

vi.mock('../api/conditionsApi', () => ({
  certifiedConditionEffectEntity: () => CONDITION_SOURCE,
}));

vi.mock('../character/assemble', async (importOriginal) => ({
  ...await importOriginal<typeof import('../character/assemble')>(),
  loadAssembly: mocks.loadAssembly,
  expandItemGrantedEffects: mocks.expandItemGrantedEffects,
}));

vi.mock('../character/attunement', () => ({
  collectItemMechanics: () => [],
}));

vi.mock('../character/resourceInit', () => ({
  collectPassiveMechanics: () => [],
}));

vi.mock('../engine/manualEffectCommands', () => ({
  applyEffectCommandFromEntity: () => ({ type: 'ApplyEffect' }),
  collectConditionImmunitiesFromPassives: () => [],
  conditionIdFromEffectEntity: () => 'poisoned',
  executeManualEffectCommand: mocks.executeManualEffectCommand,
  nextBrowserManualEffectId: () => 'manual:mobile:test',
}));

const CONDITION_SOURCE = {
  id: 'effect:poisoned',
  name: 'Отравлен',
  description: 'Condition fixture',
  effect_type: 'condition',
  mechanics: { condition: { id: 'poisoned' }, effects: [] },
} as unknown as PassiveEffect;

const CONDITION_ENTITY: CatalogEntity = {
  id: CONDITION_SOURCE.id,
  name: CONDITION_SOURCE.name,
  description: CONDITION_SOURCE.description ?? '',
  repeatable: false,
  source: CONDITION_SOURCE,
};

function character(currentEncounterId: string | null): ForgeCharacter {
  return {
    id: 'character:mobile',
    user_id: 'user:owner',
    name: 'Mobile probe',
    system_id: 'dnd5e-2024',
    ruleset_version: '2024',
    character_type: 'free',
    character_schema_version: 1,
    level: 1,
    race_id: null,
    class_id: null,
    background_id: null,
    feat_ids: [],
    spell_ids: [],
    action_ids: [],
    effect_ids: [],
    resource_ids: [],
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    max_hp: 10,
    current_hp: 10,
    speed: 30,
    proficiency_bonus: 2,
    equipment: {},
    inventory_items: [],
    resources: {},
    max_resources: {},
    active_effects: [],
    turn_state: {},
    runtime_revision: 4,
    current_encounter_id: currentEncounterId,
    access_mode: 'owner',
    created_at: '2026-08-06T00:00:00Z',
    updated_at: '2026-08-06T00:00:00Z',
  };
}

const ASSEMBLED = {
  race: null, klass: null, background: null, feats: [], effects: [], actions: [], spells: [],
  resources: [], pendingChoices: [], featAbilityIncreases: [], variables: {}, derived: {},
};

function forceReactClick(button: HTMLButtonElement): unknown {
  const key = Object.getOwnPropertyNames(button)
    .find((name) => name.startsWith('__reactProps$'));
  const handler = key
    ? (button as unknown as Record<string, { onClick?: () => unknown }>)[key]?.onClick
    : undefined;
  if (!handler) throw new Error('React click handler is unavailable');
  return handler();
}

describe('MobileEntityCatalog manual condition authority', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.loadAssembly.mockResolvedValue(ASSEMBLED);
    mocks.expandItemGrantedEffects.mockResolvedValue([]);
    mocks.getCard.mockRejectedValue(new Error('unexpected item read'));
    mocks.getEffects.mockResolvedValue({ effects: [CONDITION_SOURCE], total: 1 });
    mocks.executeManualEffectCommand.mockImplementation((runtime) => ({
      state: {
        ...runtime,
        activeEffects: [{
          id: 'condition:poisoned:one',
          name: 'Отравлен',
          mechanics: { kind: 'condition', value: 'poisoned' },
          source: 'manual:mobile_entity_catalog',
        }],
      },
      events: [{ type: 'condition_applied', condition: 'poisoned' }],
    }));
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function renderCatalog(value: ForgeCharacter): Promise<void> {
    mocks.getCharacter.mockResolvedValue(value);
    await act(async () => {
      root.render(<MobileEntityCatalog />);
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it('rejects a forced online save before any persistence, while detached save patches runtime only', async () => {
    await expect(saveMobileCatalogSelection(
      character('encounter:owned'),
      'conditions',
      [CONDITION_ENTITY],
      { [CONDITION_ENTITY.id]: 1 },
      { sourceActorId: '', causeTags: '' },
    )).rejects.toThrow(ONLINE_ENCOUNTER_MANUAL_EFFECT_BLOCK_REASON);
    expect(mocks.patchRuntime).not.toHaveBeenCalled();
    expect(mocks.postRuntimeCommand).not.toHaveBeenCalled();
    expect(mocks.loadAssembly).not.toHaveBeenCalled();

    const detached = character(null);
    mocks.patchRuntime.mockImplementation(async (_characterId, payload) => ({
      ...detached,
      runtime_revision: 5,
      active_effects: payload.active_effects,
    }));
    await expect(saveMobileCatalogSelection(
      detached,
      'conditions',
      [CONDITION_ENTITY],
      { [CONDITION_ENTITY.id]: 1 },
      { sourceActorId: '', causeTags: '' },
    )).resolves.toEqual([{ type: 'condition_applied', condition: 'poisoned' }]);
    expect(mocks.patchRuntime).toHaveBeenCalledTimes(1);
    expect(mocks.patchRuntime).toHaveBeenCalledWith(detached.id, {
      expected_runtime_revision: 4,
      active_effects: [expect.objectContaining({
        mechanics: { kind: 'condition', value: 'poisoned' },
      })],
    });
    // This mobile flow has no certified ruleset_ref/command envelope for the
    // backend runtime-command endpoint. Do not silently pretend the returned
    // local event was persisted as journal authority.
    expect(mocks.postRuntimeCommand).not.toHaveBeenCalled();
  });

  it('renders the detached-sheet journal limitation instead of implying atomic event persistence', async () => {
    await renderCatalog(character(null));
    const notice = container.querySelector('[data-testid="mobile-condition-journal-limitation"]');
    expect(notice?.textContent).toBe(MOBILE_CONDITION_EVENT_JOURNAL_LIMITATION);
    expect(container.textContent).not.toContain(ONLINE_ENCOUNTER_MANUAL_EFFECT_BLOCK_REASON);
  });

  it('keeps the mobile apply handler fail-closed when disabled controls are forcibly invoked', async () => {
    await renderCatalog(character('encounter:owned'));
    const button = (text: string) => [...container.querySelectorAll('button')]
      .find((entry) => entry.textContent?.includes(text)) as HTMLButtonElement;

    const add = button('Добавить');
    expect(add.disabled).toBe(true);
    await act(async () => {
      forceReactClick(add);
    });
    const proceed = button('Продолжить');
    expect(proceed.disabled).toBe(true);
    await act(async () => {
      forceReactClick(proceed);
    });
    const apply = button('Применить');
    expect(apply.disabled).toBe(true);
    await act(async () => {
      await forceReactClick(apply);
    });

    expect(mocks.patchRuntime).not.toHaveBeenCalled();
    expect(mocks.postRuntimeCommand).not.toHaveBeenCalled();
    expect(container.textContent).toContain(ONLINE_ENCOUNTER_MANUAL_EFFECT_BLOCK_REASON);
  });
});
