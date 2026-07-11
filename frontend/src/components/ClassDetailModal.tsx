import { Link } from 'react-router-dom';
import { Edit, Trash2 } from 'lucide-react';
import type { CharacterClass } from '../types';
import { FormattedText } from '../utils/formattedText';
import ClassPreview from './ClassPreview';
import { EntityDetailShell, EdmField, EdmFields, EdmDesc, EdmBlock } from './EntityDetailShell';

interface ClassDetailModalProps {
  characterClass: CharacterClass | null;
  isOpen: boolean;
  onClose: () => void;
  onDelete: (id: string) => void;
}

const ClassDetailModal = ({ characterClass, isOpen, onClose, onDelete }: ClassDetailModalProps) => {
  if (!isOpen || !characterClass) return null;
  const cl = characterClass;

  return (
    <EntityDetailShell
      isOpen={isOpen}
      onClose={onClose}
      title={cl.name}
      preview={<ClassPreview characterClass={cl} disableHover />}
      actions={(
        <>
          <Link to={`/class-creator?edit=${cl.id}`} className="edm-btn">
            <Edit size={18} /><span>Редактировать</span>
          </Link>
          <button type="button" onClick={() => onDelete(cl.id)} className="edm-btn edm-btn--danger">
            <Trash2 size={18} /><span>Удалить</span>
          </button>
        </>
      )}
    >
      <EdmDesc><FormattedText text={cl.description || ''} emptyText="—" /></EdmDesc>

      <EdmFields>
        <EdmField label="Кость хитов" hidden={!cl.hit_die}>{cl.hit_die}</EdmField>
        <EdmField label="Основные характеристики" hidden={!(cl.primary_abilities && cl.primary_abilities.length > 0)}>
          {(cl.primary_abilities || []).join(', ')}
        </EdmField>
        <EdmField label="Спасброски" hidden={!(cl.saving_throws && cl.saving_throws.length > 0)}>
          {(cl.saving_throws || []).join(', ')}
        </EdmField>
        <EdmField label="ID класса" hidden={!cl.card_number} mono>{cl.card_number}</EdmField>
      </EdmFields>

      {cl.detailed_description && (
        <EdmBlock label="Дополнительное описание"><FormattedText text={cl.detailed_description} emptyText="" /></EdmBlock>
      )}
    </EntityDetailShell>
  );
};

export default ClassDetailModal;
