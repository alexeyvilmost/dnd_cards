import { describe, expect, it, vi } from 'vitest';
import type { Card, Spell } from '../types';
import { calculateSheet, createPaperSheet, exportPaperSheet, importPaperSheet } from './model';
import { applyPaperRowPatch, canApplyPaperRowPatch, preparedSpellPatch, renderPaperRollText, weaponCardPatch, weaponSpellPatch } from './rowAutofill';

function weapon(overrides: Record<string, unknown> = {}): Card {
  return {
    id: 'blade-a', name: 'Подписанный клинок +9', type: 'weapon', enchant_bonus: 9, bonus_value: '9d100', damage_type: 'fire',
    mechanics: { weapon_profile: {
      weapon_type: 'longsword', proficiency_category: 'martial', attack_ability: 'str',
      damage_lines: [{ dice: '1d8', type: 'slashing' }], default_attack_mode: 'melee',
      attack_modes: [{ kind: 'melee', reach_ft: 5 }], properties: [], mastery_effect_id: 'effect:mastery:sap',
      ammo: null, enchantment: { attack_bonus: 1, damage_bonus: 1, extra_damage_lines: [] }, attunement: { required: false },
      ...overrides,
    } },
  } as unknown as Card;
}

function spell(overrides: Partial<Spell> = {}): Spell {
  return {
    id: 'spell-a', name: 'Искра', level: 0, casting_time: 'Действие', range: '60 футов',
    concentration: false, ritual: false, component_material: false, duration: 'Мгновенно',
    mechanics: { effects: [{ resolution: 'attack_roll', on_hit: [{ kind: 'damage', dice: '1d8', type: 'fire' }] }] },
    ...overrides,
  } as Spell;
}

