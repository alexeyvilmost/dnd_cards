import { describe, expect, it } from 'vitest';
import type { Card } from '../types';
import { calculateSheet, createPaperSheet, type PaperSheetDocument } from './model';
import { paperEntityToken } from './references';
import { projectPaperEquipment, referencedPaperItemIds } from './equipmentEffects';

type Dict = Record<string, unknown>;
const passive = (...result: Dict[]) => ({ activation: { mode: 'passive' }, effects: [{ resolution: 'auto', result }] });
const modifier = (roll: string, value: string | number, op = 'add', filter?: Dict) => ({
  kind: 'modifier', applies_to: { roll, ...(filter ? { filter } : {}) }, op, value,
});
const item = (id: string, mechanics: Dict, extra: Partial<Card> = {}): Card => ({
  id, name: `Предмет ${id}`, type: 'cloak', mechanics, ...extra,
} as Card);
const token = (card: Card) => paperEntityToken({ type: 'card', id: card.id, name: card.name });
const map = (...cards: Card[]) => new Map(cards.map(card => [card.id, card]));
const equip = (document: PaperSheetDocument, slot: string, card: Card) => {
  document.fields[`equipment.${slot}`] = token(card);
};
const carry = (document: PaperSheetDocument, card: Card, quantity = '1', row = 0) => {
  document.fields[`inventory.${row}.item`] = token(card);
  document.fields[`inventory.${row}.quantity`] = quantity;
};
const attune = (document: PaperSheetDocument, card: Card, checked = true, row = 0) => {
  document.fields[`attunementName${row}`] = token(card);
  document.checks[`attunement${row}`] = checked;
};
const project = (document: PaperSheetDocument, ...cards: Card[]) => {
  const projection = projectPaperEquipment(document, map(...cards));
  return { projection, ...calculateSheet(document, projection) };
};

