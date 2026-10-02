import { useState } from 'react';
import { BookOpen, Unlink } from 'lucide-react';
import { Field, usePaperSheet } from './controls';
import { EntityName } from './EntityName';
import { LibraryPicker } from './LibraryPicker';
import { PAPER_ENTITY_TYPES, paperEntityToken, parsePaperEntityToken, type PaperEntityType, type PaperLibraryEntity } from './references';

export function EntityField({ field, label, initialType = 'card', allowedTypes = PAPER_ENTITY_TYPES, onSelect, onUnlink }: { field: string; label: string; initialType?: PaperEntityType; allowedTypes?: readonly PaperEntityType[]; onSelect?: (entity: PaperLibraryEntity) => void; onUnlink?: () => void }) {
  const { doc, setField } = usePaperSheet();
  const [picking, setPicking] = useState(false);
  const [selectionError, setSelectionError] = useState('');
  const entity = parsePaperEntityToken(doc.fields[field] ?? '');
  return <div className="ps-entity-field" data-paper-field={field} data-paper-label={label}>
    {entity ? <EntityName entity={entity} /> : <Field field={field} label={label} />}
    <div className="ps-entity-field-tools">
      {entity && <button type="button" aria-label={`Убрать ссылку: ${label}`} onClick={() => { if (onUnlink) onUnlink(); else setField(field, entity.name); }}><Unlink size={10} /></button>}
      <button type="button" aria-label={`Из библиотеки: ${label}`} onClick={() => { setSelectionError(''); setPicking(true); }}><BookOpen size={11} /></button>
    </div>
    {selectionError && <span role="alert" className="ps-autofill-status">{selectionError}</span>}
    {picking && <LibraryPicker initialType={entity?.type ?? initialType} allowedTypes={allowedTypes} onClose={() => setPicking(false)} onSelect={selected => {
      if (!allowedTypes.includes(selected.type)) {
        setSelectionError(allowedTypes.length === 1 && allowedTypes[0] === 'spell' ? 'Для этого поля выберите заклинание.' : allowedTypes.length === 1 && allowedTypes[0] === 'card' ? 'Для этого поля выберите предмет.' : 'Этот тип записи недоступен для поля.');
        setPicking(false);
        return;
      }
      if (onSelect) onSelect(selected); else setField(field, paperEntityToken(selected));
      setSelectionError(''); setPicking(false);
    }} />}
  </div>;
}
