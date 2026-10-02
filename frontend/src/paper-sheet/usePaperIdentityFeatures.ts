import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { loadPaperIdentityAssembly } from './loadPaperIdentityAssembly';
import type { PaperSheetDocument, SheetCalculation } from './model';
import { paperIdentityDraft, paperIdentitySourceKey, projectPaperIdentityFeatures } from './identity';

const calculationInputs = (doc: PaperSheetDocument) => JSON.stringify([doc.identity, doc.fields, doc.training, doc.checks]);

/** Generation replaces only its own snapshot; editor text and unrelated state stay untouched. */
export function usePaperIdentityFeatures(doc: PaperSheetDocument, setDoc: Dispatch<SetStateAction<PaperSheetDocument>>, calculations: SheetCalculation) {
  const key = paperIdentitySourceKey(doc, calculations);
  const [status, setStatus] = useState({ key: '', loading: false, error: '' });
  const [attempt, setAttempt] = useState(0);
  const latest = useRef({ doc, calculations });
  latest.current = { doc, calculations };

  useEffect(() => {
    let current = true;
    const snapshot = latest.current;
    const draft = paperIdentityDraft(snapshot.doc, snapshot.calculations);
    if (!snapshot.doc.identity || !Object.values(snapshot.doc.identity).some(Boolean)) {
      setStatus({ key, loading: false, error: '' });
      setDoc(previous => !Object.values(previous.identity ?? {}).some(Boolean) && previous.identityFeatures ? { ...previous, identityFeatures: undefined } : previous);
      return;
    }
    if (!draft) {
      setStatus({ key, loading: false, error: 'Для автоматических особенностей укажите целый уровень от 1 до 20.' });
      return;
    }
    setStatus({ key, loading: true, error: '' });
    void loadPaperIdentityAssembly(draft).then(assembly => {
      if (!current) return;
      const projected = projectPaperIdentityFeatures(assembly, key);
      setDoc(previous => {
        // calculations may contain effective equipment values; recalculating
        // without that projection would reject valid formula-based levels.
        if (paperIdentitySourceKey(latest.current.doc, latest.current.calculations) !== key
          || calculationInputs(previous) !== calculationInputs(latest.current.doc)
          || JSON.stringify(previous.identityFeatures) === JSON.stringify(projected)) return previous;
        return { ...previous, identityFeatures: projected };
      });
      setStatus({ key, loading: false, error: '' });
    }).catch(() => {
      if (current) setStatus({ key, loading: false, error: 'Не удалось обновить особенности. Сохранённые данные не изменены; повторите загрузку.' });
    });
    return () => { current = false; };
  }, [key, attempt, setDoc]);

  return {
    loading: status.key !== key || status.loading,
    error: status.key === key ? status.error : '',
    retry: () => setAttempt(value => value + 1),
  };
}
