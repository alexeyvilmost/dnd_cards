import React from 'react';
import { Link } from 'react-router-dom';
import { Edit, Trash2 } from 'lucide-react';
import type { ResourceDefinition } from '../types';
import { FormattedText } from '../utils/formattedText';
import ResourcePreview, { resourceCategoryLabel, resourceRechargeLabel } from './ResourcePreview';
import { EntityDetailShell, EdmField, EdmFields, EdmDesc } from './EntityDetailShell';

interface ResourceDetailModalProps {
  resource: ResourceDefinition | null;
  isOpen: boolean;
  onClose: () => void;
  onDelete: (resourceId: string) => void;
}

const ResourceDetailModal: React.FC<ResourceDetailModalProps> = ({ resource, isOpen, onClose, onDelete }) => {
  if (!isOpen || !resource) return null;

  return (
    <EntityDetailShell
      isOpen={isOpen}
      onClose={onClose}
      title={resource.name}
      titleEn={resource.name_en}
      preview={<ResourcePreview resource={resource} disableHover />}
      actions={(
        <>
          <Link to={`/resource-creator?edit=${resource.resource_id}`} className="edm-btn">
            <Edit size={18} /><span>Редактировать</span>
          </Link>
          <button type="button" onClick={() => onDelete(resource.resource_id)} className="edm-btn edm-btn--danger">
            <Trash2 size={18} /><span>Удалить</span>
          </button>
        </>
      )}
    >
      <EdmDesc><FormattedText text={resource.description || ''} emptyText="—" /></EdmDesc>

      <EdmFields>
        <EdmField label="Категория">{resourceCategoryLabel(resource.category)}</EdmField>
        <EdmField label="Восстановление">{resourceRechargeLabel(resource.recharge)}</EdmField>
        <EdmField label="ID ресурса" mono>{resource.resource_id}</EdmField>
      </EdmFields>
    </EntityDetailShell>
  );
};

export default ResourceDetailModal;
