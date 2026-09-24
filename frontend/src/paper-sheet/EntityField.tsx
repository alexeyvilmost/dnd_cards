import { useState } from 'react';
import { BookOpen, Unlink } from 'lucide-react';
import { Field, usePaperSheet } from './controls';
import { EntityName } from './EntityName';
import { LibraryPicker } from './LibraryPicker';
import { paperEntityToken, parsePaperEntityToken, type PaperEntityType, type PaperLibraryEntity } from './references';

export function EntityField({ field, label, initialType = 'card', onSelect, onUnlink }: { field: string; label: string; initialType?: PaperEntityType; onSelect?: (entity: PaperLibraryEntity) => void; onUnlink?: () => void }) {
  const { doc, setField } = usePaperSheet();
  const [picking, setPicking] = useState(false);
  const entity = parsePaperEntityToken(doc.fields[field] ?? '');
  return <div className="ps-entity-field" data-paper-field={field} data-paper-label={label}>
    {entity ? <EntityName entity={entity} /> : <Field field={field} label={label} />}
    <div className="ps-entity-field-tools">
      {entity && <button type="button" aria-label={`Убрать ссылку: ${label}`} onClick={() => { if (onUnlink) onUnlink(); else setField(field, entity.name); }}><Unlink size={10} /></button>}
      <button type="button" aria-label={`Из библиотеки: ${label}`} onClick={() => setPicking(true)}><BookOpen size={11} /></button>
    </div>
    {picking && <LibraryPicker initialType={entity?.type ?? initialType} onClose={() => setPicking(false)} onSelect={selected => { if (onSelect) onSelect(selected); else setField(field, paperEntityToken(selected)); setPicking(false); }} />}
  </div>;
}
