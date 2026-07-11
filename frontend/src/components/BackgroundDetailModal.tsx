import React from 'react';
import { Link } from 'react-router-dom';
import { Edit, Trash2 } from 'lucide-react';
import type { Background, CardRef } from '../types';
import { getAbilityLabel } from '../types';
import { FormattedText } from '../utils/formattedText';
import BackgroundPreview from './BackgroundPreview';
import { RelatedCardsList } from './RelatedItems';
import { EntityDetailShell, EdmField, EdmFields, EdmDesc, EdmBlock } from './EntityDetailShell';

interface BackgroundDetailModalProps {
  background: Background | null;
  isOpen: boolean;
  onClose: () => void;
  onDelete: (id: string) => void;
}

const BackgroundDetailModal: React.FC<BackgroundDetailModalProps> = ({ background, isOpen, onClose, onDelete }) => {
  if (!isOpen || !background) return null;
  const b = background;

  const opts = b.equipment_options;
  const optionRefs: CardRef[] = (() => {
    if (!opts) return [];
    const seen = new Set<string>();
    return [...(opts.option_a?.items || []), ...(opts.option_b?.items || [])]
      .filter((r) => (seen.has(r.card_id) ? false : (seen.add(r.card_id), true)));
  })();

  return (
    <EntityDetailShell
      isOpen={isOpen}
      onClose={onClose}
      title={b.name}
      preview={<BackgroundPreview background={b} disableHover />}
      actions={(
        <>
          <Link to={`/background-creator?edit=${b.id}`} className="edm-btn">
            <Edit size={18} /><span>Редактировать</span>
          </Link>
          <button type="button" onClick={() => onDelete(b.id)} className="edm-btn edm-btn--danger">
            <Trash2 size={18} /><span>Удалить</span>
          </button>
        </>
      )}
    >
      <EdmDesc><FormattedText text={b.description || ''} emptyText="—" /></EdmDesc>

      <EdmFields>
        <EdmField label="Характеристики" hidden={!(b.ability_scores && b.ability_scores.length > 0)}>
          {(b.ability_scores || []).map(getAbilityLabel).join(', ')}
        </EdmField>
        <EdmField label="Черта происхождения" hidden={!b.origin_feat}>{b.origin_feat}</EdmField>
        <EdmField label="Владение навыками" hidden={!(b.skill_proficiencies && b.skill_proficiencies.length > 0)}>
          {(b.skill_proficiencies || []).join(', ')}
        </EdmField>
        <EdmField label="Владение инструментами" hidden={!b.tool_proficiency}>{b.tool_proficiency}</EdmField>
        <EdmField label="ID предыстории" hidden={!b.card_number} mono>{b.card_number}</EdmField>
      </EdmFields>

      {b.equipment && (
        <EdmBlock label="Снаряжение"><FormattedText text={b.equipment} emptyText="" /></EdmBlock>
      )}

      {opts && (
        <EdmBlock label="Варианты снаряжения">
          <div>Вариант А: предметы ниже + <span style={{ color: '#e8c877', fontWeight: 600 }}>{opts.option_a?.gold || 0} ЗМ</span></div>
          <div>Вариант Б: <span style={{ color: '#e8c877', fontWeight: 600 }}>{opts.option_b?.gold || 0} ЗМ</span>{(opts.option_b?.items?.length || 0) > 0 ? ' + предметы' : ''}</div>
          {optionRefs.length > 0 && <div className="edm-related" style={{ marginTop: 8 }}><RelatedCardsList refs={optionRefs} /></div>}
        </EdmBlock>
      )}

      {b.detailed_description && (
        <EdmBlock label="Дополнительное описание"><FormattedText text={b.detailed_description} emptyText="" /></EdmBlock>
      )}
    </EntityDetailShell>
  );
};

export default BackgroundDetailModal;
