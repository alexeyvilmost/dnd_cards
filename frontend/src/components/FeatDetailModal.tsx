import React from 'react';
import { Link } from 'react-router-dom';
import { Edit, Trash2 } from 'lucide-react';
import type { Feat } from '../types';
import { getFeatCategoryLabel, getAbilityLabel } from '../types';
import { featsApi } from '../api/client';
import { FormattedText } from '../utils/formattedText';
import FeatPreview from './FeatPreview';
import EntityImageEditor, { ICON_EXTRA } from './EntityImageEditor';
import { EntityDetailShell, EdmField, EdmFields, EdmDesc, EdmBlock, EdmTag } from './EntityDetailShell';

interface FeatDetailModalProps {
  feat: Feat | null;
  isOpen: boolean;
  onClose: () => void;
  onDelete: (id: string) => void;
  onUpdated?: () => void;
}

const FeatDetailModal: React.FC<FeatDetailModalProps> = ({ feat, isOpen, onClose, onDelete, onUpdated }) => {
  if (!isOpen || !feat) return null;

  const abilityText = feat.ability_increase && feat.ability_increase.length > 0
    ? `${feat.ability_increase.map(getAbilityLabel).join(', ')} +1`
    : null;

  return (
    <EntityDetailShell
      isOpen={isOpen}
      onClose={onClose}
      title={feat.name}
      titleEn={feat.name_en}
      preview={(
        <EntityImageEditor
          entityId={feat.id}
          initialUrl={feat.image_url || ''}
          persist={async (id, url) => (await featsApi.updateFeat(id, { image_url: url })).image_url || url}
          generateReq={{ style: 'spell_icon', subject: feat.name, quality: 'medium', extra: ICON_EXTRA }}
          renderPreview={(url) => <FeatPreview feat={{ ...feat, image_url: url }} disableHover />}
          onUpdated={() => onUpdated?.()}
        />
      )}
      actions={(
        <>
          <Link to={`/feat-creator?edit=${feat.id}`} className="edm-btn">
            <Edit size={18} /><span>Редактировать</span>
          </Link>
          <button type="button" onClick={() => onDelete(feat.id)} className="edm-btn edm-btn--danger">
            <Trash2 size={18} /><span>Удалить</span>
          </button>
        </>
      )}
    >
      <EdmDesc><FormattedText text={feat.description || ''} emptyText="—" /></EdmDesc>

      {feat.repeatable && (
        <div className="edm-tags"><EdmTag>Повторяемая</EdmTag></div>
      )}

      <EdmFields>
        <EdmField label="Категория">{getFeatCategoryLabel(feat.category)}</EdmField>
        <EdmField label="Требования" hidden={!feat.prerequisite}>{feat.prerequisite}</EdmField>
        <EdmField label="Повышение характеристики" hidden={!abilityText}>{abilityText}</EdmField>
        <EdmField label="ID черты" hidden={!feat.card_number} mono>{feat.card_number}</EdmField>
      </EdmFields>

      {feat.detailed_description && (
        <EdmBlock label="Дополнительное описание"><FormattedText text={feat.detailed_description} emptyText="" /></EdmBlock>
      )}
    </EntityDetailShell>
  );
};

export default FeatDetailModal;
