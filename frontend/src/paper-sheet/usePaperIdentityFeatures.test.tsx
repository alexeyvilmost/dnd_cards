// @vitest-environment jsdom
import { act, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assemble, type AssembledCharacter } from '../character/assemble';
import { emptyDraft } from '../character/types';
import { calculateSheet, createPaperSheet, type PaperEquipmentProjection, type PaperSheetDocument } from './model';
import { paperIdentityEntries, paperIdentitySourceKey } from './identity';
import { usePaperIdentityFeatures } from './usePaperIdentityFeatures';

const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('./loadPaperIdentityAssembly', () => ({ loadPaperIdentityAssembly: mocks.load }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function assemblyFor(id: string): AssembledCharacter {
  return assemble({ race: null, klass: null, background: null, feats: [], actions: [], spells: [], effects: [{
    effect: { id, name: `Особенность ${id}`, card_number: id, description: '', effect_type: 'passive', rarity: 'common', created_at: '', updated_at: '' },
    origin: { kind: 'class', id: 'class', name: 'Класс' },
  }] }, emptyDraft());
}
function deferred() {
  let resolve!: (value: AssembledCharacter) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<AssembledCharacter>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

describe('paper identity feature synchronization', () => {
  let root: Root;
  let host: HTMLDivElement;
  let current: PaperSheetDocument;
  let setDocument: Dispatch<SetStateAction<PaperSheetDocument>>;
  let status: ReturnType<typeof usePaperIdentityFeatures>;
  beforeEach(() => { vi.clearAllMocks(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
  async function render(initial = createPaperSheet(), equipment?: PaperEquipmentProjection) {
    function Harness() {
      const [doc, setDoc] = useState(initial); current = doc; setDocument = setDoc;
      const calculations = useMemo(() => calculateSheet(doc, equipment), [doc]);
      status = usePaperIdentityFeatures(doc, setDoc, calculations);
      return null;
    }
    await act(async () => root.render(<Harness />));
  }

  it('replaces generated entries, preserves user notes, and does not reload for unrelated edits', async () => {
    const first = deferred(); mocks.load.mockReturnValueOnce(first.promise);
    const doc = createPaperSheet(); doc.identity = { classId: 'class', speciesId: 'species' };
    doc.sections.features = { text: 'Ручная запись', fontSize: 12 };
    await render(doc);
    expect(mocks.load).toHaveBeenCalledWith(expect.objectContaining({ classId: 'class', raceId: 'species', level: 1, classLevels: { class: 1 }, featIds: [] }));
    await act(async () => first.resolve(assemblyFor('first')));
    expect(current.identityFeatures?.abilities.map(entity => entity.id)).toEqual(['first']);
    await act(async () => setDocument(previous => ({ ...previous, sections: { ...previous.sections, features: { text: 'Новая ручная запись', fontSize: 12 } } })));
    expect(mocks.load).toHaveBeenCalledTimes(1);
    mocks.load.mockResolvedValueOnce(assemblyFor('first'));
    await act(async () => status.retry());
    expect(current.identityFeatures?.abilities).toHaveLength(1);
    expect(current.sections.features.text).toBe('Новая ручная запись');
  });

  it('ignores stale assembly responses when the identity or level has changed', async () => {
    const old = deferred(); const next = deferred();
    mocks.load.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const doc = createPaperSheet(); doc.identity = { classId: 'old' };
    await render(doc);
    await act(async () => setDocument(previous => ({ ...previous, identity: { classId: 'next' }, fields: { ...previous.fields, level: '3' } })));
    await act(async () => old.resolve(assemblyFor('stale')));
    expect(current.identityFeatures).toBeUndefined();
    await act(async () => next.resolve(assemblyFor('current')));
    expect(current.identityFeatures?.abilities.map(entity => entity.id)).toEqual(['current']);
    expect(current.identityFeatures?.key).toBe(paperIdentitySourceKey(current));
  });

  it('keeps a matching offline snapshot after failure, hides it for changed inputs, and reports invalid levels', async () => {
    mocks.load.mockRejectedValue(new Error('Network Error'));
    const doc = createPaperSheet(); doc.identity = { classId: 'class' };
    doc.identityFeatures = { key: paperIdentitySourceKey(doc), abilities: [{ type: 'effect', id: 'saved', name: 'Сохранённая особенность' }], traits: [] };
    await render(doc);
    expect(status.error).toContain('Не удалось обновить');
    expect(paperIdentityEntries(current, 'features').map(entity => entity.id)).toEqual(['saved']);
    await act(async () => setDocument(previous => ({ ...previous, fields: { ...previous.fields, level: '2' } })));
    expect(paperIdentityEntries(current, 'features')).toEqual([]);
    expect(current.identityFeatures).toEqual(doc.identityFeatures);
    await act(async () => setDocument(previous => ({ ...previous, fields: { ...previous.fields, level: 'не число' } })));
    expect(status.error).toContain('целый уровень');
    expect(mocks.load).toHaveBeenCalledTimes(2);
  });

  it('clears only generated metadata when all selected identities become free text', async () => {
    const pending = deferred(); mocks.load.mockReturnValueOnce(pending.promise);
    const doc = createPaperSheet(); doc.identity = { classId: 'class' };
    doc.sections.traits = { text: 'Самописная черта', fontSize: 11 };
    doc.identityFeatures = { key: paperIdentitySourceKey(doc), abilities: [], traits: [{ type: 'feat', id: 'old', name: 'Автоматическая черта' }] };
    await render(doc);
    await act(async () => setDocument(previous => ({ ...previous, identity: {} })));
    await act(async () => pending.resolve(assemblyFor('late')));
    expect(current.identityFeatures).toBeUndefined();
    expect(current.sections).toEqual(doc.sections);
  });

  it('uses the effective calculation key when level is a formula referencing equipment-adjusted abilities', async () => {
    const doc = createPaperSheet(); doc.identity = { classId: 'class' }; doc.fields.level = '=[STR]';
    const equipment = { abilityScores: { str: 16 } };
    mocks.load.mockResolvedValueOnce(assemblyFor('effective'));
    await render(doc, equipment);
    expect(mocks.load).toHaveBeenCalledWith(expect.objectContaining({ level: 3 }));
    expect(current.identityFeatures?.key).toBe(paperIdentitySourceKey(current, calculateSheet(current, equipment)));
    expect(paperIdentityEntries(current, 'features', calculateSheet(current, equipment)).map(entry => entry.id)).toEqual(['effective']);
  });
});
