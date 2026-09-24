import { useEffect, useMemo, useRef, useState } from 'react';
import { cardsApi, spellsApi } from '../api/client';
import { EntityField } from './EntityField';
import { Dialog, usePaperSheet } from './controls';
import { paperLssSpells } from './lssExchange';
import HoverCard from '../components/HoverCard';
import SpellPreview from '../components/SpellPreview';
import type { PaperEntityType, PaperLibraryEntity } from './references';
import { applyPaperRowPatch, canApplyPaperRowPatch, preparedSpellPatch, weaponCardPatch, weaponSpellPatch, type PaperRowKind } from './rowAutofill';

export function AutofillEntityField({ kind, row, field, label, initialType = 'card' }: { kind: PaperRowKind; row: number; field: string; label: string; initialType?: PaperEntityType }) {
  const { doc, setDoc } = usePaperSheet();
  const latestDocument = useRef(doc);
  latestDocument.current = doc;
  const request = useRef(0);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [spellOpen, setSpellOpen] = useState(false);
  const lssSpell = useMemo(() => kind === 'preparedSpell' ? paperLssSpells(doc).find(s => s.id === doc.fields[`spellRow${row}LssId`]) : undefined, [doc.exchange?.spells, doc.fields[`spellRow${row}LssId`], kind, row]);
  useEffect(() => () => { request.current++; }, []);
  const select = async (entity: PaperLibraryEntity) => {
    const generation = ++request.current;
    const original = latestDocument.current;
    setMessage('');
    if (kind === 'preparedSpell' && entity.type !== 'spell') { setLoading(false); setMessage('Для этой строки выберите заклинание.'); return; }
    setLoading(true);
    try {
      const patch = entity.type === 'card'
        ? weaponCardPatch(row, await cardsApi.getCard(entity.id))
        : kind === 'preparedSpell' ? preparedSpellPatch(row, await spellsApi.getSpell(entity.id)) : weaponSpellPatch(row, await spellsApi.getSpell(entity.id));
      if (generation !== request.current) return;
      if (!canApplyPaperRowPatch(latestDocument.current, original, patch)) { setMessage('Строка изменена во время загрузки. Выберите запись ещё раз, чтобы заполнить её.'); return; }
      setDoc(current => canApplyPaperRowPatch(current, original, patch) ? applyPaperRowPatch(current, patch) : current);
      setMessage(patch.notice ?? '');
    } catch {
      if (generation === request.current) setMessage('Не удалось загрузить данные записи. Повторите выбор из библиотеки.');
    } finally {
      if (generation === request.current) setLoading(false);
    }
  };
  return <div className="ps-autofill-field" style={{ minWidth: 0, position: 'relative' }} aria-busy={loading}>
    <EntityField field={field} label={label} initialType={initialType} onSelect={entity => void select(entity)} />
    {lssSpell && <HoverCard content={<SpellPreview spell={lssSpell} disableHover />}><button type="button" className="ps-lss-preview" aria-label={`Описание LSS: ${lssSpell.name}`} onClick={() => setSpellOpen(true)}>LSS</button></HoverCard>}
    {spellOpen && lssSpell && <Dialog heading={lssSpell.name} onClose={() => setSpellOpen(false)}><SpellPreview spell={lssSpell} disableHover /></Dialog>}
    {loading && <span role="status" className="ps-autofill-status">Заполнение…</span>}
    {message && <span role="alert" className="ps-autofill-status">{message}</span>}
  </div>;
}
