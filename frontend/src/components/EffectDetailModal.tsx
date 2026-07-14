import React from 'react';
import { Link } from 'react-router-dom';
import { Edit, Trash2, Copy } from 'lucide-react';
import type { PassiveEffect } from '../types';
import { PASSIVE_EFFECT_TYPE_OPTIONS } from '../types';
import { effectsApi } from '../api/client';
import { FormattedText } from '../utils/formattedText';
import EffectPreview from './EffectPreview';
import EntityImageEditor, { ICON_EXTRA } from './EntityImageEditor';
import { EntityDetailShell, EdmField, EdmFields, EdmDesc, EdmBlock } from './EntityDetailShell';

interface EffectDetailModalProps {
  effect: PassiveEffect | null;
  isOpen: boolean;
  onClose: () => void;
  onDelete: (effectId: string) => void;
  onUpdated?: () => void;
}

const EffectDetailModal: React.FC<EffectDetailModalProps> = ({
  effect,
  isOpen,
  onClose,
  onDelete,
  onUpdated,
}) => {
  if (!isOpen || !effect) return null;

  const typeLabel = PASSIVE_EFFECT_TYPE_OPTIONS.find((o) => o.value === effect.effect_type)?.label || effect.effect_type;

  return (
    <EntityDetailShell
      isOpen={isOpen}
      onClose={onClose}
      title={effect.name}
      titleEn={effect.name_en}
      preview={(
        <EntityImageEditor
          entityId={effect.id}
          initialUrl={effect.image_url || ''}
          persist={async (id, url) => (await effectsApi.updateEffect(id, { image_url: url })).image_url || url}
          generateReq={{ style: 'spell_icon', subject: effect.name, quality: 'medium', extra: ICON_EXTRA }}
          renderPreview={(url) => <EffectPreview effect={{ ...effect, image_url: url }} disableHover />}
          onUpdated={() => onUpdated?.()}
        />
      )}
      actions={(
        <>
          <Link to={`/effect-creator?edit=${effect.id}`} className="edm-btn">
            <Edit size={18} /><span>Редактировать</span>
          </Link>
          <Link to={`/effect-creator?template_id=${effect.id}`} className="edm-btn">
            <Copy size={18} /><span>Использовать как шаблон</span>
          </Link>
          <button type="button" onClick={() => onDelete(effect.id)} className="edm-btn edm-btn--danger">
            <Trash2 size={18} /><span>Удалить</span>
          </button>
        </>
      )}
    >
      <EdmDesc><FormattedText text={effect.description || ''} emptyText="—" /></EdmDesc>

      <EdmFields>
        <EdmField label="Тип эффекта">{typeLabel}</EdmField>
        <EdmField label="Условие" hidden={!effect.condition_description}>{effect.condition_description}</EdmField>
        <EdmField label="Автор" hidden={!effect.author}>{effect.author}</EdmField>
        <EdmField label="Источник" hidden={!effect.source}>{effect.source}</EdmField>
        <EdmField label="ID эффекта" hidden={!effect.card_number} mono>{effect.card_number}</EdmField>
      </EdmFields>

      {effect.detailed_description && (
        <EdmBlock label="Детальное описание"><FormattedText text={effect.detailed_description} emptyText="" /></EdmBlock>
      )}
    </EntityDetailShell>
  );
};

export default EffectDetailModal;
