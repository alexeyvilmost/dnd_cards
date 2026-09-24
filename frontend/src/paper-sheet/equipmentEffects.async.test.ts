import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectsApi } from '../api/client';
import type { Card, PassiveEffect } from '../types';
import { calculateSheet, createPaperSheet, type PaperSheetDocument } from './model';
import { paperEntityToken } from './references';
import {
  loadPaperEquipmentEffects,
  paperEquipmentEffectsKey,
  projectPaperEquipment,
  startPaperEquipmentEffectLoad,
  type PaperGrantedEffectSnapshot,
} from './equipmentEffects';

type Dict = Record<string, unknown>;
const passive = (...result: Dict[]) => ({ activation: { mode: 'passive' }, effects: [{ resolution: 'auto', result }] });
const modifier = (roll: string, value: number) => ({ kind: 'modifier', applies_to: { roll }, op: 'add', value });
const grant = (...values: string[]) => ({ kind: 'grant_effect', values });
const item = (id: string, mechanics: Dict, extra: Partial<Card> = {}): Card => ({
  id, name: `Предмет ${id}`, type: 'cloak', mechanics, ...extra,
} as Card);
const effect = (id: string, mechanics: Dict): PassiveEffect => ({
  id, name: `Эффект ${id}`, card_number: `EFFECT-${id}`, mechanics,
  rarity: 'common', effect_type: 'item_effect', description: '', created_at: '', updated_at: '',
});
const token = (card: Card) => paperEntityToken({ type: 'card', id: card.id, name: card.name });
const equip = (document: PaperSheetDocument, slot: string, card: Card) => {
  document.fields[`equipment.${slot}`] = token(card);
};
const map = (...cards: Card[]) => new Map(cards.map(card => [card.id, card]));
const values = (document: PaperSheetDocument, cards: Map<string, Card>, snapshot: PaperGrantedEffectSnapshot) => (
  calculateSheet(document, projectPaperEquipment(document, cards, snapshot)).values
);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function catalogue(...effects: PassiveEffect[]) {
  return vi.spyOn(effectsApi, 'getEffect').mockImplementation(async reference => {
    const found = effects.find(entry => entry.id === reference || entry.card_number === reference);
    if (!found) throw new Error(`Missing test effect ${reference}`);
    return found;
  });
}

afterEach(() => vi.restoreAllMocks());

