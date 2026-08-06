import { describe, expect, it } from 'vitest';
import {
  ENCOUNTER_GM_OVERRIDE_PROVENANCE,
  explicitEncounterArmorClass,
  manualGmOverrideCombatant,
} from './encounterOverrides';

describe('EncounterBoard explicit GM override boundary', () => {
  it('uses compiled AC first, then explicit persisted AC, and never invents AC 10', () => {
    expect(explicitEncounterArmorClass({
      rule_state: { armorClass: 17 } as never,
      armor_class: 12,
    })).toBe(17);
    expect(explicitEncounterArmorClass({ rule_state: null, armor_class: 15 })).toBe(15);
    expect(() => explicitEncounterArmorClass({ rule_state: null, armor_class: undefined }))
      .toThrow(/КЗ персонажа должен быть явно задан/);
    expect(() => explicitEncounterArmorClass({
      rule_state: { armorClass: 0 } as never,
      armor_class: 15,
    })).toThrow(/Скомпилированный КЗ/);
  });

  it('requires explicit positive HP and AC for manual enrollment', () => {
    expect(manualGmOverrideCombatant({
      actorId: 'actor:monster', name: 'Ogre', hp: '59', ac: '11',
    })).toMatchObject({ hp: 59, maxHp: 59, ac: 11, isMonster: true });
    expect(() => manualGmOverrideCombatant({
      actorId: 'actor:monster', name: 'Ogre', hp: '', ac: '',
    })).toThrow(/HP существа должен быть явно задан/);
    expect(ENCOUNTER_GM_OVERRIDE_PROVENANCE).toBe('gm_override:encounter_board');
  });
});
