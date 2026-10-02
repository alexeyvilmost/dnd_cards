import { describe, expect, it } from 'vitest';
import { createAssemblyRuntime } from '../character/assemblyFactory';
import { createRegistry } from '../engine/registry';
import { emptyDraft } from '../character/types';
import type { Action, Background, CharacterClass, Feat, PassiveEffect, Race } from '../types';
import { calculateSheet, createPaperSheet, exportPaperSheet, importPaperSheet } from './model';
import { editPaperIdentityText, PAPER_INLINE_LINEAGE_FIELD, paperIdentityDisplayName, paperIdentityDraft, paperIdentityEntries, paperIdentitySourceKey, projectPaperIdentityFeatures, selectPaperIdentity } from './identity';

const entity = (number: number, name: string) => ({ id: `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`, name, card_number: `fixture-${number}`, description: '', rarity: 'common' as const, created_at: '', updated_at: '' });
const baseSpecies: Race = { ...entity(1, 'Первый вид'), related_effects: [entity(10, '').id] };
const subSpecies: Race = { ...entity(2, 'Подвид'), is_subrace: true, parent_race_id: baseSpecies.id, related_actions: [entity(11, '').id] };
const firstClass: CharacterClass = { ...entity(3, 'Первый класс'), level_progression: { '1': { effects: [entity(12, '').id] }, '3': { effects: [entity(13, '').id] } } };
const secondClass: CharacterClass = { ...entity(4, 'Другой класс'), level_progression: { '2': { effects: [entity(14, '').id] } } };
const subClass: CharacterClass = { ...entity(5, 'Подкласс'), parent_class_id: firstClass.id, is_subclass: true, level_progression: { '3': { effects: [entity(15, '').id] } } };
const feat: Feat = { ...entity(6, 'Черта происхождения'), category: 'origin', repeatable: false, related_effects: [entity(16, '').id] };
const background: Background = { ...entity(7, 'Предыстория'), origin_feat: feat.card_number };
const effects: PassiveEffect[] = [10, 12, 13, 14, 15, 16].map(number => ({ ...entity(number, `Особенность ${number}`), effect_type: 'passive' }));
const action: Action = { ...entity(11, 'Действие подвида'), action_type: 'class_feature', resource: 'action' };

function assembler() {
  const find = <T extends { id: string; card_number: string }>(rows: T[], reference: string): T => {
    const result = rows.find(row => row.id === reference || row.card_number === reference);
    if (!result) throw new Error(`Missing fixture ${reference}`);
    return result;
  };
  return createAssemblyRuntime({
    racesApi: { getRace: async id => find([baseSpecies, subSpecies], id) },
    classesApi: { getClass: async id => find([firstClass, secondClass, subClass], id) },
    backgroundsApi: { getBackground: async () => background },
    featsApi: { getFeat: async () => feat },
    effectsApi: { getEffect: async id => find(effects, id), getEffects: async () => ({ effects, total: effects.length, page: 1, limit: 100 }) },
    actionsApi: { getAction: async () => action },
    spellsApi: { getSpell: async () => { throw new Error('Unexpected spell fetch'); } },
    resourcesApi: { getResource: async () => { throw new Error('Unexpected resource fetch'); } },
    variablesApi: { getVariables: async () => ({ variables: [], total: 0, page: 1, limit: 100 }) },
    entityRegistry: createRegistry({ resolveSpell: async () => null, resolveAction: async () => null, resolveEffect: async id => find(effects, id), resolveFeat: async () => feat }),
  });
}

