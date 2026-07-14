import React from 'react';
import { Link } from 'react-router-dom';
import { Edit, Trash2 } from 'lucide-react';
import type { Concept } from '../types';
import { FormattedText } from '../utils/formattedText';
import ConceptPreview from './ConceptPreview';
import { EntityDetailShell, EdmField, EdmFields, EdmDesc } from './EntityDetailShell';

interface ConceptDetailModalProps {
  concept: Concept | null;
  isOpen: boolean;
  onClose: () => void;
  onDelete: (conceptId: string) => void;
}

const ConceptDetailModal: React.FC<ConceptDetailModalProps> = ({ concept, isOpen, onClose, onDelete }) => {
  if (!isOpen || !concept) return null;

  return (
    <EntityDetailShell
      isOpen={isOpen}
      onClose={onClose}
      title={concept.name}
      titleEn={concept.name_en}
      preview={<ConceptPreview concept={concept} disableHover />}
      actions={(
        <>
          <Link to={`/concept-creator?edit=${concept.concept_id}`} className="edm-btn">
            <Edit size={18} /><span>Редактировать</span>
          </Link>
          <button type="button" onClick={() => onDelete(concept.concept_id)} className="edm-btn edm-btn--danger">
            <Trash2 size={18} /><span>Удалить</span>
          </button>
        </>
      )}
    >
      <EdmDesc><FormattedText text={concept.description || ''} emptyText="—" /></EdmDesc>

      <EdmFields>
        <EdmField label="ID понятия" mono>{concept.concept_id}</EdmField>
      </EdmFields>
    </EntityDetailShell>
  );
};

export default ConceptDetailModal;
