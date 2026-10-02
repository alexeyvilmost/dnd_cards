import { afterEach, describe, expect, it, vi } from 'vitest';
import { cardsApi, effectsApi } from '../api/client';
import { assemble } from '../character/assemble';
import { buildSavePayload } from '../character/forgeHelpers';
import { resolveCharacterRules } from '../character/rules/resolveCharacterRules';
import { runtimeSeedFromSavePayload } from '../character/saveCharacter';
import { writeSheetSpellPreparation } from '../character/sheetSpellPreparation';
import { emptyDraft } from '../character/types';
import type { Card, CharacterClass, PassiveEffect, Race, Spell } from '../types';
import { characterToPaperSheet, exportInteractiveCharacterToPaper, forgeCharacterToPaper, mergePaperProgression, paperProgressionBaseline } from './characterConversion';
import { calculateSheet, createPaperSheet, exportPaperSheet, importPaperSheet, type PaperSheetDocument } from './model';
import { loadPaperEquipmentEffects, projectPaperEquipment } from './equipmentEffects';
import { paperEntityToken } from './references';
import * as identityLoader from './loadPaperIdentityAssembly';

const passive = (...result: Record<string, unknown>[]) => ({ activation: { mode: 'passive' }, effects: [{ resolution: 'auto', result }] });
const token = (id: string, type: 'card' | 'spell' | 'effect' = 'card') => paperEntityToken({ id, type, name: id });
const spell = (id: string, level = 1): Spell => ({ id, card_number: `SPELL-${id}`, name: id, level, casting_time: 'Действие', range: '60 футов', duration: '1 минута', concentration: true, ritual: false, component_material: true, material_text: 'кристалл' } as Spell);

function build(caster = false, level = 3) {
  const klass = { id: caster ? 'second-class' : 'first-class', name: caster ? 'Второй класс' : 'Первый класс', card_number: caster ? 'CLASS-wizard' : 'CLASS-fighter', hit_die: caster ? 'd6' : 'd10', saving_throws: caster ? ['int', 'wis'] : ['str', 'con'], weapon_proficiencies: ['simple', ...(caster ? [] : ['martial'])], armor_training: caster ? [] : ['light', 'medium', 'shield'] } as CharacterClass;
  const draft = { ...emptyDraft(), id: 'source-character', name: 'Перенос', classId: klass.id, classLevels: { [klass.id]: level }, raceId: 'species-one', level, abilityMethod: 'manual' as const, abilities: { str: 12, dex: 14, con: 14, int: 16, wis: 12, cha: 10 }, notes: 'Ручной журнал', description: 'Описание героя' };
  const origin = { kind: 'class' as const, id: klass.id, name: klass.name };
  const effects = [{ effect: { id: 'base-grants', name: 'Базовые особенности', mechanics: passive(
    { kind: 'grant_ability_score', ability: 'str', amount: 2 },
    { kind: 'grant_proficiency', prof: 'skill', value: 'athletics' }, { kind: 'grant_expertise', prof: 'skill', value: 'athletics' },
    ...(caster ? [{ kind: 'spellcasting_ability', role: 'primary', ability: 'int' }] : []),
  ) } as unknown as PassiveEffect, origin }];
  const assembled = assemble({ klass, race: { id: 'species-one', name: 'Вид', speed: caster ? 25 : 30, size: 'medium' } as Race, background: null, effects, actions: [], feats: [], spells: caster ? [spell('prepared-spell'), spell('cantrip', 0)] : [], resources: [] }, draft);
  const ruleState = resolveCharacterRules({ draft, assembled });
  const payload = buildSavePayload(draft, assembled, ruleState);
  const character = runtimeSeedFromSavePayload({ ...payload, current_hp: 0,
    equipment: { necklace: 'strength-charm', cloak: 'ward' }, inventory_items: [{ card_id: 'strength-charm', qty: 2 }, { card_id: 'arrows', qty: 17, container_id: 'bag' }, { card_id: 'bag', qty: 1 }],
    resources: { spell_slot_1: 1, pact_slot_2: 0, hit_dice_d10: 1, focus: 0, heroic_inspiration: 0 }, max_resources: { spell_slot_1: 4, pact_slot_2: 2, hit_dice_d10: level, focus: 3, heroic_inspiration: 1 },
    currency: { gold: 7, silver: 3, copper: 0 }, turn_state: { temp_hp: 5, attuned_ids: ['ward'], death_saves: { successes: 1, failures: 2, stable: false, dead: false } },
  });
  const cards = new Map<string, Card>([
    ['strength-charm', { id: 'strength-charm', name: 'Камень силы', type: 'necklace', mechanics: passive({ kind: 'grant_ability_score', ability: 'str', amount: 2 }) } as unknown as Card],
    ['ward', { id: 'ward', name: 'Покров', type: 'cloak', requires_attunement: true, mechanics: passive({ kind: 'modifier', applies_to: { roll: 'ac' }, op: 'add', value: 1 }, { kind: 'modifier', applies_to: { roll: 'saving_throw' }, op: 'add', value: 1 }) } as unknown as Card],
    ['arrows', { id: 'arrows', name: 'Стрелы', type: 'ammunition' } as unknown as Card], ['bag', { id: 'bag', name: 'Сумка', type: 'other' } as unknown as Card],
  ]);
  return { character, draft, assembled, ruleState, payload, cards };
}