describe('paper library row autofill', () => {
  it.each([
    ['melee', 'str', 18, 12, 1, 8, '1d8 + 5 рубящий'],
    ['ranged', 'dex', 8, 18, 2, 9, '1d8 + 6 рубящий'],
    ['melee', 'finesse', 14, 20, 2, 10, '1d8 + 7 рубящий'],
  ] as const)('uses the declared %s/%s profile, proficiency and enchantment instead of legacy labels', (mode, ability, str, dex, magic, attack, damage) => {
    let sheet = createPaperSheet();
    sheet.fields = { ...sheet.fields, str: String(str), dex: String(dex), level: '5' };
    sheet.checks['proficiency.martialWeapons'] = true;
    const patch = weaponCardPatch(1, weapon({ attack_ability: ability, default_attack_mode: mode,
      attack_modes: mode === 'melee' ? [{ kind: 'melee', reach_ft: 5 }] : [{ kind: 'ranged', normal_ft: 80, long_ft: 320 }],
      properties: ability === 'finesse' ? ['finesse'] : mode === 'ranged' ? ['ammunition'] : [],
      ammo: mode === 'ranged' ? { card_id: 'arrows' } : null,
      enchantment: { attack_bonus: magic, damage_bonus: magic, extra_damage_lines: [] },
    }));
    expect(patch.notice).toBeUndefined();
    sheet = applyPaperRowPatch(sheet, patch);
    expect(calculateSheet(sheet).values['weapon.1.bonus']).toBe(attack);
    expect(renderPaperRollText(sheet.fields['weapon.1.damage'], sheet)).toEqual({ text: damage });
    expect(sheet.fields['weapon.1.notes']).toBe(mode === 'melee' ? 'Досягаемость 5 фт.' : 'Дальность 80/320 фт.');
    const restored = importPaperSheet(exportPaperSheet(sheet));
    expect(restored.fields['weapon.1.bonus']).toBe(sheet.fields['weapon.1.bonus']);
    expect(calculateSheet(restored).values['weapon.1.bonus']).toBe(attack);
  });

  it('keeps finesse live after ability changes and adds a separate damage bonus only once', () => {
    let sheet = applyPaperRowPatch(createPaperSheet(), weaponCardPatch(0, weapon({ attack_ability: 'finesse', properties: ['finesse'], enchantment: { attack_bonus: 2, damage_bonus: 1, extra_damage_lines: [{ dice: '2d6', type: 'cold' }] } })));
    sheet.checks['proficiency.martialWeapons'] = true;
    sheet.fields.dex = '16';
    expect(calculateSheet(sheet).values['weapon.0.bonus']).toBe(7);
    expect(renderPaperRollText(sheet.fields['weapon.0.damage'], sheet).text).toBe('1d8 + 4 рубящий + 2d6 холод');
    sheet.fields.str = '22';
    expect(calculateSheet(sheet).values['weapon.0.bonus']).toBe(10);
    expect(renderPaperRollText(sheet.fields['weapon.0.damage'], sheet).text).toBe('1d8 + 7 рубящий + 2d6 холод');
  });

  it('uses the effective equipment ability score for attack and damage without changing the authored fields', () => {
    const sheet = applyPaperRowPatch(createPaperSheet(), weaponCardPatch(0, weapon()));
    sheet.checks['proficiency.martialWeapons'] = true;
    sheet.fields.str = '8';
    const saved = exportPaperSheet(sheet);
    const equipment = { abilityScores: { str: 20 } };
    expect(calculateSheet(sheet, equipment).values['weapon.0.bonus']).toBe(8);
    expect(renderPaperRollText(sheet.fields['weapon.0.damage'], sheet, equipment).text).toBe('1d8 + 6 рубящий');
    expect(calculateSheet(sheet).values['weapon.0.bonus']).toBe(2);
    expect(exportPaperSheet(sheet)).toBe(saved);
  });

  it.each(['simple', 'martial'] as const)('adds proficiency only when the declared %s weapon category is checked, and keeps the formula live', category => {
    const sheet = applyPaperRowPatch(createPaperSheet(), weaponCardPatch(0, weapon({ proficiency_category: category })));
    sheet.fields.str = '18';
    sheet.fields.level = '5';
    const formula = sheet.fields['weapon.0.bonus'];
    expect(formula).toContain(`[PROF] * [weapon_proficiency.${category}]`);
    expect(calculateSheet(sheet).values['weapon.0.bonus']).toBe(5);
    const wrongCategory = category === 'simple' ? 'martial' : 'simple';
    sheet.checks[`proficiency.${wrongCategory}Weapons`] = true;
    expect(calculateSheet(sheet).values['weapon.0.bonus']).toBe(5);
    sheet.checks[`proficiency.${category}Weapons`] = true;
    expect(calculateSheet(sheet).values['weapon.0.bonus']).toBe(8);
    expect(renderPaperRollText(sheet.fields['weapon.0.damage'], sheet).text).toBe('1d8 + 5 рубящий');
    const restored = importPaperSheet(exportPaperSheet(sheet));
    expect(calculateSheet(restored).values['weapon.0.bonus']).toBe(8);
    restored.checks[`proficiency.${category}Weapons`] = false;
    expect(calculateSheet(restored).values['weapon.0.bonus']).toBe(5);
    expect(restored.fields['weapon.0.bonus']).toBe(formula);
  });

  it('does not invent a magic bonus from the name or legacy fields when the canonical profile is absent', () => {
    const card = { ...weapon(), mechanics: null };
    const patch = weaponCardPatch(0, card);
    expect(patch.notice).toMatch(/нет полного оружейного профиля/);
    expect(patch.fields['weapon.0.bonus']).toBe('');
    expect(patch.fields['weapon.0.damage']).toBe('');
    expect(patch.fields['weapon.0.name']).toContain('Подписанный клинок +9');
    expect(patch.fields['weapon.0.notes']).toBe(patch.notice);
  });

  it('fills spell metadata and explicitly clears flags and metadata belonging to the previous selection', () => {
    const first = spell({ id: 'spell-ritual', name: 'Световой круг', level: 2, ritual: true, concentration: true, component_material: true, material_text: 'Кристалл', duration: '10 минут' });
    const second = spell({ id: 'spell-instant', name: 'Вспышка', casting_time: 'Реакция', range: 'На себя', duration: null });
    let sheet = createPaperSheet();
    sheet.fields['spellRow1Notes'] = 'Не менять другую строку';
    sheet = applyPaperRowPatch(sheet, preparedSpellPatch(0, first));
    expect(sheet.fields.spellRow0Level).toBe('2');
    expect(sheet.fields.spellRow0Notes).toBe('Длительность: 10 минут; М: Кристалл');
    expect(sheet.checks).toMatchObject({ spellRow0Concentration: true, spellRow0Ritual: true, spellRow0Material: true });
    sheet = applyPaperRowPatch(sheet, preparedSpellPatch(0, second));
    expect(sheet.fields).toMatchObject({ spellRow0Level: '0', spellRow0Time: 'Реакция', spellRow0Range: 'На себя', spellRow0Notes: '', spellRow1Notes: 'Не менять другую строку' });
    expect(sheet.checks).toMatchObject({ spellRow0Concentration: false, spellRow0Ritual: false, spellRow0Material: false });
  });

  it('distinguishes spell attack and saving throw from canonical mechanics and keeps the chosen spell ability live', () => {
    let sheet = createPaperSheet();
    sheet.fields.spellAbility = 'wis';
    sheet.fields.wis = '16';
    sheet = applyPaperRowPatch(sheet, weaponSpellPatch(0, spell()));
    const save = spell({ id: 'save-a', name: 'Иной заговор', damage: [{ dice: '9d100', damage_type: 'fire' }], mechanics: { effects: [{ resolution: 'save', ability: 'dex', dc: '8 + prof + spellcasting', on_fail: [{ kind: 'damage', dice: '2d6 + spellcasting', type: 'acid' }], on_success: [{ kind: 'damage', dice: '2d6 + spellcasting', type: 'acid', multiplier: 0.5 }] }] } });
    sheet = applyPaperRowPatch(sheet, weaponSpellPatch(1, save));
    expect(calculateSheet(sheet).values).toMatchObject({ 'weapon.0.bonus': 5, 'weapon.1.bonus': 13 });
    expect(renderPaperRollText(sheet.fields['weapon.1.damage'], sheet).text).toBe('2d6 + 3 кислота');
    expect(sheet.fields['weapon.1.notes']).toContain('Спасбросок: Ловкость');
    sheet.fields.wis = '20';
    sheet.fields.level = '9';
    expect(calculateSheet(sheet).values).toMatchObject({ 'weapon.0.bonus': 9, 'weapon.1.bonus': 17 });
    expect(renderPaperRollText(sheet.fields['weapon.1.damage'], sheet).text).toBe('2d6 + 5 кислота');
  });

  it('preserves manual edits after a delayed load while allowing unrelated document edits', () => {
    const original = createPaperSheet();
    const patch = preparedSpellPatch(2, spell());
    const unrelated = applyPaperRowPatch(original, { fields: { name: 'Другое имя' }, checks: {} });
    expect(canApplyPaperRowPatch(unrelated, original, patch)).toBe(true);
    const edited = applyPaperRowPatch(unrelated, { fields: { spellRow2Range: 'Своя дистанция' }, checks: {} });
    expect(canApplyPaperRowPatch(edited, original, patch)).toBe(false);
    const checked = applyPaperRowPatch(unrelated, { fields: {}, checks: { spellRow2Material: true } });
    expect(canApplyPaperRowPatch(checked, original, patch)).toBe(false);
  });

  it('never rolls damage dice, normalizes a negative modifier and preserves invalid scalar tokens for correction', () => {
    const random = vi.spyOn(Math, 'random').mockImplementation(() => { throw Error('Unexpected roll'); });
    try {
      const sheet = createPaperSheet();
      sheet.fields.str = '6';
      expect(renderPaperRollText('1d8 + {{[STR]}} рубящий', sheet)).toEqual({ text: '1d8 - 2 рубящий' });
      expect(renderPaperRollText('1d8 + {{1d4}}', sheet)).toMatchObject({ text: '1d8 + {{1d4}}', error: expect.stringMatching(/нельзя бросать кости/) });
      expect(random).not.toHaveBeenCalled();
    } finally { random.mockRestore(); }
  });
});
