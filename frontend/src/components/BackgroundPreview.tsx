import { useEntityRef } from './EntityRefRegistry';
import type { Feat } from '../types';
import { useSiteSettings } from '../settings';
import React from 'react';
import type { Background } from '../types';
import { getAbilityLabel } from '../types';
import { FormattedText } from '../utils/formattedText';
import Bg3Card from './Bg3Card';
import BackgroundEquipment from './BackgroundEquipment';
import {labelOf, SKILLS} from '../mechanics/registries';
import {normalizeSkillId} from '../character/skillNormalize';

interface BackgroundPreviewProps {
  background: Background;
  className?: string;
  disableHover?: boolean;
  onClick?: () => void;
}

const BackgroundPreview: React.FC<BackgroundPreviewProps> = ({
  background,
  className = '',
  disableHover = false,
  onClick,
}) => {
  const { showDetailedPreview } = useSiteSettings();
  const { entity: originFeat, error: featError } = useEntityRef('feat', background.origin_feat ?? '');
  const abilities = (background.ability_scores || []).map(getAbilityLabel).join(', ');
  const skills = (background.skill_proficiencies || []).map(skill => labelOf(SKILLS, normalizeSkillId(skill))).join(', ');

  return (
    <Bg3Card
      entityType="background"
      entity={background}
      title={background.name || 'Название предыстории'}
      titleEn={background.name_en}
      subtype="Предыстория"
      imageUrl={background.image_url}
      disableHover={disableHover}
      onClick={onClick}
      className={className}
    >
      <div className="bg3-stats">
        {abilities && (
          <div className="bg3-srow">
            <span className="bg3-lbl">Характеристики:</span>
            <span className="bg3-val">{abilities}</span>
          </div>
        )}
        {background.origin_feat && (
          <div className="bg3-srow">
            <span className="bg3-lbl">Черта:</span>
            <span className="bg3-val">{originFeat ? <FormattedText onDark text={`[[${(originFeat as Feat).name}|feat:${originFeat.id}]]`} /> : (featError ? 'Черта недоступна' : 'Загрузка черты…')}</span>
          </div>
        )}
        {skills && (
          <div className="bg3-srow">
            <span className="bg3-lbl">Навыки:</span>
            <span className="bg3-val">{skills}</span>
          </div>
        )}
        {background.tool_proficiency && (
          <div className="bg3-srow">
            <span className="bg3-lbl">Инструменты:</span>
            <span className="bg3-val">{background.tool_proficiency}</span>
          </div>
        )}
      </div>

      {background.description && (
        <div className="bg3-desc">
          <FormattedText text={background.description} emptyText="Описание предыстории" />
        </div>
      )}

      {/* Текстовое снаряжение — только если нет структурированных вариантов (legacy) */}
      {background.equipment && !background.equipment_options && (
        <div className="bg3-extra">
          <span style={{ color: '#e7cf9a', fontWeight: 600 }}>Снаряжение. </span>
          {background.equipment}
        </div>
      )}

      {showDetailedPreview && background.detailed_description && (
        <div className="bg3-extra">
          <FormattedText text={background.detailed_description} emptyText="" />
        </div>
      )}

      <BackgroundEquipment options={background.equipment_options} />
    </Bg3Card>
  );
};

export default BackgroundPreview;