describe('paper identity and canonical feature projection', () => {
  it.each(['Звёздное наследие', '00000000-0000-4000-8000-000000000099'])('preserves a marked inline lineage %s through reload and level changes, but never after manual detach', lineageId => {
    const doc = createPaperSheet();
    doc.identity = { speciesId: baseSpecies.id };
    Object.assign(doc.fields, { species: baseSpecies.name, subspecies: 'Название варианта', [PAPER_INLINE_LINEAGE_FIELD]: lineageId });
    doc.progression = { draft: { ...emptyDraft(), raceId: baseSpecies.id, lineageId }, baseline: { fields: { ...doc.fields } } };
    const restored = importPaperSheet(exportPaperSheet(doc));
    expect(paperIdentityDraft(restored)?.lineageId).toBe(lineageId);
    expect(paperIdentityDisplayName(restored, 'species')).toBe(`${baseSpecies.name} (Название варианта)`);
    restored.fields.level = '3';
    expect(paperIdentityDraft(restored)?.lineageId).toBe(lineageId);
    expect(paperIdentityDraft(editPaperIdentityText(restored, 'subspecies', restored.fields.subspecies))?.lineageId).toBeNull();
    expect(paperIdentityDraft(editPaperIdentityText(restored, 'species', restored.fields.species))?.lineageId).toBeNull();
    const changedRace = selectPaperIdentity(restored, { kind: 'species', id: 'another-race', name: 'Другой вид' });
    expect(paperIdentityDraft(changedRace)?.lineageId).toBeNull();
    const changedLabel = { ...restored, fields: { ...restored.fields, subspecies: 'Свой вариант' } };
    expect(paperIdentityDraft(changedLabel)?.lineageId).toBeNull();
    delete restored.fields[PAPER_INLINE_LINEAGE_FIELD];
    expect(paperIdentityDraft(restored)?.lineageId).toBeNull();
  });
  it('does not restore an unlinked catalogue subspecies from the retained full draft', () => {
    const doc = createPaperSheet(); doc.identity = { speciesId: baseSpecies.id, subspeciesId: subSpecies.id };
    doc.fields.subspecies = subSpecies.name;
    doc.progression = { draft: { ...emptyDraft(), raceId: baseSpecies.id, lineageId: subSpecies.id }, baseline: { fields: { ...doc.fields } } };
    expect(paperIdentityDraft(doc)?.lineageId).toBe(subSpecies.id);
    const detached = editPaperIdentityText(doc, 'subspecies', subSpecies.name);
    expect(paperIdentityDraft(importPaperSheet(exportPaperSheet(detached)))?.lineageId).toBeNull();
  });
  it('keeps the full build and multiclass allocation, overlays changed level on the primary class only', () => {
    const doc = createPaperSheet();
    doc.identity = { classId: firstClass.id, subclassId: subClass.id, speciesId: baseSpecies.id };
    doc.fields.level = '5'; doc.fields.str = '18';
    doc.progression = { draft: { ...emptyDraft(), id: 'source', classId: firstClass.id, level: 5,
      classLevels: { [firstClass.id]: 3, [secondClass.id]: 2 }, subclassId: subClass.id, subclassIds: { [firstClass.id]: subClass.id },
      raceId: baseSpecies.id, abilities: { str: 16 }, resolvedChoices: { 'build:choice': ['choice-a'] }, featIds: ['chosen-feat'], spellIds: ['chosen-spell'],
    }, baseline: { fields: { str: '18', level: '5' } } };
    const draft = paperIdentityDraft(doc)!;
    expect(draft.id).toBeUndefined();
    expect(draft.classLevels).toEqual({ [firstClass.id]: 3, [secondClass.id]: 2 });
    expect(draft.abilities.str).toBe(16);
    expect(draft.resolvedChoices).toEqual({ 'build:choice': ['choice-a'] });
    expect(draft.featIds).toEqual(['chosen-feat']);
    doc.fields.level = '6'; doc.fields.str = '=18+1';
    const changed = paperIdentityDraft(doc)!;
    expect(changed.classLevels).toEqual({ [firstClass.id]: 4, [secondClass.id]: 2 });
    expect(changed.abilities.str).toBe(17);
    expect(doc.fields.str).toBe('=18+1');
    expect(paperIdentityDraft(doc, calculateSheet(doc, { abilityScores: { str: 26 } }))!.abilities.str).toBe(17);
    doc.fields.level = '2';
    expect(paperIdentityDraft(doc)).toBeNull();
  });
  it('never restores manually detached identity IDs and invalidates a build snapshot for changed choices', () => {
    const doc = createPaperSheet(); doc.identity = { classId: firstClass.id, speciesId: baseSpecies.id };
    doc.progression = { draft: { ...emptyDraft(), classId: firstClass.id, classLevels: { [firstClass.id]: 1 }, raceId: baseSpecies.id, resolvedChoices: { selected: ['a'] } } };
    const initialKey = paperIdentitySourceKey(doc);
    const reordered = structuredClone(doc);
    reordered.progression!.draft = { ...doc.progression.draft, resolvedChoices: { selected: ['a'] } };
    expect(paperIdentitySourceKey(reordered)).toBe(initialKey);
    reordered.progression!.draft.resolvedChoices.selected = ['b'];
    expect(paperIdentitySourceKey(reordered)).not.toBe(initialKey);
    const detached = editPaperIdentityText(editPaperIdentityText(doc, 'class', 'Мой класс'), 'species', 'Мой вид');
    const draft = paperIdentityDraft(detached)!;
    expect(draft.classId).toBeNull(); expect(draft.raceId).toBeNull(); expect(draft.classLevels).toEqual({});
    expect(detached.progression?.draft.classId).toBe(firstClass.id);
  });
  it('keeps arbitrary text valid and detaches parent-dependent identities without modifying notes', () => {
    let doc = createPaperSheet();
    doc.sections.features = { text: 'Мои записи', fontSize: 13 };
    doc = selectPaperIdentity(doc, { kind: 'class', id: firstClass.id, name: firstClass.name });
    doc = selectPaperIdentity(doc, { kind: 'subclass', id: subClass.id, name: subClass.name, parentId: firstClass.id });
    const text = editPaperIdentityText(doc, 'class', 'Свой класс');
    expect(text.fields.class).toBe('Свой класс');
    expect(text.identity?.classId).toBeUndefined();
    expect(text.identity?.subclassId).toBeUndefined();
    expect(text.fields.subclass).toBe('');
    expect(text.sections).toBe(doc.sections);
    expect(doc.identity?.subclassId).toBe(subClass.id);
  });

  it('validates parent membership, clears only bound children, and preserves custom child text', () => {
    let doc = createPaperSheet();
    doc.fields.subclass = 'Мой подкласс';
    doc = selectPaperIdentity(doc, { kind: 'class', id: firstClass.id, name: firstClass.name });
    expect(doc.fields.subclass).toBe('Мой подкласс');
    expect(selectPaperIdentity(doc, { kind: 'subclass', id: subClass.id, name: subClass.name, parentId: secondClass.id })).toBe(doc);
    doc = selectPaperIdentity(doc, { kind: 'subclass', id: subClass.id, name: subClass.name, parentId: firstClass.id });
    doc = selectPaperIdentity(doc, { kind: 'class', id: secondClass.id, name: secondClass.name });
    expect(doc.identity?.subclassId).toBeUndefined();
    doc = selectPaperIdentity(doc, { kind: 'species', id: baseSpecies.id, name: baseSpecies.name });
    doc = selectPaperIdentity(doc, { kind: 'subspecies', id: subSpecies.id, name: subSpecies.name, parentId: baseSpecies.id });
    const changed = editPaperIdentityText(doc, 'species', 'Самописный вид');
    expect(changed.identity?.subspeciesId).toBeUndefined();
    expect(changed.fields.subspecies).toBe('');
  });

  it('takes level-gated species, subspecies, class and subclass features from loadAssembly and puts the origin feat in traits', async () => {
    const doc = createPaperSheet();
    doc.identity = { speciesId: baseSpecies.id, subspeciesId: subSpecies.id, classId: firstClass.id, subclassId: subClass.id, backgroundId: background.id };
    const runtime = assembler();
    const project = async () => projectPaperIdentityFeatures(await runtime.loadAssembly(paperIdentityDraft(doc)!), paperIdentitySourceKey(doc));
    const levelOne = await project();
    expect(levelOne.abilities.map(entry => entry.id)).toEqual([effects[0].id, effects[1].id, action.id]);
    expect(levelOne.traits).toEqual([{ type: 'feat', id: feat.id, name: feat.name }]);
    expect(levelOne.abilities.some(entry => entry.id === entity(16, '').id)).toBe(false);
    const completeBuild = projectPaperIdentityFeatures(await runtime.loadAssembly(paperIdentityDraft(doc)!), paperIdentitySourceKey(doc), true);
    expect(completeBuild.abilities.some(entry => entry.id === entity(16, '').id)).toBe(true);
    expect(completeBuild.traits).toEqual(levelOne.traits);
    doc.fields.level = '3';
    const levelThree = await project();
    expect(levelThree.abilities.map(entry => entry.id)).toEqual([entity(10, '').id, entity(12, '').id, entity(13, '').id, entity(15, '').id, action.id]);
    expect(await project()).toEqual(levelThree);
    const other = selectPaperIdentity(doc, { kind: 'class', id: secondClass.id, name: secondClass.name });
    const alternate = projectPaperIdentityFeatures(await runtime.loadAssembly(paperIdentityDraft(other)!), paperIdentitySourceKey(other));
    expect(alternate.abilities.map(entry => entry.id)).toEqual([entity(10, '').id, entity(14, '').id, action.id]);
  });

  it('retains portable snapshots and user notes but hides stale snapshots after a level change', () => {
    const doc = createPaperSheet();
    doc.identity = { classId: firstClass.id };
    doc.sections.features = { text: 'Личная запись', fontSize: 12 };
    doc.identityFeatures = { key: paperIdentitySourceKey(doc), abilities: [{ type: 'effect', id: effects[0].id, name: effects[0].name }], traits: [] };
    const restored = importPaperSheet(exportPaperSheet(doc));
    expect(paperIdentityEntries(restored, 'features')).toEqual(doc.identityFeatures.abilities);
    restored.fields.level = '=1+1';
    expect(paperIdentityEntries(restored, 'features', calculateSheet(restored))).toEqual([]);
    expect(restored.sections).toEqual(doc.sections);
    restored.fields.level = 'Ошибка';
    expect(paperIdentityDraft(restored)).toBeNull();
  });

  it('deduplicates explicit manual links by type and stable ID without changing notes or snapshots', () => {
    const doc = createPaperSheet(); doc.identity = { classId: firstClass.id };
    doc.identityFeatures = { key: paperIdentitySourceKey(doc), abilities: [
      { type: 'effect', id: 'shared', name: 'Имя из каталога' },
      { type: 'action', id: 'shared', name: 'Другое действие' },
    ], traits: [{ type: 'feat', id: 'origin', name: 'Черта из каталога' }] };
    doc.sections.features = { text: 'Мой текст [[Своё имя|effect:shared]]', fontSize: 12 };
    doc.sections.traits = { text: '[[Собственная подпись|feat:origin]]', fontSize: 12 };
    expect(paperIdentityEntries(doc, 'features').map(entry => entry.type)).toEqual(['action']);
    expect(paperIdentityEntries(doc, 'traits')).toEqual([]);
    expect(doc.identityFeatures.abilities).toHaveLength(2);
    expect(doc.sections.features.text).toBe('Мой текст [[Своё имя|effect:shared]]');
  });
});
