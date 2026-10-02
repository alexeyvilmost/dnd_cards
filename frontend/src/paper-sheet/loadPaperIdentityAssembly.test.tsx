// @vitest-environment jsdom
import { act, useMemo, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyDraft } from '../character/types';
import { calculateSheet, createPaperSheet, type PaperSheetDocument } from './model';
import { paperIdentitySourceKey } from './identity';
import { usePaperIdentityFeatures } from './usePaperIdentityFeatures';
import { loadPaperIdentityAssembly, loadPaperItemGrantedEffects } from './loadPaperIdentityAssembly';
import { loadPaperEquipmentEffects } from './equipmentEffects';
import { paperEntityToken } from './references';
import type { Card } from '../types';

const mocks = vi.hoisted(() => ({ getClass: vi.fn(), getEffect: vi.fn(), variables: vi.fn() }));
vi.mock('../api/client', () => ({
  classesApi: { getClass: mocks.getClass }, effectsApi: { getEffect: mocks.getEffect, getEffects: vi.fn() },
  variablesApi: { getVariables: mocks.variables }, racesApi: { getRace: vi.fn() }, backgroundsApi: { getBackground: vi.fn() },
  actionsApi: { getAction: vi.fn() }, featsApi: { getFeat: vi.fn() }, spellsApi: { getSpell: vi.fn() }, resourcesApi: { getResource: vi.fn() },
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const base = { name: 'Запись', description: '', rarity: 'common', created_at: '', updated_at: '' };
const effect = (id: string) => ({ ...base, id, card_number: id, name: `Особенность ${id}`, effect_type: 'passive' });
const grants = (...values: string[]) => ({ activation: { mode: 'passive' }, effects: [{ resolution: 'auto', result: [{ kind: 'grant_effect', values }] }] });

describe('strict canonical paper assembly loading', () => {
  let root: Root;
  let host: HTMLDivElement;
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.variables.mockResolvedValue({ variables: [], total: 0, page: 1, limit: 100 });
    mocks.getClass.mockResolvedValue({ ...base, id: 'class', card_number: 'fixture-class', level_progression: { '1': { effects: ['first', 'second'] } } });
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

  it('preserves a complete saved snapshot when a second entity fails and replaces it after successful retry', async () => {
    const initial = createPaperSheet(); initial.identity = { classId: 'class' };
    initial.sections.features = { text: 'Заметки игрока', fontSize: 12 };
    initial.identityFeatures = { key: paperIdentitySourceKey(initial), abilities: [{ type: 'effect', id: 'saved', name: 'Сохранённая особенность' }], traits: [] };
    let current!: PaperSheetDocument;
    let status!: ReturnType<typeof usePaperIdentityFeatures>;
    mocks.getEffect.mockImplementation(async (id: string) => { if (id === 'second') throw new Error('Network Error'); return effect(id); });
    function Harness() {
      const [doc, setDoc] = useState(initial); current = doc;
      const calculations = useMemo(() => calculateSheet(doc), [doc]);
      status = usePaperIdentityFeatures(doc, setDoc, calculations); return null;
    }
    await act(async () => root.render(<Harness />));
    expect(status.error).toContain('Не удалось обновить');
    expect(mocks.getEffect).toHaveBeenCalledWith('first');
    expect(mocks.getEffect).toHaveBeenCalledWith('second');
    expect(current.identityFeatures).toEqual(initial.identityFeatures);
    mocks.getEffect.mockImplementation(async (id: string) => effect(id));
    await act(async () => status.retry());
    expect(status.error).toBe('');
    expect(current.identityFeatures?.abilities.map(entry => entry.id)).toEqual(['first', 'second']);
    expect(current.sections).toEqual(initial.sections);
  });

  it('retains the canonical data-owned activation level gate', async () => {
    mocks.getEffect.mockImplementation(async (id: string) => ({ ...effect(id), ...(id === 'second' ? { mechanics: { activation: { requirements: [{ type: 'level', min_level: 3 }] } } } : {}) }));
    const draft = { ...emptyDraft(), classId: 'class', classLevels: { class: 1 } };
    expect((await loadPaperIdentityAssembly(draft)).effects.map(entry => entry.effect.id)).toEqual(['first']);
    expect((await loadPaperIdentityAssembly({ ...draft, level: 3, classLevels: { class: 3 } })).effects.map(entry => entry.effect.id)).toEqual(['first', 'second']);
  });

  it.each(['rejection', 'empty response'])('rejects an incomplete item expansion after a %s and succeeds on a fresh retry', async failure => {
    const items = [{ id: 'item', name: 'Предмет', mechanics: grants('first', 'second') }];
    mocks.getEffect.mockImplementation(async (id: string) => {
      if (id === 'second') {
        if (failure === 'rejection') throw new Error('Network Error');
        return null;
      }
      return effect(id);
    });
    await expect(loadPaperItemGrantedEffects(items, emptyDraft())).rejects.toThrow('Не все записи каталога');
    expect(mocks.getEffect).toHaveBeenCalledWith('first');
    expect(mocks.getEffect).toHaveBeenCalledWith('second');
    mocks.getEffect.mockImplementation(async (id: string) => effect(id));
    expect((await loadPaperItemGrantedEffects(items, emptyDraft())).map(entry => entry.id)).toEqual(['first', 'second']);
  });

  it('rejects a failed nested grant through the injected equipment loader and keeps canonical recursion on retry', async () => {
    const doc = createPaperSheet();
    const card: Card = { ...base, id: 'item', name: 'Предмет', type: 'cloak', card_number: 'item', properties: null, rarity: 'common', is_template: 'false', mechanics: grants('branch') };
    doc.fields['equipment.cloak'] = paperEntityToken({ type: 'card', id: card.id, name: card.name });
    const cards = new Map([[card.id, card]]);
    const before = JSON.stringify(doc);
    mocks.getEffect.mockImplementation(async (id: string) => {
      if (id === 'leaf') throw new Error('Network Error');
      return { ...effect(id), mechanics: grants('leaf') };
    });
    await expect(loadPaperEquipmentEffects(doc, cards, loadPaperItemGrantedEffects)).rejects.toThrow('Не все записи каталога');
    expect(mocks.getEffect).toHaveBeenCalledWith('branch');
    expect(mocks.getEffect).toHaveBeenCalledWith('leaf');
    mocks.getEffect.mockImplementation(async (id: string) => ({ ...effect(id), mechanics: id === 'branch' ? grants('leaf') : grants('branch') }));
    const snapshot = await loadPaperEquipmentEffects(doc, cards, loadPaperItemGrantedEffects);
    expect(snapshot.effects.map(entry => entry.id)).toEqual(['branch', 'leaf']);
    expect(JSON.stringify(doc)).toBe(before);
  });
});
