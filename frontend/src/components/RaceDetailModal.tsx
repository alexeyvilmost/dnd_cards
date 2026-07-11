import React from 'react';
import { Link } from 'react-router-dom';
import { Edit, Trash2 } from 'lucide-react';
import type { Race } from '../types';
import { FormattedText } from '../utils/formattedText';
import RacePreview from './RacePreview';
import { EntityDetailShell, EdmField, EdmFields, EdmDesc, EdmBlock } from './EntityDetailShell';

interface RaceDetailModalProps {
  race: Race | null;
  isOpen: boolean;
  onClose: () => void;
  onDelete: (id: string) => void;
}

const RaceDetailModal: React.FC<RaceDetailModalProps> = ({ race, isOpen, onClose, onDelete }) => {
  if (!isOpen || !race) return null;
  const r = race;
  const speed = [r.speed ? `${r.speed} фт` : '', r.extra_speeds || ''].filter(Boolean).join(', ');

  return (
    <EntityDetailShell
      isOpen={isOpen}
      onClose={onClose}
      title={r.name}
      preview={<RacePreview race={r} disableHover />}
      actions={(
        <>
          <Link to={`/race-creator?edit=${r.id}`} className="edm-btn">
            <Edit size={18} /><span>Редактировать</span>
          </Link>
          <button type="button" onClick={() => onDelete(r.id)} className="edm-btn edm-btn--danger">
            <Trash2 size={18} /><span>Удалить</span>
          </button>
        </>
      )}
    >
      <EdmDesc><FormattedText text={r.description || ''} emptyText="—" /></EdmDesc>

      <EdmFields>
        <EdmField label="Тип существа" hidden={!r.creature_type}>{r.creature_type}</EdmField>
        <EdmField label="Размер" hidden={!r.size}>{r.size}</EdmField>
        <EdmField label="Скорость" hidden={!speed}>{speed}</EdmField>
        <EdmField label="Тёмное зрение" hidden={!(r.darkvision != null && r.darkvision > 0)}>{r.darkvision} фт</EdmField>
        <EdmField label="ID вида" hidden={!r.card_number} mono>{r.card_number}</EdmField>
      </EdmFields>

      {r.traits && r.traits.length > 0 && (
        <EdmBlock label="Видовые особенности">
          {r.traits.map((t, i) => (
            <div key={i} style={{ marginBottom: 4 }}>
              <span style={{ color: '#f0d98a', fontWeight: 600 }}>{t.name}.</span> {t.description}
            </div>
          ))}
        </EdmBlock>
      )}

      {r.lineages && r.lineages.length > 0 && (
        <EdmBlock label="Происхождения / подвиды">
          {r.lineages.map((l, i) => (
            <div key={i} style={{ marginBottom: 4 }}>
              <span style={{ color: '#f0d98a', fontWeight: 600 }}>{l.name}.</span> {l.description}
            </div>
          ))}
        </EdmBlock>
      )}

      {r.detailed_description && (
        <EdmBlock label="Дополнительное описание"><FormattedText text={r.detailed_description} emptyText="" /></EdmBlock>
      )}
    </EntityDetailShell>
  );
};

export default RaceDetailModal;