describe('paper equipment uses the canonical asynchronous grant_effect assembler', () => {
  it('expands two different items and a nested effect through shared stat and numeric channels exactly once', async () => {
    const endurance = effect('paper-nested-endurance', passive({ kind: 'grant_ability_score', ability: 'con', amount: 2 }));
    const guard = effect('paper-granted-guard', passive(
      modifier('ac', 1), modifier('saving_throw', 1), modifier('speed', 5), modifier('max_hp', 5), grant(endurance.card_number),
    ));
    const sight = effect('paper-granted-sight', passive(
      { kind: 'value_method', target: 'wis', formula: '17' },
      { kind: 'grant_proficiency', prof: 'skill', value: 'perception' },
    ));
    const api = catalogue(guard, sight, endurance);
    const cloak = item('paper-granting-cloak', passive(grant(guard.card_number), modifier('initiative', 2)));
    const lens = item('paper-granting-lens', passive(grant(sight.id)));
    const cards = map(cloak, lens);
    const doc = createPaperSheet();
    Object.assign(doc.fields, { ac: '12', speed: '30', hpMax: '20' });
    equip(doc, 'cloak', cloak); equip(doc, 'head', lens);
    const original = JSON.stringify(doc);
    const snapshot = await loadPaperEquipmentEffects(doc, cards);
    expect(new Set(snapshot.effects.map(entry => entry.id))).toEqual(new Set([guard.id, sight.id, endurance.id]));
    expect(values(doc, cards, snapshot)).toMatchObject({
      con: 12, wis: 17, ac: 13, 'save.wis': 4, 'skill.perception': 5, passive: 15,
      speed: 35, hpMax: 25, initiative: 2,
    });
    expect(projectPaperEquipment(doc, cards, snapshot).sources?.con).toContain(endurance.name);
    expect(api).toHaveBeenCalledWith(endurance.card_number);
    expect(JSON.stringify(doc)).toBe(original);
  });

  it('deduplicates the same effect granted by two distinct items through UUID and card-number references', async () => {
    const shared = effect('paper-common-ward', passive(modifier('ac', 2), modifier('max_hp', 4)));
    catalogue(shared);
    const first = item('paper-common-ring', passive(grant(shared.card_number)));
    const second = item('paper-common-necklace', passive(grant(shared.id)));
    const doc = createPaperSheet(); Object.assign(doc.fields, { ac: '11', hpMax: '20' });
    equip(doc, 'ring_1', first); equip(doc, 'necklace', second);
    const cards = map(first, second);
    const snapshot = await loadPaperEquipmentEffects(doc, cards);
    expect(snapshot.effects.map(entry => entry.id)).toEqual([shared.id]);
    expect(values(doc, cards, snapshot)).toMatchObject({ ac: 13, hpMax: 24 });
    doc.fields['equipment.ring_1'] = '';
    const afterRemoval = await loadPaperEquipmentEffects(doc, cards);
    expect(values(doc, cards, afterRemoval)).toMatchObject({ ac: 13, hpMax: 24 });
  });

  it('gates expansion by ownership and attunement and rejects a formerly active snapshot immediately', async () => {
    const granted = effect('paper-attuned-agility', passive({ kind: 'grant_ability_score', ability: 'dex', amount: 4 }));
    const api = catalogue(granted);
    const gloves = item('paper-attuned-gloves', passive(grant(granted.id)), { requires_attunement: true });
    const cards = map(gloves), doc = createPaperSheet();
    equip(doc, 'gloves', gloves);
    expect((await loadPaperEquipmentEffects(doc, cards)).effects).toEqual([]);
    expect(api).not.toHaveBeenCalled();
    doc.fields.attunementName0 = token(gloves); doc.checks.attunement0 = true;
    const active = await loadPaperEquipmentEffects(doc, cards);
    expect(values(doc, cards, active).dex).toBe(14);
    doc.checks.attunement0 = false;
    expect(values(doc, cards, active).dex).toBe(10);
    expect((await loadPaperEquipmentEffects(doc, cards)).effects).toEqual([]);
    doc.checks.attunement0 = true; doc.fields['equipment.gloves'] = '';
    expect(values(doc, cards, active).dex).toBe(10);
  });

  it('never reapplies a late old-item response after removal and does not replace a newer item snapshot', async () => {
    const oldEffect = effect('paper-late-strength', passive({ kind: 'grant_ability_score', ability: 'str', amount: 6 }));
    const newEffect = effect('paper-new-wisdom', passive({ kind: 'grant_ability_score', ability: 'wis', amount: 2 }));
    const late = deferred<PassiveEffect>();
    vi.spyOn(effectsApi, 'getEffect').mockImplementation(reference => (
      reference === oldEffect.id ? late.promise : Promise.resolve(newEffect)
    ));
    const oldItem = item('paper-old-belt', passive(grant(oldEffect.id)));
    const newItem = item('paper-new-diadem', passive(grant(newEffect.id)));
    const cards = map(oldItem, newItem), oldDoc = createPaperSheet();
    equip(oldDoc, 'head', oldItem);
    const oldLoaded = vi.fn();
    const cancelOld = startPaperEquipmentEffectLoad(oldDoc, cards, oldLoaded);
    const oldRequest = loadPaperEquipmentEffects(oldDoc, cards);
    const newDoc = { ...oldDoc, fields: { ...oldDoc.fields, 'equipment.head': token(newItem) } };
    cancelOld();
    const newest = deferred<PaperGrantedEffectSnapshot>();
    const newLoaded = vi.fn((snapshot: PaperGrantedEffectSnapshot) => newest.resolve(snapshot));
    const cancelNew = startPaperEquipmentEffectLoad(newDoc, cards, newLoaded);
    const newSnapshot = await newest.promise;
    expect(values(newDoc, cards, newSnapshot)).toMatchObject({ str: 10, wis: 12 });
    late.resolve(oldEffect);
    const oldSnapshot = await oldRequest;
    expect(oldLoaded).not.toHaveBeenCalled();
    expect(newLoaded).toHaveBeenCalledTimes(1);
    expect(values(newDoc, cards, oldSnapshot)).toMatchObject({ str: 10, wis: 10 });
    expect(values(newDoc, cards, newSnapshot)).toMatchObject({ str: 10, wis: 12 });
    const removed = { ...newDoc, fields: { ...newDoc.fields, 'equipment.head': '' } };
    expect(values(removed, cards, oldSnapshot).str).toBe(10);
    cancelNew();
  });

  it('does not turn a granted active capability into a permanent stat bonus, while missing references fail softly', async () => {
    const active = effect('paper-granted-active', {
      ...passive({ kind: 'grant_ability_score', ability: 'con', amount: 8 }), activation: { mode: 'active' },
    });
    const passiveEffect = effect('paper-granted-passive', passive(modifier('saving_throw', 2)));
    catalogue(active, passiveEffect);
    const wand = item('paper-wand-grants', passive(grant(active.id, passiveEffect.id, 'paper-missing-effect')));
    const cards = map(wand), doc = createPaperSheet(); equip(doc, 'main_hand', wand);
    const snapshot = await loadPaperEquipmentEffects(doc, cards);
    expect(values(doc, cards, snapshot)).toMatchObject({ con: 10, 'save.con': 2 });
    expect(snapshot.effects).toHaveLength(2);
  });

  it('keeps the request key stable for prose edits and invalidates changed item mechanics or character levels', async () => {
    const granted = effect('paper-key-effect', passive({ kind: 'grant_ability_score', ability: 'str', amount: 2 }));
    catalogue(granted);
    const belt = item('paper-key-belt', passive(grant(granted.id)));
    const cards = map(belt), doc = createPaperSheet(); equip(doc, 'body', belt);
    const key = paperEquipmentEffectsKey(doc, cards);
    const snapshot = await loadPaperEquipmentEffects(doc, cards);
    doc.fields.name = 'Другое имя'; doc.sections.notes1 = { text: 'Запись', fontSize: 12 };
    expect(paperEquipmentEffectsKey(doc, cards)).toBe(key);
    expect(values(doc, cards, snapshot).str).toBe(12);
    doc.fields.level = '2';
    expect(paperEquipmentEffectsKey(doc, cards)).not.toBe(key);
    expect(values(doc, cards, snapshot).str).toBe(10);
    doc.fields.level = '1';
    cards.set(belt.id, { ...belt, mechanics: passive(grant('paper-changed-reference')) });
    expect(paperEquipmentEffectsKey(doc, cards)).not.toBe(key);
    expect(values(doc, cards, snapshot).str).toBe(10);
  });
});
