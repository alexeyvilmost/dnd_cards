import React from 'react';
import { Link } from 'react-router-dom';
import { Edit, Trash2, Copy } from 'lucide-react';
import type { Action } from '../types';
import { ACTION_RECHARGE_OPTIONS, ACTION_TYPE_OPTIONS } from '../types';
import { actionsApi } from '../api/client';
import { resourceIcon, resourceLabel, useResourceOptions } from '../utils/resources';
import { FormattedText } from '../utils/formattedText';
import ActionPreview from './ActionPreview';
import EntityImageEditor, { ICON_EXTRA } from './EntityImageEditor';
import { EntityDetailShell, EdmField, EdmFields, EdmDesc, EdmBlock } from './EntityDetailShell';

interface ActionDetailModalProps {
  action: Action | null;
  isOpen: boolean;
  onClose: () => void;
  onDelete: (actionId: string) => void;
  onUpdated?: () => void;
}

const ActionDetailModal: React.FC<ActionDetailModalProps> = ({
  action,
  isOpen,
  onClose,
  onDelete,
  onUpdated,
}) => {
  const resources = useResourceOptions();

  if (!isOpen || !action) return null;

  const typeLabel = ACTION_TYPE_OPTIONS.find((o) => o.value === action.action_type)?.label || action.action_type;
  const rechargeLabel = action.recharge
    ? (ACTION_RECHARGE_OPTIONS.find((o) => o.value === action.recharge)?.label || action.recharge)
      + (action.recharge === 'custom' && action.recharge_custom ? ` (${action.recharge_custom})` : '')
    : null;

  const resourceIds = action.resources && action.resources.length > 0
    ? action.resources
    : (action.resource ? [action.resource] : []);

  return (
    <EntityDetailShell
      isOpen={isOpen}
      onClose={onClose}
      title={action.name}
      preview={(
        <EntityImageEditor
          entityId={action.id}
          initialUrl={action.image_url || ''}
          persist={async (id, url) => (await actionsApi.updateAction(id, { image_url: url })).image_url || url}
          generateReq={{ style: 'spell_icon', subject: action.name, quality: 'medium', extra: ICON_EXTRA }}
          renderPreview={(url) => <ActionPreview action={{ ...action, image_url: url }} disableHover resources={resources} />}
          onUpdated={() => onUpdated?.()}
        />
      )}
      actions={(
        <>
          <Link to={`/action-creator?edit=${action.id}`} className="edm-btn">
            <Edit size={18} /><span>Редактировать</span>
          </Link>
          <Link to={`/action-creator?template_id=${action.id}`} className="edm-btn">
            <Copy size={18} /><span>Использовать как шаблон</span>
          </Link>
          <button type="button" onClick={() => onDelete(action.id)} className="edm-btn edm-btn--danger">
            <Trash2 size={18} /><span>Удалить</span>
          </button>
        </>
      )}
    >
      <EdmDesc><FormattedText text={action.description || ''} emptyText="—" /></EdmDesc>

      <EdmFields>
        <EdmField label="Тип действия">{typeLabel}</EdmField>
        <EdmField label="Ресурсы" hidden={resourceIds.length === 0}>
          <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: '4px 12px', verticalAlign: 'middle' }}>
            {resourceIds.map((id) => (
              <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <img
                  src={resourceIcon(resources, id)}
                  alt=""
                  style={{ width: 16, height: 16, objectFit: 'contain' }}
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                />
                {resourceLabel(resources, id)}
              </span>
            ))}
          </span>
        </EdmField>
        <EdmField label="Дальность" hidden={!action.distance}>{action.distance}</EdmField>
        <EdmField label="Перезарядка" hidden={!rechargeLabel}>{rechargeLabel}</EdmField>
        <EdmField label="Автор" hidden={!action.author}>{action.author}</EdmField>
        <EdmField label="Источник" hidden={!action.source}>{action.source}</EdmField>
        <EdmField label="ID действия" hidden={!action.card_number} mono>{action.card_number}</EdmField>
      </EdmFields>

      {action.detailed_description && (
        <EdmBlock label="Детальное описание"><FormattedText text={action.detailed_description} emptyText="" /></EdmBlock>
      )}
    </EntityDetailShell>
  );
};

export default ActionDetailModal;
