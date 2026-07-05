import React from 'react';
import type { Race } from '../types';
import { FormattedText } from '../utils/formattedText';
import Bg3Card from './Bg3Card';

interface RacePreviewProps {
  race: Race;
  parentRaceName?: string;
  className?: string;
  disableHover?: boolean;
  onClick?: () => void;
}

const RacePreview: React.FC<RacePreviewProps> = ({ race, parentRaceName, className = '', disableHover = false, onClick }) => {
  const isSubrace = !!race.is_subrace;
  const subtype = isSubrace
    ? (parentRaceName ? `Подвид · ${parentRaceName}` : 'Подвид')
    : 'Вид';

  const speedParts: string[] = [];
  if (!isSubrace && race.speed) speedParts.push(`${race.speed} фт`);
  if (!isSubrace && race.extra_speeds) speedParts.push(race.extra_speeds);
  const speed = speedParts.join(', ');

  return (
    <Bg3Card
      title={race.name || 'Название вида'}
      subtype={subtype}
      imageUrl={race.image_url}
      disableHover={disableHover}
      onClick={onClick}
      className={className}
    >
      <div className="bg3-stats">
        {!isSubrace && race.creature_type && (
          <div className="bg3-srow"><span className="bg3-lbl">Тип:</span><span className="bg3-val">{race.creature_type}</span></div>
        )}
        {!isSubrace && race.size && (
          <div className="bg3-srow"><span className="bg3-lbl">Размер:</span><span className="bg3-val">{race.size}</span></div>
        )}
        {speed && (
          <div className="bg3-srow"><span className="bg3-lbl">Скорость:</span><span className="bg3-val">{speed}</span></div>
        )}
        {race.darkvision != null && race.darkvision > 0 && (
          <div className="bg3-srow"><span className="bg3-lbl">Тёмное зрение:</span><span className="bg3-val">{race.darkvision} фт</span></div>
        )}
      </div>

      {race.description && (
        <div className="bg3-desc">
          <FormattedText text={race.description} emptyText="Описание вида" />
        </div>
      )}

      {race.traits && race.traits.length > 0 && (
        <div className="bg3-extra">
          {race.traits.map((t, i) => (
            <div key={i} style={{ marginBottom: 6 }}>
              <span style={{ color: '#e7cf9a', fontWeight: 600 }}>{t.name}. </span>
              <FormattedText text={t.description} emptyText="" />
            </div>
          ))}
        </div>
      )}

      {race.lineages && race.lineages.length > 0 && (
        <div className="bg3-extra">
          <span style={{ color: '#c9a227', fontWeight: 600 }}>Происхождения: </span>
          {race.lineages.map((l) => l.name).join(', ')}
        </div>
      )}

      {race.detailed_description && (
        <div className="bg3-extra">
          <FormattedText text={race.detailed_description} emptyText="" />
        </div>
      )}
    </Bg3Card>
  );
};

export default RacePreview;