afterEach(() => vi.restoreAllMocks());

describe('interactive character to paper conversion', () => {
  it.each([{ selected: 'lineage-a', label: 'Высокогорный', entry: { id: 'lineage-a', name: 'Высокогорный' } }, { selected: 'Приморский', label: 'Приморский', entry: { name: 'Приморский' } }])('records only a catalog-owned inline lineage selected by id or name: $selected', ({ selected, label, entry }) => {
    const source = build();
    source.draft.lineageId = selected;
    source.assembled.race!.lineages = [{ ...entry, description: 'Описание варианта' }];
    const doc = characterToPaperSheet(source);
    expect(doc.fields.subspecies).toBe(label);
    expect(doc.fields['identity.inlineLineageId']).toBe(selected);
    expect(doc.progression!.baseline!.fields!['identity.inlineLineageId']).toBe(selected);
    source.draft.lineageId = 'Отсутствует в каталоге';
    expect(characterToPaperSheet(source).fields['identity.inlineLineageId']).toBeUndefined();
    source.draft.lineageId = selected;
    source.assembled.subrace = { id: selected, name: label } as Race;
    expect(characterToPaperSheet(source).fields['identity.inlineLineageId']).toBeUndefined();
  });

  it.each([false, true])('copies the canonical base and current pools without doubling equipped grants (caster=%s)', caster => {
    const source = build(caster);
    const original = JSON.stringify(source.character);
    const doc = characterToPaperSheet(source);
    expect(doc.fields.str).toBe('14');
    expect(calculateSheet(doc, projectPaperEquipment(doc, source.cards)).values).toMatchObject({ str: 16, ac: source.ruleState.armorClass + 1, 'skill.athletics': 7, hpCurrent: 0, hpTemp: 5 });
    expect(doc.training['save.str']).toBe(caster ? 0 : 1);
    expect(doc.training['save.int']).toBe(caster ? 1 : 0);
    expect(doc.fields.speed).toBe(caster ? '25' : '30');
    expect(doc.fields['inventory.0.quantity']).toBe('2'); // These are additional copies, not the worn one.
    expect(doc.fields['inventory.1.quantity']).toBe('17');
    expect(doc.fields['inventory.1.containerId']).toBe('bag');
    expect(doc.sections.equipment.text).toContain('Стрелы');
    expect(doc.fields).toMatchObject({ hpCurrent: '0', hpTemp: '5', slot1Max: '4', slot1Used: '3', coinGp: '7', coinSp: '3', coinCp: '0', hitDiceCurrent: '1', hitDiceMax: '3' });
    expect(doc.checks).toMatchObject({ 'death.success.1': true, 'death.failure.2': true, inspiration: false, attunement0: true });
    expect(doc.sections.additional.text).toContain('{{ресурс:Очки фокусировки|0|3}}');
    expect(doc.sections.additional.text).toContain('|0|2}}');
    expect(doc.sections.notes1.text).toBe('Ручной журнал');
    expect(doc.progression?.draft.id).toBeUndefined();
    expect(doc.progression?.draft.abilities.str).toBe(12);
    expect(doc.progression?.baseline?.fields?.str).toBe('14');
    if (caster) {
      expect(doc.fields.spellAbility).toBe('int');
      expect(doc.fields.spellRow0Name).toBe(token('prepared-spell', 'spell'));
      expect(doc.fields.spellRow0Notes).toContain('кристалл');
      expect(doc.checks.spellRow0Concentration).toBe(true);
      expect(doc.fields['weapon.0.name']).toBe(token('cantrip', 'spell'));
    }
    expect(importPaperSheet(exportPaperSheet(doc))).toEqual(doc);
    expect(JSON.stringify(source.character)).toBe(original);
  });

  it('loads base assembly and every owned/contained/attuned card strictly before returning a document', async () => {
    const source = build();
    const load = vi.spyOn(identityLoader, 'loadPaperIdentityAssembly').mockResolvedValue(source.assembled);
    const get = vi.spyOn(cardsApi, 'getCard').mockImplementation(async id => source.cards.get(id)!);
    const doc = await exportInteractiveCharacterToPaper(source.character);
    expect(load).toHaveBeenCalledOnce();
    expect(new Set(get.mock.calls.map(([id]) => id))).toEqual(new Set(source.cards.keys()));
    expect(doc.fields['equipment.necklace']).toContain('strength-charm');
    get.mockImplementation(async id => { if (id === 'bag') throw new Error('Каталог недоступен'); return source.cards.get(id)!; });
    await expect(exportInteractiveCharacterToPaper(source.character)).rejects.toThrow('Каталог недоступен');
  });

  it('uses Forge creation runtime atomically and never writes to a character service', async () => {
    const source = build(true);
    vi.spyOn(cardsApi, 'getCard').mockImplementation(async id => source.cards.get(id)!);
    const doc = await forgeCharacterToPaper({ ...source, initialRuntime: { inventory_items: [{ card_id: 'arrows', qty: 20 }], resources: { spell_slot_1: 2 }, max_resources: { spell_slot_1: 2 }, currency: { gold: 25 } } });
    expect(doc.fields['inventory.0.quantity']).toBe('20');
    expect(doc.fields.coinGp).toBe('25');
    expect(doc.fields.slot1Used).toBe('0');
    expect(doc.progression?.draft.id).toBeUndefined();
  });

  it.each([false, true])('preserves live CON and HP grants once, and a distinct saved maximum when present (custom=%s)', custom => {
    const source = build();
    source.cards.set('strength-charm', { ...source.cards.get('strength-charm')!, mechanics: passive(
      { kind: 'grant_ability_score', ability: 'con', amount: 2 },
      { kind: 'modifier', applies_to: { roll: 'max_hp' }, op: 'add', value: 4 },
    ) });
    const expectedCanonical = source.ruleState.maxHP + source.draft.level + 4;
    if (custom) source.character.max_hp = expectedCanonical + 6;
    const doc = characterToPaperSheet(source);
    expect(doc.fields.con).toBe('14');
    expect(doc.fields['buildOffset.hpMax']).toBe(custom ? '6' : undefined);
    expect(calculateSheet(doc, projectPaperEquipment(doc, source.cards)).values.hpMax).toBe(expectedCanonical + (custom ? 6 : 0));
    delete doc.fields['equipment.necklace'];
    expect(calculateSheet(doc, projectPaperEquipment(doc, source.cards)).values.hpMax).toBe(source.ruleState.maxHP + (custom ? 6 : 0));
    expect(doc.fields.hpCurrent).toBe('0');
  });

  it('keeps a saved maximum already including worn grants and does not count those grants in its base', () => {
    const source = build(true);
    source.cards.set('strength-charm', { ...source.cards.get('strength-charm')!, mechanics: passive({ kind: 'grant_ability_score', ability: 'con', amount: 4 }) });
    source.character.max_hp = source.ruleState.maxHP + 2 * source.draft.level;
    const doc = characterToPaperSheet(source);
    expect(calculateSheet(doc, projectPaperEquipment(doc, source.cards)).values.hpMax).toBe(source.character.max_hp);
    expect(calculateSheet(doc).values.hpMax).toBe(source.ruleState.maxHP);
    expect(doc.fields['buildOffset.hpMax']).toBeUndefined();
  });

  it('preserves explicit speed and proficiency deviations from the saved base without changing raw abilities', () => {
    const source = build();
    source.character.speed = source.ruleState.speed + 5;
    source.character.proficiency_bonus = source.ruleState.proficiencyBonus + 1;
    const doc = characterToPaperSheet(source);
    expect(calculateSheet(doc).values).toMatchObject({ speed: 35, proficiency: 3, str: 14, 'skill.athletics': 8 });
    expect(source.character.abilities?.str).toBe(12);
  });

  it('hydrates recursively granted item effects before preserving a saved HP maximum', async () => {
    const source = build(true);
    source.cards.set('strength-charm', { ...source.cards.get('strength-charm')!, mechanics: passive({ kind: 'grant_effect', values: ['item-vitality'] }) });
    const vitality = { id: 'item-vitality', card_number: 'EFFECT-item-vitality', name: 'Стойкость', mechanics: passive(
      { kind: 'grant_ability_score', ability: 'con', amount: 2 },
      { kind: 'modifier', applies_to: { roll: 'max_hp' }, op: 'add', value: 4 },
    ) } as unknown as PassiveEffect;
    source.character.max_hp = source.ruleState.maxHP + source.draft.level + 4;
    vi.spyOn(identityLoader, 'loadPaperIdentityAssembly').mockResolvedValue(source.assembled);
    vi.spyOn(cardsApi, 'getCard').mockImplementation(async id => source.cards.get(id)!);
    const getEffect = vi.spyOn(effectsApi, 'getEffect').mockResolvedValue(vitality);
    const original = JSON.stringify(source.character);
    const doc = await exportInteractiveCharacterToPaper(source.character);
    const effects = await loadPaperEquipmentEffects(doc, source.cards);
    expect(calculateSheet(doc, projectPaperEquipment(doc, source.cards, effects)).values.hpMax).toBe(source.character.max_hp);
    expect(calculateSheet(doc).values.hpMax).toBe(source.ruleState.maxHP);
    delete doc.fields['equipment.necklace'];
    expect(calculateSheet(doc, projectPaperEquipment(doc, source.cards, effects)).values.hpMax).toBe(source.ruleState.maxHP);
    getEffect.mockRejectedValue(new Error('Эффект недоступен'));
    await expect(exportInteractiveCharacterToPaper(source.character)).rejects.toThrow('Не все записи каталога');
    expect(JSON.stringify(source.character)).toBe(original);
  });

  it('uses current preparation instead of the old Forge choice and preserves unprepared known spells separately', () => {
    const source = build(true);
    source.assembled.spells = [spell('old-prepared'), spell('current-prepared'), spell('always'), spell('cantrip', 0)];
    const origin = { kind: 'class' as const, id: source.assembled.klass!.id, name: source.assembled.klass!.name };
    source.assembled.effects.push({ origin, effect: { id: 'spellbook-feature', card_number: 'EFFECT-spellbook', name: 'Книга', mechanics: passive(
      { kind: 'grant_spell', value: 'old-prepared', label: 'spellbook', ability: 'int' },
      { kind: 'grant_spell', value: 'current-prepared', label: 'spellbook', ability: 'int' },
      { kind: 'grant_spell', value: 'always', label: 'always_prepared', ability: 'int' },
      { kind: 'grant_spell', value: 'cantrip', label: 'cantrip', ability: 'int' },
    ) } as unknown as PassiveEffect });
    source.assembled.pendingChoices.push({ id: 'prepare', prompt: 'Подготовка', source: 'prepared_spell', count: 1, origin });
    source.ruleState = resolveCharacterRules({ draft: source.draft, assembled: source.assembled });
    source.character.resolved_choices = { prepare: ['old-prepared'] };
    source.character.turn_state = writeSheetSpellPreparation(source.character.turn_state, { prepare: ['current-prepared'] });
    const original = JSON.stringify(source.character);
    const doc = characterToPaperSheet(source);
    expect([doc.fields.spellRow0Name, doc.fields.spellRow1Name, doc.fields.spellRow2Name]).toEqual(['current-prepared', 'always', 'cantrip'].map(id => token(id, 'spell')));
    expect(doc.sections.notes2.text).toBe(`${token('old-prepared', 'spell')} — известно, не подготовлено`);
    expect(doc.fields['weapon.0.name']).toBe(token('cantrip', 'spell'));
    expect(JSON.stringify(source.character)).toBe(original);
  });
});

