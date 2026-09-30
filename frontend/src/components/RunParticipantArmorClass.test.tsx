// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadSheetCanonicalParticipant } from '../character/sheetCombatTargetRuntime';
import type { SheetCombatParticipantSeed } from '../character/sheetCombatSession';
import type { ForgeCharacter } from '../character/types';
import type { ActorState } from '../rules-core/domain';
import RunParticipantArmorClass from './RunParticipantArmorClass';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('../character/sheetCombatTargetRuntime', () => ({ loadSheetCanonicalParticipant: vi.fn() }));
const context = { level: 1, profBonus: 2, abilityMods: { str: 0, dex: 1, con: 0, int: 0, wis: 0, cha: 0 } };
const runtime = { hp: { current: 10, max: 10, temp: 0 }, resources: {}, maxResources: {}, inventory: [], equipment: {}, activeEffects: [] };
const hero = (id: string, armor_class = 11) => ({ id, name: id, armor_class, runtime_revision: 1 } as unknown as ForgeCharacter);
function participant(character: ForgeCharacter, ac: number, activeBonus = 0) {
  const actor = { id: character.id, ac, character: context, runtime: {
    ...runtime, activeEffects: activeBonus ? [{ id: 'active', name: 'Active defense', source: 'effect',
      mechanics: { kind: 'modifier', op: 'add', value: activeBonus, applies_to: { roll: 'ac' } } }] : [],
  }, passives: [] } as unknown as ActorState;
  return { canonical: { world: { actors: { [character.id]: actor } } } } as unknown as SheetCombatParticipantSeed;
}

describe('run participant equipped КД', () => {
  let root: Root, container: HTMLDivElement;
  beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.resetAllMocks(); });

  it.each([
    ['armored-fighter', 11, 17, 0],
    ['attuned-defender', 10, 16, 2],
  ])('displays canonical equipped and transient defense for %s instead of saved forge КД', async (id, saved, baseline, transient) => {
    const character = hero(id, saved);
    vi.mocked(loadSheetCanonicalParticipant).mockResolvedValue(participant(character, baseline, transient));
    await act(async () => root.render(<RunParticipantArmorClass character={character} />));
    expect(loadSheetCanonicalParticipant).toHaveBeenCalledExactlyOnceWith({ character, cards: new Map() });
    expect(container.textContent).toBe(`КД ${baseline + transient}`);
  });

  it('hides the previous projection while a newer equipment snapshot is loading', async () => {
    const first = hero('fighter');
    const second = { ...first, runtime_revision: 2 };
    let resolve!: (value: SheetCombatParticipantSeed) => void;
    vi.mocked(loadSheetCanonicalParticipant).mockResolvedValueOnce(participant(first, 17))
      .mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    await act(async () => root.render(<RunParticipantArmorClass character={first} />));
    expect(container.textContent).toBe('КД 17');
    await act(async () => root.render(<RunParticipantArmorClass character={second} />));
    expect(container.textContent).toBe('КД …');
    await act(async () => resolve(participant(second, 19)));
    expect(container.textContent).toBe('КД 19');
  });

  it('shows an unavailable projection on assembly failure instead of a misleading saved value', async () => {
    vi.mocked(loadSheetCanonicalParticipant).mockRejectedValue(new Error('Каталог недоступен'));
    await act(async () => root.render(<RunParticipantArmorClass character={hero('fighter')} />));
    expect(container.textContent).toBe('КД недоступна');
    expect(container.querySelector('span')?.getAttribute('aria-description')).toBe('Каталог недоступен');
  });
});
