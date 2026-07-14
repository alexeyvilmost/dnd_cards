import React from 'react';
import type { Variable } from '../types';
import { FormattedText } from '../utils/formattedText';
import Bg3Card from './Bg3Card';

interface VariablePreviewProps {
  variable: Variable;
  className?: string;
  disableHover?: boolean;
  onClick?: () => void;
}

export const variableTypeLabel = (v?: string | null) =>
  v === 'dice' ? 'Кость' : 'Число';

const VariablePreview: React.FC<VariablePreviewProps> = ({
  variable,
  className = '',
  disableHover = false,
  onClick,
}) => {
  return (
    <Bg3Card
      title={variable.name || 'Название переменной'}
      titleEn={variable.name_en}
      subtype={`Переменная · ${variableTypeLabel(variable.var_type)}`}
      imageUrl={variable.image_url}
      disableHover={disableHover}
      onClick={onClick}
      className={className}
      footer={<span className="bg3-chip">{variableTypeLabel(variable.var_type)}</span>}
    >
      <div className="bg3-stats">
        <div className="bg3-srow">
          <span className="bg3-lbl">По умолчанию:</span>
          <span className="bg3-val" style={{ fontFamily: 'ui-monospace,monospace' }}>
            {variable.default_value || '—'}
          </span>
        </div>
      </div>

      <div className="bg3-desc">
        <FormattedText text={variable.description || ''} emptyText="Описание переменной" />
      </div>

      {/* Важная семантика: default_value — только запасное значение. Настоящее задают
          эффекты (payload variable, op set/add/remove). Прежняя строка в конструкторе
          показывала «по умолчанию: X» так, будто это и есть значение. */}
      <div className="bg3-extra">Значение на персонаже задают эффекты; по умолчанию — запасной вариант.</div>
    </Bg3Card>
  );
};

export default VariablePreview;
