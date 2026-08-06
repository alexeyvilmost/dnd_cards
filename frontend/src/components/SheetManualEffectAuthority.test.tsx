// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssembledCharacter } from '../character/assemble';
import {
  ONLINE_ENCOUNTER_MANUAL_EFFECT_BLOCK_REASON,
} from '../character/manualEffectMutationPolicy';
import type { CharacterRuleState } from '../character/rules/types';
import type { ForgeCharacter } from '../character/types';
import SheetConditionsPanel from './SheetConditionsPanel';
import SheetRuntimePanel from './SheetRuntimePanel';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { persistCharacterRuntimeMock, persistDetachedManualEffectsMock } = vi.hoisted(() => ({
  persistCharacterRuntimeMock: vi.fn(),
  persistDetachedManualEffectsMock: vi.fn(),
}));

vi.mock('../character/runtimePersistence', () => ({
  persistCharacterRuntime: persistCharacterRuntimeMock,
}));

vi.mock('../character/manualEffectPersistence', () => ({
  persistDetachedManualEffects: persistDetachedManualEffectsMock,
}));

vi.mock('../utils/resources', async (importOriginal) => ({
  ...await importOriginal<typeof import('../utils/resources')>(),
  useResourceOptions: () => [],
}));

vi.mock('./SheetRestButtons', () => ({ default: () => null }));
vi.mock('./FreeuseSpellsTile', () => ({ default: () => null }));

const ACTIVE_EFFECT = {
  id: 'effect:poisoned:one',
  name: 'Отравлен',
  mechanics: { kind: 'condition', value: 'poisoned' },
  source: 'manual:test',
};

function character(currentEncounterId: string | null): ForgeCharacter {
  return {
    id: 'character:manual-effect',
    user_id: 'user:owner',
    name: 'Authority probe',
    system_id: 'dnd5e-2024',
    ruleset_version: '2024',
    character_type: 'free',
    character_schema_version: 1,
    level: 1,
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    max_hp: 10,
    current_hp: 10,
    speed: 30,
    proficiency_bonus: 2,
    equipment: {},
    inventory_items: [],
    resources: { action: 1, bonus_action: 1, reaction: 1 },
    max_resources: { action: 1, bonus_action: 1, reaction: 1 },
    active_effects: [ACTIVE_EFFECT],
    turn_state: { temp_hp: 0 },
    current_encounter_id: currentEncounterId,
    access_mode: 'owner',
    created_at: '2026-08-06T00:00:00Z',
    updated_at: '2026-08-06T00:00:00Z',
  };
}

const assembled = {
  race: null,
  klass: null,
  background: null,
  feats: [],
  effects: [],
  actions: [],
  spells: [],
  resources: [],
  pendingChoices: [],
  featAbilityIncreases: [],
  variables: {},
  derived: {},
} as unknown as AssembledCharacter;

const ruleState = {
  version: 1,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
  proficiencyBonus: 2,
  proficiencies: {
    skills: [], savingThrows: [], tools: [], languages: [], weapons: [], armor: [],
  },
  expertise: { skills: [], tools: [] },
  spells: { known: [], cantrips: [], leveled: [] },
  skillBonuses: {},
  savingThrowBonuses: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
  maxHP: 10,
  armorClass: 10,
  speed: 30,
  baseSpeed: 30,
  size: 2,
  carryingCapacity: 150,
  senses: [],
  speeds: {},
  weaponMasteries: [],
  initiativeBonus: 0,
  passivePerception: 10,
  spellcasting: null,
  appliedGrants: [],
  conflicts: [],
  variables: {},
  freeuseSpells: [],
} as unknown as CharacterRuleState;

function forceClick(button: HTMLButtonElement): void {
  // React correctly suppresses DOM click events for disabled controls. Read
  // the attached handler deliberately to exercise the application boundary,
  // as if a stale caller retained and invoked it after the UI became blocked.
  const key = Object.getOwnPropertyNames(button)
    .find((name) => name.startsWith('__reactProps$'));
  const handler = key
    ? (button as unknown as Record<string, { onClick?: () => void }>)[key]?.onClick
    : undefined;
  if (!handler) throw new Error('React click handler is unavailable');
  handler();
}

describe('manual-effect component authority boundaries', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    persistCharacterRuntimeMock.mockReset();
    persistDetachedManualEffectsMock.mockReset();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('SheetConditionsPanel rejects a forced online removal before persistence, while a detached sheet persists', async () => {
    const online = character('encounter:owned');
    await act(async () => root.render(
      <SheetConditionsPanel character={online} onUpdated={() => undefined} passives={[]} />,
    ));
    const onlineRemove = container.querySelector('.sheet-active-effect-dismiss') as HTMLButtonElement;
    expect(onlineRemove.disabled).toBe(true);
    await act(async () => forceClick(onlineRemove));
    expect(persistDetachedManualEffectsMock).not.toHaveBeenCalled();
    expect(persistCharacterRuntimeMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain(ONLINE_ENCOUNTER_MANUAL_EFFECT_BLOCK_REASON);

    const detached = character(null);
    persistDetachedManualEffectsMock.mockResolvedValue(detached);
    await act(async () => root.render(
      <SheetConditionsPanel character={detached} onUpdated={() => undefined} passives={[]} />,
    ));
    const detachedRemove = container.querySelector('.sheet-active-effect-dismiss') as HTMLButtonElement;
    expect(detachedRemove.disabled).toBe(false);
    await act(async () => {
      detachedRemove.click();
      await Promise.resolve();
    });
    expect(persistDetachedManualEffectsMock).toHaveBeenCalledTimes(1);
    expect(persistDetachedManualEffectsMock).toHaveBeenCalledWith(detached, []);
    expect(persistCharacterRuntimeMock).not.toHaveBeenCalled();
  });

  it('SheetRuntimePanel rejects a forced online dismissal before persistence, while a detached sheet persists', async () => {
    const online = character('encounter:owned');
    await act(async () => root.render(
      <SheetRuntimePanel
        character={online}
        assembled={assembled}
        ruleState={ruleState}
        onUpdated={() => undefined}
      />,
    ));
    const onlineDismiss = container.querySelector('.sheet-active-effect-dismiss') as HTMLButtonElement;
    expect(onlineDismiss.disabled).toBe(true);
    await act(async () => forceClick(onlineDismiss));
    expect(persistDetachedManualEffectsMock).not.toHaveBeenCalled();
    expect(persistCharacterRuntimeMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain(ONLINE_ENCOUNTER_MANUAL_EFFECT_BLOCK_REASON);

    const detached = character(null);
    persistDetachedManualEffectsMock.mockResolvedValue(detached);
    await act(async () => root.render(
      <SheetRuntimePanel
        character={detached}
        assembled={assembled}
        ruleState={ruleState}
        onUpdated={() => undefined}
      />,
    ));
    const detachedDismiss = container.querySelector('.sheet-active-effect-dismiss') as HTMLButtonElement;
    expect(detachedDismiss.disabled).toBe(false);
    await act(async () => {
      detachedDismiss.click();
      await Promise.resolve();
    });
    expect(persistDetachedManualEffectsMock).toHaveBeenCalledTimes(1);
    expect(persistDetachedManualEffectsMock).toHaveBeenCalledWith(detached, []);
    expect(persistCharacterRuntimeMock).not.toHaveBeenCalled();
  });
});