describe('exported permanent adjustments across Forge progression', () => {
  it.each([false, true])('retains custom HP/speed/proficiency once through two levels and reversible equipment (caster=%s)', async caster => {
    const source = build(caster, 3);
    const hpOffset = caster ? 9 : 6, speedOffset = caster ? -5 : 5, proficiencyOffset = caster ? 2 : 1;
    source.cards.set('strength-charm', { ...source.cards.get('strength-charm')!, mechanics: passive(
      { kind: 'grant_ability_score', ability: 'con', amount: 2 },
      { kind: 'modifier', applies_to: { roll: 'max_hp' }, op: 'add', value: 4 },
    ) });
    source.character.max_hp = source.ruleState.maxHP + source.draft.level + 4 + hpOffset;
    source.character.speed = source.ruleState.speed + speedOffset;
    source.character.proficiency_bonus = source.ruleState.proficiencyBonus + proficiencyOffset;
    const original = JSON.stringify(source.character);
    vi.spyOn(identityLoader, 'loadPaperIdentityAssembly').mockResolvedValue(source.assembled);
    vi.spyOn(cardsApi, 'getCard').mockImplementation(async id => source.cards.get(id)!);
    let doc = importPaperSheet(exportPaperSheet(await exportInteractiveCharacterToPaper(source.character)));
    const wornItem = doc.fields['equipment.necklace'];
    const provenance = { 'buildOffset.hpMax': String(hpOffset), 'buildOffset.speed': String(speedOffset), 'buildOffset.proficiency': String(proficiencyOffset) };
    expect(doc.fields).toMatchObject(provenance);
    expect(doc.progression!.baseline!.fields).toMatchObject(provenance);
    // Only the generated baseline has authority; a changed current marker cannot become a new bonus.
    doc.fields['buildOffset.hpMax'] = '999';
    let lastRules = source.ruleState;
    for (const level of [4, 5]) {
      const next = build(caster, level);
      next.assembled.race!.speed = source.ruleState.speed + (level - 3) * 5;
      next.ruleState = resolveCharacterRules({ draft: next.draft, assembled: next.assembled });
      next.payload = buildSavePayload(next.draft, next.assembled, next.ruleState);
      if (level === 5) doc.fields['equipment.necklace'] = '';
      const prior = exportPaperSheet(doc);
      const updated = await forgeCharacterToPaper({ ...next, existing: doc });
      expect(exportPaperSheet(doc)).toBe(prior);
      expect(calculateSheet(updated, projectPaperEquipment(updated, source.cards)).values).toMatchObject({
        hpMax: next.ruleState.maxHP + hpOffset + (level === 4 ? level + 4 : 0),
        speed: next.ruleState.speed + speedOffset, proficiency: next.ruleState.proficiencyBonus + proficiencyOffset,
        hpCurrent: 0, hpTemp: 5,
      });
      expect(calculateSheet(updated).values.hpMax).toBe(next.ruleState.maxHP + hpOffset);
      expect(updated.fields).toMatchObject(provenance);
      expect(updated.progression!.baseline!.fields).toMatchObject(provenance);
      doc = importPaperSheet(exportPaperSheet(updated));
      lastRules = next.ruleState;
    }
    expect(lastRules.proficiencyBonus).toBe(3);
    doc.fields['equipment.necklace'] = wornItem;
    expect(calculateSheet(doc, projectPaperEquipment(doc, source.cards)).values.hpMax).toBe(lastRules.maxHP + hpOffset + 5 + 4);
    expect(JSON.stringify(source.character)).toBe(original);
  });

  it('keeps later manual stat formulas while carrying only generated adjustments into the new baseline', async () => {
    const source = build();
    source.character.max_hp = source.ruleState.maxHP + 6;
    source.character.speed = source.ruleState.speed + 5;
    source.character.proficiency_bonus = source.ruleState.proficiencyBonus + 1;
    let doc = characterToPaperSheet(source);
    Object.assign(doc.fields, { hpMax: '=90 + [CON]', speed: '=40 + [DEX]', proficiency: '=7' });
    for (const level of [4, 5]) {
      const next = build(false, level);
      doc = await forgeCharacterToPaper({ ...next, existing: doc });
      expect(doc.fields).toMatchObject({ hpMax: '=90 + [CON]', speed: '=40 + [DEX]', proficiency: '=7' });
      expect(doc.progression!.baseline!.fields).toMatchObject({ 'buildOffset.hpMax': '6', 'buildOffset.speed': '5', 'buildOffset.proficiency': '1' });
      const generated = { ...doc, fields: doc.progression!.baseline!.fields! };
      expect(calculateSheet(generated).values.hpMax).toBe(next.ruleState.maxHP + 6);
    }
  });

  it('does not infer adjustments from absent, malformed, or current-only provenance on older sheets', async () => {
    const source = build(), next = build(false, 4);
    const doc = characterToPaperSheet(source);
    doc.fields['buildOffset.hpMax'] = '999';
    doc.progression!.baseline!.fields!['buildOffset.speed'] = '=999';
    doc.progression!.baseline!.fields!['buildOffset.proficiency'] = '';
    const updated = await forgeCharacterToPaper({ ...next, existing: doc });
    expect(calculateSheet(updated).values).toMatchObject({ hpMax: next.ruleState.maxHP, speed: next.ruleState.speed, proficiency: next.ruleState.proficiencyBonus });
    expect(updated.progression!.baseline!.fields!['buildOffset.hpMax']).toBeUndefined();
    expect(updated.progression!.baseline!.fields!['buildOffset.speed']).toBeUndefined();
    expect(updated.progression!.baseline!.fields!['buildOffset.proficiency']).toBeUndefined();
  });
});

