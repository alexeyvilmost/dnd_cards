import type { RaceTrait } from '../../types';
import { FormattedText } from '../../utils/formattedText';

type Props = {
  title?: string;
  traits: RaceTrait[];
};

const ForgeTraitsBlock = ({ title = 'Видовые особенности', traits }: Props) => {
  if (!traits.length) return null;
  return (
    <div className="forge-traits-block">
      <div className="forge-section-h">{title}</div>
      <div className="forge-traits-list">
        {traits.map((t, i) => (
          <div key={i} className="forge-trait">
            <span className="forge-trait-name">{t.name}. </span>
            <FormattedText text={t.description} emptyText="" />
          </div>
        ))}
      </div>
    </div>
  );
};

export default ForgeTraitsBlock;
