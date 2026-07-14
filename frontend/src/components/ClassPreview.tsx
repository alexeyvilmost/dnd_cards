import React from 'react';
import type { CharacterClass } from '../types';
import { FormattedText } from '../utils/formattedText';
import Bg3Card from './Bg3Card';

interface ClassPreviewProps {
  characterClass: CharacterClass;
  className?: string;
  disableHover?: boolean;
  onClick?: () => void;
}

const ClassPreview: React.FC<ClassPreviewProps> = ({ characterClass, className = '', disableHover = false, onClick }) => {
  const progressionLevels = Object.keys(characterClass.level_progression || {})
    .filter((level) => {
      const entry = characterClass.level_progression?.[level];
      return (entry?.effects?.length || 0) > 0 || (entry?.actions?.length || 0) > 0;
    })
    .sort((a, b) => Number(a) - Number(b));

  return (
    <Bg3Card
      title={characterClass.name || 'Название класса'}
      titleEn={characterClass.name_en}
      subtype="Класс"
      imageUrl={characterClass.image_url}
      disableHover={disableHover}
      onClick={onClick}
      className={className}
    >
      <div className="bg3-stats">
        {characterClass.hit_die && (
          <div className="bg3-srow"><span className="bg3-lbl">Кость хитов:</span><span className="bg3-val">{characterClass.hit_die}</span></div>
        )}
        {characterClass.primary_abilities?.length ? (
          <div className="bg3-srow"><span className="bg3-lbl">Основные:</span><span className="bg3-val">{characterClass.primary_abilities.join(', ')}</span></div>
        ) : null}
        {characterClass.saving_throws?.length ? (
          <div className="bg3-srow"><span className="bg3-lbl">Спасброски:</span><span className="bg3-val">{characterClass.saving_throws.join(', ')}</span></div>
        ) : null}
      </div>

      {characterClass.description && (
        <div className="bg3-desc">
          <FormattedText text={characterClass.description} emptyText="Описание класса" />
        </div>
      )}

      {progressionLevels.length > 0 && (
        <div className="bg3-extra">
          <span style={{ color: '#c9a227', fontWeight: 600 }}>Уровни способностей: </span>
          {progressionLevels.join(', ')}
        </div>
      )}

      {characterClass.detailed_description && (
        <div className="bg3-extra">
          <FormattedText text={characterClass.detailed_description} emptyText="" />
        </div>
      )}
    </Bg3Card>
  );
};

export default ClassPreview;