function generated(level: number): PaperSheetDocument {
  const doc = createPaperSheet();
  doc.fields.level = String(level); doc.fields.hpMax = String(level * 10); doc.fields.hpCurrent = String(level * 10);
  doc.fields.slot1Max = String(level + 1); doc.fields.slot1Used = '0'; doc.fields.coinGp = '20';
  doc.fields['equipment.cloak'] = token('ward'); doc.fields['inventory.0.item'] = token('arrows'); doc.fields['inventory.0.quantity'] = '20';
  doc.fields['skill.arcana'] = level < 4 ? '=5' : '=7';
  doc.sections.features = { text: [token('old-feature', 'effect'), ...(level >= 4 ? [token('new-feature', 'effect')] : [])].join('\n'), fontSize: 12 };
  doc.sections.additional = { text: `{{ресурс:Очки фокусировки|${level}|${level}}}${level >= 4 ? '\n{{ресурс:Новый ресурс|2|2}}' : ''}`, fontSize: 12 };
  doc.sections.notes1 = { text: 'Исходный журнал', fontSize: 12 };
  for (let index = 0; index < (level < 4 ? 11 : level < 5 ? 12 : 13); index++) {
    doc.fields[`spellRow${index}Name`] = token(`spell-${index}`, 'spell');
    doc.fields[`spellRow${index}Range`] = `${level * 10 + index} футов`;
    doc.fields[`spellRow${index}Notes`] = `Заметка ${index}`;
    doc.checks[`spellRow${index}Ritual`] = index % 2 === 0;
  }
  doc.identity = { classId: 'class-a' };
  doc.progression = { draft: { ...emptyDraft(), classId: 'class-a', classLevels: { 'class-a': level }, level }, baseline: paperProgressionBaseline(doc) };
  return doc;
}