describe('paper equipment projection through the shared character rules', () => {
  it('hydrates only structured ownership and checked attunement references, with stable deduplication', () => {
    const doc = createPaperSheet();
    const first = item('first', passive()), second = item('second', passive()), third = item('third', passive());
    equip(doc, 'body', first);
    carry(doc, first);
    carry(doc, second, '0', 1);
    carry(doc, third, '2', 2);
    doc.fields['inventory.3.item'] = token(second); // Legacy row: omitted quantity means one.
    doc.fields['weapon.0.name'] = token(item('weapon-reference', passive()));
    doc.sections.equipment = { text: token(item('prose-reference', passive())), fontSize: 12 };
    attune(doc, item('unchecked', passive()), false);
    attune(doc, item('attuned', passive()), true, 1);
    expect(referencedPaperItemIds(doc)).toEqual(['first', 'third', 'second', 'attuned']);
    expect(projectPaperEquipment(doc, new Map())).toEqual({});
  });

  it('uses alternative ability methods and additive grants, recomputes dependent formulas, and never edits the base', () => {
    const doc = createPaperSheet();
    Object.assign(doc.fields, { str: '12', con: '12', level: '5', hpMax: '=20 + [CON] * [LVL]' });
    doc.training.athletics = 1;
    const belt = item('belt', passive({ kind: 'value_method', target: 'str', formula: '19' }));
    const charm = item('charm', passive({ kind: 'grant_ability_score', ability: 'con', amount: 2 }));
    equip(doc, 'body', belt); equip(doc, 'necklace', charm);
    const original = JSON.stringify(doc);
    const result = project(doc, belt, charm);
    expect(result.values).toMatchObject({ str: 19, strMod: 4, con: 14, conMod: 2, 'skill.athletics': 7, hpMax: 30 });
    expect(result.projection.sources?.str).toContain(belt.name);
    expect(result.projection.sources?.con).toContain(charm.name);
    expect(JSON.stringify(doc)).toBe(original);
    doc.fields['equipment.body'] = ''; doc.fields['equipment.necklace'] = '';
    expect(project(doc, belt, charm).values).toMatchObject({ str: 12, con: 12, 'skill.athletics': 4, hpMax: 25 });
    doc.fields.str = '20'; equip(doc, 'body', belt);
    expect(project(doc, belt).values.str).toBe(20);
  });

  it('requires both equipped location and attunement before applying a protective item, without double bonuses', () => {
    const doc = createPaperSheet();
    Object.assign(doc.fields, { dex: '16', ac: '=10 + [DEX]', 'save.wis': '7' });
    const cloak = item('protection', passive(modifier('ac', 1), modifier('saving_throw', 1)), { requires_attunement: true });
    carry(doc, cloak);
    expect(project(doc, cloak).values.ac).toBe(13);
    equip(doc, 'cloak', cloak);
    expect(project(doc, cloak).values.ac).toBe(13);
    attune(doc, cloak);
    const result = project(doc, cloak);
    expect(result.values).toMatchObject({ ac: 14, 'save.dex': 4, 'save.wis': 8 });
    expect(result.projection.sources?.ac).toContain(cloak.name);
    doc.fields['equipment.cloak'] = '';
    expect(project(doc, cloak).values).toMatchObject({ ac: 13, 'save.dex': 3, 'save.wis': 7 });
  });

  it('exposes unarmored AC when equipment changes Dexterity even if the original AC field is blank', () => {
    const doc = createPaperSheet(); doc.fields.dex = '12';
    const gloves = item('agility', passive({ kind: 'grant_ability_score', ability: 'dex', amount: 2 }));
    equip(doc, 'gloves', gloves);
    const result = project(doc, gloves);
    expect(result.values).toMatchObject({ dex: 14, dexMod: 2, ac: 12, initiative: 2 });
    expect(result.projection.sources?.ac).toContain(gloves.name);
    doc.fields['equipment.gloves'] = '';
    expect(project(doc, gloves).values.ac).toBeUndefined();
  });

  it('honours carried and attuned gates, zero quantities, and deduplicates repeated copies', () => {
    const doc = createPaperSheet(); doc.fields.speed = '25';
    const charm = item('traveller', { ...passive(modifier('speed', 5)), while: 'carried' });
    carry(doc, charm, '0');
    expect(project(doc, charm).values.speed).toBe(25);
    carry(doc, charm, '2'); carry(doc, charm, '1', 1); equip(doc, 'necklace', charm);
    expect(project(doc, charm).values.speed).toBe(30);
    const attuned = item('attuned-speed', { ...passive(modifier('speed', 7)), while: 'attuned' });
    carry(doc, attuned, '1', 2); attune(doc, attuned);
    expect(project(doc, charm, attuned).values.speed).toBe(37);
    doc.checks.attunement0 = false;
    expect(project(doc, charm, attuned).values.speed).toBe(30);
  });

  it.each(['active', 'reaction', 'triggered'])('does not execute %s item effects just by carrying or equipping them', mode => {
    const doc = createPaperSheet(); doc.fields.speed = '30';
    const capability = item(`capability-${mode}`, { ...passive(
      { kind: 'grant_ability_score', ability: 'str', amount: 4 }, modifier('speed', 20),
    ), activation: { mode, while: 'carried' } });
    carry(doc, capability); equip(doc, 'cloak', capability);
    expect(project(doc, capability).projection).toEqual({});
    expect(project(doc, capability).values).toMatchObject({ str: 10, speed: 30 });
  });

  it('selects the armor method and shield through canonical AC, restoring the manual base on removal', () => {
    const doc = createPaperSheet(); Object.assign(doc.fields, { dex: '18', ac: '13' });
    const medium = item('medium', passive(), { type: 'chest', slot: 'body', defense_type: 'medium', bonus_value: '14 + min(dex, 2)' });
    const heavy = item('heavy', passive(), { type: 'chest', slot: 'body', defense_type: 'heavy', bonus_value: '18' });
    const shield = item('shield', passive(), { type: 'shield', slot: 'one_hand', defense_type: 'shield', bonus_value: '+2' });
    equip(doc, 'body', medium); equip(doc, 'off_hand', shield);
    expect(project(doc, medium, shield).values.ac).toBe(18);
    equip(doc, 'body', heavy);
    expect(project(doc, heavy, shield).values.ac).toBe(20);
    doc.fields['equipment.body'] = '';
    expect(project(doc, heavy, shield).values.ac).toBe(15);
    doc.fields['equipment.off_hand'] = '';
    expect(project(doc, heavy, shield).values.ac).toBe(13);
  });

  it('uses shared nonadditive AC and speed algebra against the entered baseline', () => {
    const doc = createPaperSheet(); Object.assign(doc.fields, { ac: '9', speed: '25' });
    const ward = item('ward', passive(modifier('ac', 2, 'multiply')));
    const boots = item('boots', passive(modifier('speed', 2, 'multiply')));
    equip(doc, 'cloak', ward); equip(doc, 'boots', boots);
    expect(project(doc, ward, boots).values).toMatchObject({ ac: 18, speed: 50 });
  });

  it('applies walking-speed grants and the data-declared armor Strength requirement once', () => {
    const doc = createPaperSheet(); Object.assign(doc.fields, { str: '12', speed: '30' });
    const armor = item('chain', { ...passive(), armor_profile: {
      category: 'heavy', ac_formula: '16', strength_requirement: 13, stealth_disadvantage: true, training_required: true,
    } }, { type: 'chest', defense_type: 'heavy', bonus_value: '16' });
    const boots = item('walking', passive({ kind: 'grant_speed', mode: 'walk', amount: 5 }));
    equip(doc, 'body', armor); equip(doc, 'boots', boots);
    expect(project(doc, armor, boots).values.speed).toBe(25);
    doc.fields.str = '13';
    expect(project(doc, armor, boots).values.speed).toBe(35);
  });

  it('projects item-granted skill proficiency and expertise with the existing paper training intact', () => {
    const doc = createPaperSheet(); Object.assign(doc.fields, { wis: '14', level: '5' });
    doc.training.athletics = 1;
    const lens = item('lens', passive(
      { kind: 'grant_proficiency', prof: 'skill', value: 'perception' },
      { kind: 'grant_expertise', prof: 'skill', value: 'perception' },
    ));
    equip(doc, 'head', lens);
    expect(project(doc, lens).values).toMatchObject({ 'skill.perception': 8, passive: 18, 'skill.athletics': 3 });
    doc.training.perception = 1; // The same proficiency is already on the paper sheet.
    expect(project(doc, lens).values).toMatchObject({ 'skill.perception': 8, passive: 18 });
    doc.fields['equipment.head'] = '';
    expect(project(doc, lens).values).toMatchObject({ 'skill.perception': 5, passive: 15 });
  });

  it('keeps unknown HP/speed blank, preserves formula errors, and ignores unavailable cards', () => {
    const doc = createPaperSheet();
    const ring = item('life', passive(modifier('max_hp', 5), modifier('speed', 10)));
    equip(doc, 'ring_1', ring);
    expect(project(doc, ring).projection.fieldOverrides?.hpMax).toBeUndefined();
    expect(project(doc, ring).projection.fieldOverrides?.speed).toBeUndefined();
    Object.assign(doc.fields, { hpMax: '20', speed: '30' });
    expect(project(doc, ring).values).toMatchObject({ hpMax: 25, speed: 40 });
    expect(project(doc).values).toMatchObject({ hpMax: 20, speed: 30 });
    doc.fields.str = '=[str]';
    expect(project(doc, ring).projection).toEqual({});
    expect(project(doc, ring).errors.str).toContain('Циклическая');
  });
});
