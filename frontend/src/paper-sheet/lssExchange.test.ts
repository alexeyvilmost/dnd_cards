import { describe, expect, it } from 'vitest';
import wizard from './fixtures/lss-wizard-2024.json';
import cleric from './fixtures/lss-cleric-2014.json';
import grimoire from './fixtures/lss-grimoire.json';
import customWizard from './fixtures/lss-custom-spell-2024.json';
import { attachLssSpells, exportLssSheet, importSheetJSON, lssText, paperExtraSections, paperLssSpells, parseExchangeJSON } from './lssExchange';
import { calculateSheet, createPaperSheet, exportPaperSheet, importPaperSheet } from './model';
import { printSections, wrapPrintText } from './print';
import { PAPER_INLINE_LINEAGE_FIELD, paperIdentityDraft, paperIdentityEntries, paperIdentitySourceKey } from './identity';
import { emptyDraft } from '../character/types';

describe('real Long Story Short exports', () => {
  function progressionSheet() {
    const doc = createPaperSheet();
    Object.assign(doc.fields, { name: 'Кузница', class: 'Воин', species: 'Вид', subspecies: 'Подвид', level: '5', str: '18' });
    doc.identity = { classId: 'fighter', speciesId: 'species', subspeciesId: 'subspecies' };
    doc.progression = { draft: { ...emptyDraft(), name: 'Кузница', classId: 'fighter', raceId: 'species', lineageId: 'subspecies', level: 5,
      classLevels: { fighter: 3, wizard: 2 }, abilities: { str: 16, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
      resolvedChoices: { 'feature:choice:2': ['spell-choice'] }, featIds: ['chosen-feat'], spellIds: ['chosen-spell'],
    }, baseline: { fields: { str: '18', level: '5' } } };
    doc.sections.features = { text: 'Моя запись', fontSize: 14 };
    doc.identityFeatures = { key: paperIdentitySourceKey(doc), abilities: [{ type: 'effect', id: 'ability', name: 'Особенность' }], traits: [{ type: 'feat', id: 'chosen-feat', name: 'Выбранная черта' }] };
    return doc;
  }
  it('round-trips full forge choices and generated provenance through LSS without duplicating features', () => {
    const doc = progressionSheet();
    const exported = JSON.parse(exportLssSheet(doc));
    expect(exported.bohProgression.version).toBe(1);
    const imported = importSheetJSON(JSON.stringify(exported)).document;
    expect(imported.progression).toEqual(doc.progression);
    expect(imported.identity).toEqual(doc.identity);
    expect(imported.fields.subspecies).toBe('Подвид');
    expect(imported.sections.features).toEqual(doc.sections.features);
    expect(imported.sections.traits).toBeUndefined();
    expect(paperIdentityDraft(imported)?.classLevels).toEqual({ fighter: 3, wizard: 2 });
    expect(paperIdentityDraft(imported)?.abilities.str).toBe(16);
    expect(paperIdentityEntries(imported, 'features')).toEqual(doc.identityFeatures?.abilities);
    const again = JSON.parse(exportLssSheet(imported));
    expect(lssText(JSON.parse(again.data).text.features.value.data)).toBe('**Особенность**\nМоя запись\n');
    expect(JSON.parse(exportLssSheet(createPaperSheet())).bohProgression).toBeUndefined();
  });
  it('retains LSS edits while detaching changed identity and restoring unchanged generated references', () => {
    const source = JSON.parse(exportLssSheet(progressionSheet()));
    const data = JSON.parse(source.data);
    data.info.charClass.value = 'Самописный класс';
    data.text.features.value.data.content.push({ type: 'paragraph', content: [{ type: 'text', text: 'Добавлено в LSS' }] });
    source.data = JSON.stringify(data);
    const imported = importSheetJSON(JSON.stringify(source)).document;
    expect(imported.fields.class).toBe('Самописный класс');
    expect(imported.identity?.classId).toBeUndefined();
    expect(paperIdentityDraft(imported)?.classId).toBeNull();
    expect(imported.progression?.draft.classId).toBe('fighter');
    expect(imported.sections.features.text).toBe('[[Особенность|effect:ability]]\nМоя запись\nДобавлено в LSS');
  });
  it('rejects malformed forge metadata in LSS using the native draft validator', () => {
    const source = JSON.parse(exportLssSheet(progressionSheet()));
    source.bohProgression.progression.draft.resolvedChoices = { choice: [123] };
    expect(() => importSheetJSON(JSON.stringify(source))).toThrow();
  });
  it('keeps paper base formulas across an effective-stat LSS export, but accepts external numeric edits', () => {
    const doc = progressionSheet(); doc.fields.str = '=18+1'; doc.fields.level = '=4+1';
    const source = JSON.parse(exportLssSheet(doc, calculateSheet(doc, { abilityScores: { str: 26 } })));
    const data = JSON.parse(source.data);
    expect(data.stats.str.score).toBe(26);
    const restored = importSheetJSON(JSON.stringify(source)).document;
    expect(restored.fields.str).toBe('=18+1');
    expect(restored.fields.level).toBe('=4+1');
    expect(paperIdentityDraft(restored)?.abilities.str).toBe(17);
    data.stats.str.score = 20; source.data = JSON.stringify(data);
    const externallyEdited = importSheetJSON(JSON.stringify(source)).document;
    expect(externallyEdited.fields.str).toBe('20');
    expect(paperIdentityDraft(externallyEdited)?.abilities.str).toBe(18);
  });
  it.each(['Лунная линия', '00000000-0000-4000-8000-000000000099'])('round-trips inline lineage provenance %s through LSS without reattaching a changed species', lineageId => {
    const doc = progressionSheet(); delete doc.identity!.subspeciesId;
    doc.fields.subspecies = 'Подпись варианта'; doc.fields[PAPER_INLINE_LINEAGE_FIELD] = lineageId;
    doc.progression!.draft.lineageId = lineageId;
    Object.assign(doc.progression!.baseline!.fields!, { subspecies: doc.fields.subspecies, [PAPER_INLINE_LINEAGE_FIELD]: lineageId });
    const source = JSON.parse(exportLssSheet(doc));
    const restored = importSheetJSON(JSON.stringify(source)).document;
    expect(restored.fields.subspecies).toBe('Подпись варианта');
    expect(restored.fields[PAPER_INLINE_LINEAGE_FIELD]).toBe(lineageId);
    expect(paperIdentityDraft(restored)?.lineageId).toBe(lineageId);
    const data = JSON.parse(source.data); data.info.race.value = 'Самописный вид'; source.data = JSON.stringify(data);
    const changed = importSheetJSON(JSON.stringify(source)).document;
    expect(paperIdentityDraft(changed)?.lineageId).toBeNull();
    expect(changed.fields[PAPER_INLINE_LINEAGE_FIELD]).toBeUndefined();
  });
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
    const exported = exportLssSheet(persisted);
    expect(JSON.parse(exported).spells).toEqual(source.spells);
    expect(importSheetJSON(exported).document.fields[`spellRow${index}Notes`]).toBe('Моя заметка');
    expect(paperExtraSections(doc).map(s => s.text).join('\n')).toContain('1d4 + @mod');
  });
  it('round-trips foreign spell table annotations by original ID without duplicate prepared spells or notes', () => {
    const source = structuredClone(customWizard) as any;
    const data = JSON.parse(source.data);
    const manualContent = [{ type: 'paragraph', content: [{ type: 'text', text: 'Моя исходная заметка', marks: [{ type: 'bold' }] }] }, { type: 'resource', attrs: { id: 'foreign-resource', current: 2, max: 5 } }];
    data.text['notes-6'] = { customLabel: 'Личные записи', value: { data: { type: 'doc', content: manualContent } } };
    source.data = JSON.stringify(data);
    const originalSource = JSON.stringify(source);
    const doc = attachLssSpells(importSheetJSON(originalSource).document, JSON.stringify(grimoire));
    const customId = grimoire[0]._id;
    const unknownId = source.spells.prepared.find((id: string) => id !== customId);
    const row = (id: string) => Object.keys(doc.fields).find(key => key.endsWith('LssId') && doc.fields[key] === id)!.replace('LssId', '');
    const customRow = row(customId);
    const unknownRow = row(unknownId);
    Object.assign(doc.fields, { [`${customRow}Time`]: 'Реакция', [`${customRow}Range`]: '45 футов', [`${customRow}Notes`]: 'Моя заметка\nНе потерять вторую строку', [`${unknownRow}Name`]: 'Неизвестное LSS заклинание', [`${unknownRow}Level`]: '7', [`${unknownRow}Time`]: '10 минут', [`${unknownRow}Range`]: 'На себя', [`${unknownRow}Notes`]: 'Вторая сущность' });
    Object.assign(doc.checks, { [`${customRow}Concentration`]: true, [`${customRow}Ritual`]: false, [`${customRow}Material`]: true, [`${unknownRow}Concentration`]: false, [`${unknownRow}Ritual`]: true, [`${unknownRow}Material`]: false });
    const originalDoc = exportPaperSheet(doc);
    const exported = JSON.parse(exportLssSheet(doc));
    const exportedNotes = JSON.parse(exported.data).text['notes-6'];
    expect(exportedNotes.value.data.content.slice(0, manualContent.length)).toEqual(manualContent);
    expect(exportedNotes.customLabel).toBe('Личные записи');
    expect(lssText(exportedNotes.value.data)).toContain('Реакция; 45 футов; Моя заметка\nНе потерять вторую строку');
    expect(lssText(exportedNotes.value.data)).toContain('Ур. 7 — Неизвестное LSS заклинание — 10 минут; На себя; Вторая сущность — ритуал');
    const reimported = importSheetJSON(JSON.stringify(exported)).document;
    for (const prefix of [customRow, unknownRow]) {
      for (const field of ['Name', 'Level', 'Time', 'Range', 'Notes', 'LssId']) expect(reimported.fields[`${prefix}${field}`]).toBe(doc.fields[`${prefix}${field}`] || '');
      for (const field of ['Concentration', 'Ritual', 'Material']) expect(reimported.checks[`${prefix}${field}`]).toBe(doc.checks[`${prefix}${field}`]);
    }
    const reattached = attachLssSpells(reimported, JSON.stringify(grimoire));
    for (const field of ['Name', 'Time', 'Range', 'Notes']) expect(reattached.fields[`${customRow}${field}`]).toBe(doc.fields[`${customRow}${field}`]);
    for (const field of ['Concentration', 'Ritual', 'Material']) expect(reattached.checks[`${customRow}${field}`]).toBe(doc.checks[`${customRow}${field}`]);
    // An untouched placeholder and absent flags can still be resolved by a later grimoire.
    const blankId = source.spells.prepared.find((id: string) => id !== customId && id !== unknownId);
    const blankRow = row(blankId);
    const definition = structuredClone(grimoire[0]) as any;
    definition._id = blankId; definition.name = 'Другое заклинание';
    definition.system.properties = ['concentration', 'ritual', 'material'];
    const hydrated = attachLssSpells(reimported, JSON.stringify([definition]));
    expect(hydrated.fields[`${blankRow}Name`]).toBe('Другое заклинание');
    expect(hydrated.fields[`${blankRow}Time`]).toBe('1 бонусное действие');
    expect(hydrated.fields[`${blankRow}Range`]).toBe('видимость');
    for (const field of ['Concentration', 'Ritual', 'Material']) expect(hydrated.checks[`${blankRow}${field}`]).toBe(true);
    expect(reimported.sections.notes6.text).not.toContain('Заклинания LSS — заметки Bag of Holding');
    // Exercise a real second export, not just the unchanged-source fast path.
    reimported.fields.name += ' — снова';
    const repeated = JSON.parse(exportLssSheet(reimported));
    expect(JSON.parse(repeated.data).text['notes-6']).toEqual(exportedNotes);
    expect(repeated.spells).toEqual(source.spells);
    expect(Object.keys(importSheetJSON(JSON.stringify(repeated)).document.fields).filter(key => key.endsWith('LssId'))).toHaveLength(new Set([...source.spells.prepared, ...source.spells.granted.map((spell: any) => spell.id)]).size);
    expect(JSON.stringify(source)).toBe(originalSource);
    expect(exportPaperSheet(doc)).toBe(originalDoc);
  });
  it('retains a managed spell suffix edited in LSS as manual content on later exports', () => {
    const doc = importSheetJSON(JSON.stringify(wizard)).document;
    doc.fields.spellRow0Notes = 'Подготовить перед боем';
    const first = JSON.parse(exportLssSheet(doc));
    const data = JSON.parse(first.data);
    const content = data.text['notes-6'].value.data.content;
    content[content.length - 1] = { type: 'paragraph', content: [{ type: 'text', text: 'Ручная правка в LSS — оставить', marks: [{ type: 'italic' }] }] };
    const editedContent = structuredClone(content);
    first.data = JSON.stringify(data);
    const imported = importSheetJSON(JSON.stringify(first)).document;
    expect(imported.sections.notes6.text).toContain('_Ручная правка в LSS — оставить_');
    imported.fields.spellRow0Notes = 'Обновлённое время';
    const next = JSON.parse(exportLssSheet(imported));
    const nextContent = JSON.parse(next.data).text['notes-6'].value.data.content;
    expect(nextContent.slice(0, editedContent.length)).toEqual(editedContent);
    expect(lssText({ content: nextContent })).toContain('Обновлённое время');
    const finalDoc = importSheetJSON(JSON.stringify(next)).document;
    expect(finalDoc.sections.notes6.text).toBe(imported.sections.notes6.text);
    finalDoc.fields.name += ' — другой экспорт';
    expect(JSON.parse(JSON.parse(exportLssSheet(finalDoc)).data).text['notes-6'].value.data.content).toEqual(nextContent);
  });
  it('restores only whitelisted spell columns for IDs already present in the foreign spell list', () => {
    const source = structuredClone(wizard) as any;
    const id = source.spells.prepared[0];
    const data = JSON.parse(source.data);
    data.text['spells-level-2'] = { value: { data: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Текстовая строка — 30 футов' }] }] } } };
    source.data = JSON.stringify(data);
    source.bohSpellRows = { version: 1, rows: [
      { lssId: id, fields: { Name: 'Переименовано', Notes: 'Сохранено', Time: { invalid: true }, LssId: 'replacement', hpCurrent: '0' }, checks: { Ritual: true, Material: 'yes', inspiration: true } },
      { lssId: 'not-prepared', fields: { Name: 'Не добавлять' }, checks: {} },
    ] };
    const doc = importSheetJSON(JSON.stringify(source)).document;
    expect(doc.fields.spellRow0Name).toBe('Текстовая строка — 30 футов');
    expect(doc.fields.spellRow0LssId).toBeUndefined();
    expect(doc.fields.spellRow1LssId).toBe(id);
    expect(doc.fields.spellRow1Name).toBe('Переименовано');
    expect(doc.fields.spellRow1Notes).toBe('Сохранено');
    expect(doc.fields.spellRow1Time).toBeUndefined();
    expect(doc.fields.spellRow1hpCurrent).toBeUndefined();
    expect(doc.checks.spellRow1Ritual).toBe(true);
    expect(doc.checks.spellRow1Material).toBeUndefined();
    expect(doc.checks.spellRow1inspiration).toBeUndefined();
    expect(Object.values(doc.fields)).not.toContain('Не добавлять');
    expect(JSON.parse(exportLssSheet(doc))).toEqual(source);
  });
  it('preserves explicit empty spell fields and false flags while leaving absent values available for grimoire hydration', () => {
    const doc = importSheetJSON(JSON.stringify(wizard)).document;
    // Even absent -> empty alone is an intentional annotation that must survive exchange.
    doc.fields.spellRow0Time = '';
    const first = JSON.parse(exportLssSheet(doc));
    expect(first.bohSpellRows.rows[0].fields).toHaveProperty('Time', '');
    expect(first.bohSpellRows.rows[0].fields).not.toHaveProperty('Range');
    expect(first.bohSpellRows.rows[0].checks).toEqual({});
    doc.fields.spellRow0Range = ''; doc.fields.spellRow0Notes = '';
    Object.assign(doc.checks, { spellRow0Concentration: false, spellRow0Ritual: false, spellRow0Material: false });
    const imported = importSheetJSON(exportLssSheet(doc)).document;
    const definitions = [doc.fields.spellRow0LssId, doc.fields.spellRow1LssId].map((_id, index) => ({ ...grimoire[0], _id, name: `Запись ${index + 1}`, system: { ...grimoire[0].system, properties: ['concentration', 'ritual', 'material'] } }));
    const attached = attachLssSpells(imported, JSON.stringify(definitions));
    for (const key of ['Time', 'Range', 'Notes']) expect(attached.fields[`spellRow0${key}`]).toBe('');
    for (const key of ['Concentration', 'Ritual', 'Material']) expect(attached.checks[`spellRow0${key}`]).toBe(false);
    expect(attached.fields.spellRow0Name).toBe('Запись 1');
    expect(attached.fields.spellRow1Time).toBe('1 бонусное действие');
    expect(attached.fields.spellRow1Range).toBe('видимость');
    expect(attached.fields.spellRow1Notes).toBe('мгновенно');
    for (const key of ['Concentration', 'Ritual', 'Material']) expect(attached.checks[`spellRow1${key}`]).toBe(true);
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
  it('exports all library types and generated origin features, preserving text marks and native metadata', () => {
    const doc = createPaperSheet();
    doc.identity = { classId: 'class-one', backgroundId: 'background-one' };
    doc.identityFeatures = { key: paperIdentitySourceKey(doc), abilities: [{ type: 'action', id: 'action-one', name: 'Действие класса' }, { type: 'effect', id: 'effect-one', name: 'Особенность вида' }], traits: [{ type: 'feat', id: 'feat-one', name: 'Черта предыстории' }] };
    doc.sections.features = { text: 'Моя **жирная** _курсивная_ __подчёркнутая__ ~~зачёркнутая~~ заметка\n[[Предмет|card:item-one]] [[Заклинание|spell:spell-one]] [[Ручная черта|feat:feat-two]]', fontSize: 11 };
    const original = exportPaperSheet(doc);
    const native = importSheetJSON(original).document;
    expect(native).toEqual(doc);
    const exported = JSON.parse(exportLssSheet(native));
    const data = JSON.parse(exported.data);
    const text = lssText(data.text.features.value.data);
    for (const label of ['Действие класса', 'Особенность вида', 'Предмет', 'Заклинание', 'Ручная черта', '__подчёркнутая__', '**жирная**', '_курсивная_', '~~зачёркнутая~~']) expect(text).toContain(label);
    expect(text).not.toMatch(/\[\[|(?:card|spell|action|effect|feat):/);
    expect(lssText(data.text.feats.value.data)).toContain('Черта предыстории');
    expect(importSheetJSON(JSON.stringify(exported)).document.sections.features.text).toContain('__подчёркнутая__');
    expect(exportPaperSheet(doc)).toBe(original);
  });
  it('exports generated sections without manual notes and excludes snapshots for a previous level', () => {
    const doc = createPaperSheet();
    doc.identity = { speciesId: 'species-one' };
    doc.identityFeatures = { key: paperIdentitySourceKey(doc), abilities: [{ type: 'effect', id: 'feature-one', name: 'Ночное зрение' }], traits: [] };
    expect(lssText(JSON.parse(JSON.parse(exportLssSheet(doc)).data).text.features.value.data)).toContain('Ночное зрение');
    doc.fields.level = '2';
    expect(lssText(JSON.parse(JSON.parse(exportLssSheet(doc)).data).text.features.value.data)).not.toContain('Ночное зрение');
  });
  it.each([['italic', 'underline'], ['underline', 'italic']])('round-trips combined %s/%s marks as italic underlined text', (first, second) => {
    const combined = lssText({ type: 'text', text: 'Совместно', marks: [{ type: first }, { type: second }] });
    expect(combined).toBe('___Совместно___');
    const doc = createPaperSheet();
    doc.sections.features = { text: `${combined} и __Только подчёркнуто__`, fontSize: 12 };
    const exported = exportLssSheet(doc);
    const content = JSON.parse(JSON.parse(exported).data).text.features.value.data.content[0].content;
    expect(content.find((node: any) => node.text === 'Совместно').marks).toEqual(expect.arrayContaining([{ type: 'italic' }, { type: 'underline' }]));
    expect(content.find((node: any) => node.text === 'Только подчёркнуто').marks).toEqual([{ type: 'underline' }]);
    expect(importSheetJSON(exported).document.sections.features.text).toBe(doc.sections.features.text);
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
