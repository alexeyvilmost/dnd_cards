import React from 'react';
import type { Background } from '../types';
import { getAbilityLabel } from '../types';
import { FormattedText } from '../utils/formattedText';
import Bg3Card from './Bg3Card';
import { ItemIconRow } from './RelatedItems';
import type { CardRef } from '../types';

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
  const abilities = (background.ability_scores || []).map(getAbilityLabel).join(', ');
  const skills = (background.skill_proficiencies || []).join(', ');

  return (
    <Bg3Card
      title={background.name || 'Название предыстории'}
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
            <span className="bg3-val">{background.origin_feat}</span>
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

      {background.equipment && (
        <div className="bg3-extra">
          <span style={{ color: '#e7cf9a', fontWeight: 600 }}>Снаряжение. </span>
          {background.equipment}
        </div>
      )}

      {background.detailed_description && (
        <div className="bg3-extra">
          <FormattedText text={background.detailed_description} emptyText="" />
        </div>
      )}

      {(() => {
        const opts = background.equipment_options;
        if (!opts) return null;
        const seen = new Set<string>();
        const refs: CardRef[] = [...(opts.option_a?.items || []), ...(opts.option_b?.items || [])]
          .filter((r) => (seen.has(r.card_id) ? false : (seen.add(r.card_id), true)));
        if (refs.length === 0) return null;
        return (
          <div className="bg3-items" style={{ marginTop: 'auto', paddingTop: 8 }}>
            <ItemIconRow refs={refs} />
          </div>
        );
      })()}
    </Bg3Card>
  );
};

export default BackgroundPreview;
