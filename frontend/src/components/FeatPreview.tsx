import React from 'react';
import type { Feat } from '../types';
import { getFeatCategoryLabel, getAbilityLabel } from '../types';
import { FormattedText } from '../utils/formattedText';
import Bg3Card from './Bg3Card';

interface FeatPreviewProps {
  feat: Feat;
  className?: string;
  disableHover?: boolean;
  onClick?: () => void;
}

const FeatPreview: React.FC<FeatPreviewProps> = ({ feat, className = '', disableHover = false, onClick }) => {
  const subtype = [getFeatCategoryLabel(feat.category), feat.repeatable ? 'повторяемая' : '']
    .filter(Boolean)
    .join(' · ');

  const abilities = (feat.ability_increase || []).map(getAbilityLabel).join(', ');

  const footer = (
    <>
      <span className="bg3-chip">{getFeatCategoryLabel(feat.category)}</span>
      {feat.repeatable && <span className="bg3-chip">Повторяемая</span>}
    </>
  );

  return (
    <Bg3Card
      title={feat.name || 'Название черты'}
      titleEn={feat.name_en}
      subtype={subtype}
      imageUrl={feat.image_url}
      disableHover={disableHover}
      onClick={onClick}
      className={className}
      footer={footer}
    >
      {(feat.prerequisite || abilities) && (
        <div className="bg3-stats">
          {feat.prerequisite && (
            <div className="bg3-srow">
              <span className="bg3-lbl">Требования:</span>
              <span className="bg3-val">{feat.prerequisite}</span>
            </div>
          )}
          {abilities && (
            <div className="bg3-srow">
              <span className="bg3-lbl">Повышение хар-ки:</span>
              <span className="bg3-val">{abilities} +1</span>
            </div>
          )}
        </div>
      )}

      <div className="bg3-desc">
        <FormattedText text={feat.description || 'Описание черты'} emptyText="Описание черты" />
      </div>

      {feat.detailed_description && (
        <div className="bg3-extra">
          <FormattedText text={feat.detailed_description} emptyText="" />
        </div>
      )}
    </Bg3Card>
  );
};

export default FeatPreview;
