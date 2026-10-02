// @vitest-environment jsdom
import { act, useMemo, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyDraft } from '../character/types';
import { calculateSheet, createPaperSheet, type PaperSheetDocument } from './model';
import { paperIdentitySourceKey } from './identity';
import { usePaperIdentityFeatures } from './usePaperIdentityFeatures';
import { loadPaperIdentityAssembly } from './loadPaperIdentityAssembly';

const mocks = vi.hoisted(() => ({ getClass: vi.fn(), getEffect: vi.fn(), variables: vi.fn() }));
vi.mock('../api/client', () => ({
  classesApi: { getClass: mocks.getClass }, effectsApi: { getEffect: mocks.getEffect, getEffects: vi.fn() },
  variablesApi: { getVariables: mocks.variables }, racesApi: { getRace: vi.fn() }, backgroundsApi: { getBackground: vi.fn() },
  actionsApi: { getAction: vi.fn() }, featsApi: { getFeat: vi.fn() }, spellsApi: { getSpell: vi.fn() }, resourcesApi: { getResource: vi.fn() },
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const base = { name: 'Запись', description: '', rarity: 'common', created_at: '', updated_at: '' };
const effect = (id: string) => ({ ...base, id, card_number: id, name: `Особенность ${id}`, effect_type: 'passive' });

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
});
