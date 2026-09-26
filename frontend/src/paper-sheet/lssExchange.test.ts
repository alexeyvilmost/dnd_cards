import { describe, expect, it } from 'vitest';
import wizard from './fixtures/lss-wizard-2024.json';
import cleric from './fixtures/lss-cleric-2014.json';
import grimoire from './fixtures/lss-grimoire.json';
import customWizard from './fixtures/lss-custom-spell-2024.json';
import { attachLssSpells, exportLssSheet, importSheetJSON, lssText, paperExtraSections, paperLssSpells, parseExchangeJSON } from './lssExchange';
import { calculateSheet, createPaperSheet, exportPaperSheet, importPaperSheet } from './model';
import { printSections, wrapPrintText } from './print';

describe('real Long Story Short exports', () => {
  it('parses valid exchange JSON larger than the old 10 MB quota', () => {
    const imported = parseExchangeJSON(JSON.stringify({ text: 'A'.repeat(10_500_000) }));
    expect(imported.text).toHaveLength(10_500_000);
  });
  it('round-trips hidden blocks through LSS without clearing their text or unknown layout keys', () => {
    const source = structuredClone(wizard) as any;
    const data = JSON.parse(source.data);
    data.text.features = { value: { data: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Скрытая способность' }] }] } } };
    source.data = JSON.stringify(data);
    source.disabledBlocks['info-right'] = ['foreign-block'];
    const doc = importSheetJSON(JSON.stringify(source)).document;
    doc.hiddenBlocks = ['features', 'notes1', 'spell-slots'];
    const exported = JSON.parse(exportLssSheet(importPaperSheet(exportPaperSheet(doc))));
    expect(exported.disabledBlocks['info-right']).toContain('features');
    expect(exported.disabledBlocks['info-right']).toContain('foreign-block');
    expect(exported.disabledBlocks['notes-left']).toContain('notes-1');
    expect(exported.bohHiddenBlocks).toContain('spell-slots');
    expect(JSON.parse(exported.data).text.features).toEqual(data.text.features);
    const imported = importSheetJSON(JSON.stringify(exported)).document;
    expect(imported.hiddenBlocks).toEqual(['features', 'notes1', 'spell-slots']);
    expect(imported.sections.features.text).toBe('Скрытая способность');
    expect(JSON.parse(exportLssSheet(imported)).disabledBlocks['info-right']).toContain('foreign-block');
  });
  it('imports LSS visibility without removing the hidden block content', () => {
    const source = structuredClone(wizard) as any;
    const data = JSON.parse(source.data);
    data.text.features = { value: { data: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Содержимое из LSS' }] }] } } };
    source.data = JSON.stringify(data);
    source.disabledBlocks['info-right'] = ['features'];
    const doc = importSheetJSON(JSON.stringify(source)).document;
    expect(doc.hiddenBlocks).toContain('features');
    expect(doc.sections.features.text).toBe('Содержимое из LSS');
    expect(JSON.parse(exportLssSheet(doc)).disabledBlocks['info-right']).toContain('features');
  });
  it.each([wizard, cleric, customWizard])('preserves the complete original on an unchanged round trip: $sheetEdition', fixture => {
    const imported = importSheetJSON(JSON.stringify(fixture));
    const persisted = importPaperSheet(exportPaperSheet(imported.document));
    expect(JSON.parse(exportLssSheet(persisted))).toEqual(fixture);
  });
  it('imports real weapon formulas, abilities, prepared spell IDs and slots', () => {
    const { document: doc, warnings } = importSheetJSON(JSON.stringify(wizard));
    expect(doc.fields).toMatchObject({ name: 'BOH QA — Волшебник 2024', int: '16', hpCurrent: '15', hpMax: '20', spellAbility: 'int', slot1Max: '4', slot2Max: '2', 'weapon.0.name': 'Посох QA', 'weapon.0.damage': '1d6+[STR] дробящий' });
    expect(calculateSheet(doc).values).toMatchObject({ spellAttack: 5, spellDC: 13, 'weapon.0.bonus': 2 });
    expect(warnings.join(' ')).toContain('ID');
  });
  it('preserves zero HP, textual spells, quantities and Cyrillic equipment', () => {
    const { document: doc } = importSheetJSON(JSON.stringify(cleric));
    expect(doc.fields.hpCurrent).toBeUndefined(); // LSS omits the untouched current-HP field.
    expect(doc.sections.equipment.text).toContain('Зелье лечения — 3');
    expect(Object.values(doc.fields).join('\n')).toContain('Возрождение');
    expect(doc.fields.slot3Max).toBe('2');
  });
  it('edits known fields without rebuilding rich text, IDs, bonuses or unknown extensions', () => {
    const source = structuredClone(wizard) as any;
    const data = JSON.parse(source.data);
    data.unknown = { custom: [1, 2, '🌙'] }; data.bonuses = [{ target: 'ac', value: '1' }];
    data.resources = { r1: { name: 'Заряды', current: 0, max: 3 } };
    source.data = JSON.stringify(data);
    const { document: doc } = importSheetJSON(JSON.stringify(source));
    doc.fields.name += ' — обратно'; doc.fields.hpCurrent = '0'; doc.fields['coinGp'] = '12';
    const result = JSON.parse(exportLssSheet(doc)); const actual = JSON.parse(result.data);
    expect(actual.name.value).toContain('обратно'); expect(actual.vitality['hp-current'].value).toBe(0);
    expect(actual.coins.gp.value).toBe(12);
    expect(actual.unknown).toEqual(data.unknown); expect(actual.bonuses).toEqual(data.bonuses);
    expect(actual.resources).toEqual(data.resources); expect(actual.weaponsList).toEqual(data.weaponsList);
    expect(result.spells).toEqual(source.spells);
    expect(paperExtraSections(doc)).toContainEqual({ title: 'Заряды', text: '0 / 3\n' });
  });
  it('attaches exported custom spells by ID, retains content and never overwrites edited fields', () => {
    const source = structuredClone(customWizard);
    let doc = importSheetJSON(JSON.stringify(source)).document;
    const index = Object.keys(doc.fields).find(k => doc.fields[k] === grimoire[0]._id)!.match(/\d+/)![0];
    doc.fields[`spellRow${index}Notes`] = 'Моя заметка';
    doc = attachLssSpells(doc, JSON.stringify(grimoire));
    expect(doc.fields[`spellRow${index}Name`]).toBe('BOH QA — Светлячок');
    expect(doc.fields[`spellRow${index}Notes`]).toBe('Моя заметка');
    expect(paperLssSpells(doc)[0].description).toContain('<угловых скобок>');
    expect(paperLssSpells(doc)[0].school).toBe('evocation');
    const persisted = importPaperSheet(exportPaperSheet(doc));
    expect(paperLssSpells(persisted)).toEqual(paperLssSpells(doc));
    expect(JSON.parse(exportLssSheet(persisted)).spells).toEqual(source.spells);
    expect(paperExtraSections(doc).map(s => s.text).join('\n')).toContain('1d4 + @mod');
  });
  it('exports new native equipment and spells as readable LSS text with flags', () => {
    const doc = createPaperSheet();
    Object.assign(doc.fields, { name: 'BOH QA — Новый', class: 'Жрец', spellAbility: 'wis', wis: '16', hpMax: '10', 'inventory.0.item': '[[Зелье|card:11111111-1111-4111-8111-111111111111]]', 'inventory.0.quantity': '20', spellRow0Name: 'Благословение', spellRow0Level: '1', spellRow0Time: 'Действие', spellRow0Range: '30 фт', 'weapon.0.name': 'Булава', 'weapon.0.damage': '1d6 + 2 дробящий' });
    doc.checks.spellRow0Concentration = true;
    const result = JSON.parse(exportLssSheet(doc)); const data = JSON.parse(result.data);
    expect(result.spells.mode).toBe('text');
    expect(lssText(data.text.equipment.value.data)).toContain('Зелье × 20');
    expect(lssText(data.text['spells-level-1'].value.data)).toContain('концентрация');
    expect(data.weaponsList[0].dmg.value).toBe('1d6 + 2'); expect(data.weaponsList[0].dmgType.value).toBe('дробящий');
    expect(importSheetJSON(JSON.stringify(result)).document.fields.spellAbility).toBe('wis');
  });
  it('supports old raw data and UTF-8 BOM exports', () => {
    const data = { ...JSON.parse(cleric.data), jsonType: 'character' }; data.vitality['hp-current'] = { value: 0 };
    expect(importSheetJSON('\uFEFF' + JSON.stringify(data)).document.fields.hpCurrent).toBe('0');
    const native = createPaperSheet(); native.fields.name = 'Старый';
    expect(importSheetJSON('\uFEFF' + exportPaperSheet(native)).document).toEqual(native);
  });
  it('exports the authoritative equipment projection, without losing passive bonuses', () => {
    const doc = createPaperSheet(); doc.fields.ac = '10';
    const calculation = calculateSheet(doc, { abilityScores: { str: 19 }, fieldOverrides: { ac: 18, 'save.wis': 3, 'skill.stealth': 4 } });
    const data = JSON.parse(JSON.parse(exportLssSheet(doc, calculation)).data);
    expect(data.stats.str.score).toBe(19);
    expect(data.vitality.ac.value).toBe('18');
    expect(data.saves.wis.customModifier).toBe(3);
    expect(data.skills.stealth.customModifier).toBe(4);
    expect(doc.fields.str).toBe('10');
  });
  it('rejects unsupported/malformed files before replacing the current document', () => {
    for (const text of ['{}', '[]', '{', '{"jsonType":"character","version":"3","data":{}}', '{"__proto__":{"polluted":true}}']) expect(() => importSheetJSON(text)).toThrow();
    expect(() => parseExchangeJSON('['.repeat(62) + '0' + ']'.repeat(62))).toThrow();
    expect(() => attachLssSpells(importSheetJSON(JSON.stringify(wizard)).document, '{}')).toThrow();
  });
  it('removes an explicitly cleared prepared spell without deleting its book entry', () => {
    const source = structuredClone(wizard) as any;
    source.spells.book = [...source.spells.prepared];
    const doc = importSheetJSON(JSON.stringify(source)).document;
    const removed = doc.fields.spellRow0LssId; doc.fields.spellRow0Name = '';
    const result = JSON.parse(exportLssSheet(doc));
    expect(result.spells.prepared).not.toContain(removed); expect(result.spells.book).toContain(removed);
  });
});

describe('paper output continuations', () => {
  it('wraps long words, Cyrillic, empty lines and emoji without data loss', () => {
    const original = 'Очень длинный текст🌙'.repeat(50);
    const lines = wrapPrintText(original, s => s.length <= 40);
    expect(lines.join('')).toBe(original); expect(lines.every(s => s.length <= 40)).toBe(true);
    expect(wrapPrintText('a\n\nb', () => true)).toEqual(['a', '', 'b']);
  });
  it('includes old hidden notes, overflow inventory quantities and spell components', () => {
    const doc = createPaperSheet(); doc.sections.goals = { text: 'Не потерять', fontSize: 12 };
    Object.assign(doc.fields, { 'inventory.79.item': 'Стрела', 'inventory.79.quantity': '200', spellRow60Name: 'Благословение' }); doc.spellRows = 61; doc.checks.spellRow60Concentration = true;
    const sections = printSections(doc, ['inventory', 'spells']);
    expect(sections.map(s => s.text).join('\n')).toContain('Стрела × 200');
    expect(sections.map(s => s.text).join('\n')).toContain('Благословение · концентрация');
    expect(sections.map(s => s.text)).toContain('Не потерять');
  });
});
