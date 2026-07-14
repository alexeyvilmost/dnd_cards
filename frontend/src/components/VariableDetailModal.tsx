import React from 'react';
import { Link } from 'react-router-dom';
import { Edit, Trash2 } from 'lucide-react';
import type { Variable } from '../types';
import { FormattedText } from '../utils/formattedText';
import VariablePreview, { variableTypeLabel } from './VariablePreview';
import { EntityDetailShell, EdmField, EdmFields, EdmDesc, EdmBlock } from './EntityDetailShell';

interface VariableDetailModalProps {
  variable: Variable | null;
  isOpen: boolean;
  onClose: () => void;
  onDelete: (variableId: string) => void;
}

const VariableDetailModal: React.FC<VariableDetailModalProps> = ({ variable, isOpen, onClose, onDelete }) => {
  if (!isOpen || !variable) return null;

  return (
    <EntityDetailShell
      isOpen={isOpen}
      onClose={onClose}
      title={variable.name}
      titleEn={variable.name_en}
      preview={<VariablePreview variable={variable} disableHover />}
      actions={(
        <>
          <Link to={`/variable-creator?edit=${variable.variable_id}`} className="edm-btn">
            <Edit size={18} /><span>Редактировать</span>
          </Link>
          <button type="button" onClick={() => onDelete(variable.variable_id)} className="edm-btn edm-btn--danger">
            <Trash2 size={18} /><span>Удалить</span>
          </button>
        </>
      )}
    >
      <EdmDesc><FormattedText text={variable.description || ''} emptyText="—" /></EdmDesc>

      <EdmFields>
        <EdmField label="Тип">{variableTypeLabel(variable.var_type)}</EdmField>
        <EdmField label="По умолчанию" mono>{variable.default_value || '—'}</EdmField>
        <EdmField label="ID переменной" mono>{variable.variable_id}</EdmField>
      </EdmFields>

      <EdmBlock label="Откуда берётся значение">
        Значение на персонаже задают эффекты (payload <code>variable</code>, op set/add/remove),
        обычно привязанные к уровням класса. «По умолчанию» — только запасной вариант,
        если ни один эффект переменную не задал.
      </EdmBlock>
    </EntityDetailShell>
  );
};

export default VariableDetailModal;
