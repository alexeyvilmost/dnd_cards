import { describe, expect, it } from 'vitest';
import {
  COLOR_BY_TYPE,
  NEUTRAL_COLOR,
  createEmptyCharacter,
  rollInitiativeValue,
} from '../types/initiative';
import {
  characterToLibrary,
  libraryToCharacter,
  upsertLibraryCreature,
  type LibraryCreature,
} from './initiativeLibrary';
import { decodeCombatState, encodeCombatState } from './initiativeShare';
import { searchTtgBestiary, ttgEntryUrl } from './ttgBestiaryMap';

describe('initiative feature smoke', () => {
  it('colors by add-path (#9)', () => {
    expect(COLOR_BY_TYPE.player).toBe('green');
    expect(COLOR_BY_TYPE.monster).toBe('red');
    expect(NEUTRAL_COLOR).toBe('blue');
    expect(createEmptyCharacter().color).toBe('blue');
  });

  it('library <-> character conversion keeps bonus and colors (#8, #9)', () => {
    const lib: LibraryCreature = {
      id: 'x', name: 'Гоблин', type: 'monster', color: 'red',
      ac: 15, maxHp: 7, initiativeBonus: 2, description: 'd',
    };
    const ch = libraryToCharacter(lib);
    expect(ch.color).toBe('red');
    expect(ch.currentHp).toBe(7);
    expect(ch.initiativeBonus).toBe(2);
    expect(ch.initiative).toBe(0);

    const back = characterToLibrary({
      ...createEmptyCharacter(), name: 'Эльф', type: 'player', color: 'green',
      ac: 14, maxHp: 20, initiativeBonus: 3,
    });
    expect(back.type).toBe('player');
    expect(back.initiativeBonus).toBe(3);
    expect('currentHp' in back).toBe(false);
  });

  it('library upsert dedups by name+source', () => {
    const base: LibraryCreature = {
      id: '1', name: 'Орк', type: 'monster', color: 'red',
      ac: 13, maxHp: 15, initiativeBonus: 1, description: '',
    };
    let list: LibraryCreature[] = [];
    list = upsertLibraryCreature(list, base);
    list = upsertLibraryCreature(list, { ...base, id: '2', ac: 99 });
    expect(list).toHaveLength(1);
    expect(list[0].ac).toBe(99);
  });

  it('share state round-trip (#5)', () => {
    const state = {
      characters: [createEmptyCharacter({ name: 'Скелет', type: 'monster', initiative: 12, initiativeBonus: 3 })],
      activeIndex: 0,
      round: 2,
    };
    const dec = decodeCombatState(encodeCombatState(state));
    expect(dec?.characters[0].name).toBe('Скелет');
    expect(dec?.round).toBe(2);
    expect(dec?.characters[0].initiativeBonus).toBe(3);
    expect(decodeCombatState('!!bad!!')).toBeNull();
  });

  it('ttg map search (#7)', () => {
    expect(searchTtgBestiary('скелет').some((e) => e.slug === 'skeleton-mm')).toBe(true);
    expect(searchTtgBestiary('owlbear').some((e) => e.slug === 'owlbear-mm')).toBe(true);
    expect(ttgEntryUrl({ slug: 'skeleton-mm', name: 'x' })).toBe(
      'https://new.ttg.club/bestiary/skeleton-mm',
    );
  });

  it('initiative roll is d20 + bonus (#2, #8)', () => {
    for (let i = 0; i < 200; i += 1) {
      const r = rollInitiativeValue(3);
      expect(r).toBeGreaterThanOrEqual(4);
      expect(r).toBeLessThanOrEqual(23);
    }
  });
});