describe('progression merge', () => {
  it('updates a legacy custom subspecies label when Forge explicitly selects or changes an inline lineage', () => {
    const source = build();
    source.assembled.race!.lineages = [
      { name: 'Приморский', description: 'Первый вариант' },
      { name: 'Высокогорный', description: 'Второй вариант' },
    ];
    const legacy = createPaperSheet();
    legacy.identity = { speciesId: source.draft.raceId! };
    legacy.fields.subspecies = 'Своя подпись';
    source.draft.lineageId = 'Приморский';
    const selected = mergePaperProgression(legacy, characterToPaperSheet(source));
    expect(selected.fields.subspecies).toBe('Приморский');
    expect(selected.fields['identity.inlineLineageId']).toBe('Приморский');
    selected.fields.subspecies = 'Поздняя ручная подпись';
    source.draft.lineageId = 'Высокогорный';
    const changed = mergePaperProgression(selected, characterToPaperSheet(source));
    expect(changed.fields.subspecies).toBe('Высокогорный');
    expect(changed.fields['identity.inlineLineageId']).toBe('Высокогорный');
    expect(changed.progression!.baseline!.fields!.subspecies).toBe('Высокогорный');
    expect(legacy.fields.subspecies).toBe('Своя подпись');
    expect(selected.fields.subspecies).toBe('Поздняя ручная подпись');
  });

  it('replaces removed untouched spells while preserving edited rows and owned weapons across subsequent builds', () => {
    const existing = generated(3), next = generated(4);
    existing.fields.spellRow1Notes = 'Мой расход материала';
    existing.fields['weapon.0.name'] = token('owned-sword');
    existing.progression!.baseline!.fields!['weapon.0.name'] = token('owned-sword');
    for (const group of ['fields', 'checks'] as const) for (const key of Object.keys(next[group])) if (/^spellRow[01]\D/.test(key)) delete next[group][key];
    next.fields.spellRow0Name = token('replacement', 'spell'); next.fields.spellRow0Notes = 'Новое';
    next.progression!.baseline = paperProgressionBaseline(next);
    const changed = mergePaperProgression(existing, next);
    expect(changed.fields.spellRow0Name).toBe(token('replacement', 'spell'));
    expect(changed.fields.spellRow0Range).toBeUndefined();
    expect(changed.checks.spellRow0Ritual).toBeUndefined();
    expect(changed.fields.spellRow1Name).toBe(token('spell-1', 'spell'));
    expect(changed.fields.spellRow1Notes).toContain('Мой расход материала\nБольше не выбрано');
    expect(changed.fields['weapon.0.name']).toBe(token('owned-sword'));
    expect(changed.progression!.baseline!.fields!.spellRow0Name).toBe(token('replacement', 'spell'));
    const restored = mergePaperProgression(changed, generated(5));
    expect(restored.fields.spellRow1Notes).toBe('Мой расход материала');
    expect(Object.values(restored.fields).filter(value => value === token('replacement', 'spell'))).toHaveLength(0);
  });

  it('removes replaced generated feature lines without deleting manual prose or a renamed linked feature', () => {
    const old = generated(3), next = generated(4);
    old.sections.features.text += '\nМой комментарий';
    old.sections.traits = { text: token('old-trait', 'effect'), fontSize: 12 };
    old.progression!.baseline!.sections!.traits = structuredClone(old.sections.traits);
    old.sections.traits.text = '[[Моё название|effect:old-trait]]\nМоя черта';
    next.sections.features.text = token('new-feature', 'effect');
    next.sections.traits = { text: token('new-trait', 'effect'), fontSize: 12 };
    next.progression!.baseline = paperProgressionBaseline(next);
    const changed = mergePaperProgression(old, next);
    expect(changed.sections.features.text).toBe(`Мой комментарий\n${token('new-feature', 'effect')}`);
    expect(changed.sections.traits.text).toBe(`[[Моё название|effect:old-trait]]\nМоя черта\n${token('new-trait', 'effect')}`);
    expect(old.sections.features.text).toContain('old-feature');
  });

  it('keeps row baselines aligned after exchanging generated rows and upgrading again', () => {
    const existing = generated(3);
    for (const group of ['fields', 'checks'] as const) {
      const entries = Object.entries(existing[group]).filter(([key]) => /^spellRow[01]\D/.test(key));
      for (const [key, value] of entries) Object.assign(existing[group], { [key.replace(/^spellRow([01])/, (_, digit: string) => `spellRow${digit === '0' ? 1 : 0}`)]: value });
    }
    const fourth = mergePaperProgression(existing, generated(4));
    expect(fourth.progression!.baseline!.fields!.spellRow0Name).toBe(token('spell-1', 'spell'));
    expect(fourth.progression!.baseline!.fields!.spellRow1Name).toBe(token('spell-0', 'spell'));
    const fifth = mergePaperProgression(fourth, generated(5));
    expect(fifth.fields.spellRow0Range).toBe('51 футов');
    expect(fifth.fields.spellRow1Range).toBe('50 футов');
  });

  it('keeps a level formula when the level is unchanged and updates labels when the chosen identity changes', () => {
    const existing = generated(3); existing.fields.level = '=2 + 1'; existing.fields.class = 'Старое ручное имя';
    const next = generated(3); next.identity = { classId: 'class-b' }; next.fields.class = 'Новый класс';
    const merged = mergePaperProgression(existing, next);
    expect(merged.fields.level).toBe('=2 + 1');
    expect(merged.fields.class).toBe('Новый класс');
    expect(merged.identity?.classId).toBe('class-b');
    expect(mergePaperProgression(merged, generated(4)).fields.level).toBe('4');
  });

  it('retains the spent current pool when a new resource shares its display name', () => {
    const old = generated(3), next = generated(4);
    old.fields['resourceLabel.pool-a'] = 'Запас';
    old.sections.additional.text = '{{ресурс:Запас|3|3}}';
    old.progression!.baseline = paperProgressionBaseline(old);
    old.sections.additional.text = '{{ресурс:Запас|0|3}}\nМой комментарий';
    next.fields['resourceLabel.pool-a'] = 'Запас (pool-a)'; next.fields['resourceLabel.pool-b'] = 'Запас (pool-b)';
    next.sections.additional.text = '{{ресурс:Запас (pool-a)|4|4}}\n{{ресурс:Запас (pool-b)|2|2}}';
    next.progression!.baseline = paperProgressionBaseline(next);
    expect(mergePaperProgression(old, next).sections.additional.text).toBe('{{ресурс:Запас (pool-a)|0|4}}\nМой комментарий\n{{ресурс:Запас (pool-b)|2|2}}');
  });

  it('updates through three levels with aligned row baselines, preserving edits, current pools and ownership', () => {
    const existing = generated(3);
    existing.fields.hpCurrent = '0'; existing.fields.hpTemp = '4'; existing.fields.slot1Used = '3'; existing.fields.coinGp = '1';
    existing.fields['inventory.0.quantity'] = '7'; existing.fields.ac = '=99';
    existing.fields['equipment.cloak'] = token('different-cloak');
    existing.fields.spellRow1Notes = 'Ручная заметка';
    existing.fields.spellRow20Name = 'Ручная строка'; existing.fields.spellRow20Notes = 'Не занимать';
    existing.sections.notes1.text = 'Ручной журнал после игры';
    existing.sections.features.text += '\nМоя заметка';
    existing.sections.additional.text = '{{ресурс:Очки фокусировки|0|3}}\nМой комментарий';
    const before = exportPaperSheet(existing);
    const fourth = mergePaperProgression(existing, generated(4));
    expect(fourth.fields).toMatchObject({ hpMax: '40', hpCurrent: '0', hpTemp: '4', slot1Max: '5', slot1Used: '3', coinGp: '1', 'inventory.0.quantity': '7', ac: '=99' });
    expect(fourth.fields['equipment.cloak']).toBe(token('different-cloak'));
    expect(fourth.fields.spellRow1Name).toBe(token('spell-1', 'spell'));
    expect(fourth.fields.spellRow10Name).toBe(token('spell-10', 'spell'));
    expect(fourth.fields.spellRow1Range).toBe('41 футов');
    expect(fourth.fields.spellRow10Range).toBe('50 футов');
    expect(fourth.fields.spellRow1Notes).toBe('Ручная заметка');
    expect(fourth.fields.spellRow21Name).toBe(token('spell-11', 'spell'));
    expect(fourth.progression?.baseline?.fields?.spellRow21Name).toBe(token('spell-11', 'spell'));
    expect(fourth.sections.additional.text).toBe('{{ресурс:Очки фокусировки|0|4}}\nМой комментарий\n{{ресурс:Новый ресурс|2|2}}');
    expect(fourth.sections.notes1.text).toBe('Ручной журнал после игры');
    expect(fourth.sections.features.text).toContain('Моя заметка');
    fourth.fields.spellRow21Notes = 'Ещё одна ручная заметка';
    const fifth = mergePaperProgression(fourth, generated(5));
    expect(fifth.fields.spellRow21Notes).toBe('Ещё одна ручная заметка');
    expect(fifth.fields.spellRow21Range).toBe('61 футов');
    expect(fifth.fields.spellRow22Name).toBe(token('spell-12', 'spell'));
    expect(fifth.progression?.baseline?.fields?.spellRow22Name).toBe(token('spell-12', 'spell'));
    expect(fifth.sections.additional.text).toBe('{{ресурс:Очки фокусировки|0|5}}\nМой комментарий\n{{ресурс:Новый ресурс|2|2}}');
    expect(fifth.sections.features.text.match(/new-feature\]\]/g)).toHaveLength(1);
    expect(exportPaperSheet(existing)).toBe(before);
  });

  it('keeps native sheets without a baseline intact while filling missing fields and adding progression', () => {
    const existing = createPaperSheet();
    existing.fields.hpMax = '=20 + [CON]'; existing.fields.hpCurrent = '3'; existing.fields.ac = '=15+[DEX]';
    existing.fields['equipment.cloak'] = token('manual-cloak');
    existing.training.athletics = 0;
    existing.sections.features = { text: 'Мой текст', fontSize: 17 };
    existing.sections.additional = { text: '{{ресурс:Мой запас|1|4}}', fontSize: 12 };
    const next = generated(4); next.training.athletics = 2;
    const merged = mergePaperProgression(existing, next);
    expect(merged.fields).toMatchObject({ level: '4', hpMax: '=20 + [CON]', hpCurrent: '3', ac: '=15+[DEX]', 'equipment.cloak': token('manual-cloak') });
    expect(merged.training.athletics).toBe(0);
    expect(merged.sections.features).toEqual(existing.sections.features);
    expect(merged.sections.additional).toEqual(existing.sections.additional);
    expect(merged.progression?.draft.level).toBe(4);
  });

  it('removes an obsolete generated numeric override while preserving a manually changed formula', () => {
    const old = generated(3), next = generated(4);
    delete next.fields['skill.arcana'];
    next.progression!.baseline = paperProgressionBaseline(next);
    expect(mergePaperProgression(old, next).fields['skill.arcana']).toBeUndefined();
    old.fields['skill.arcana'] = '=123';
    expect(mergePaperProgression(old, next).fields['skill.arcana']).toBe('=123');
  });
});
