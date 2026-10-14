import { useState } from 'react';
import { useCharacterFormulaCtx } from '../contexts/CharacterFormulaContext';
import { formulaPresentation, linkFormulaTerms } from '../utils/formulaPresentation';
import { FormattedText } from '../utils/formattedText';
import HoverCard from './HoverCard';

/** Shared by canonical entity previews; executable formulas remain untouched. */
export default function FormulaValue({ formula }: { formula: string | number }) {
  const ctx = useCharacterFormulaCtx();
  const { full, complex } = formulaPresentation(formula, ctx);
  const [expanded, setExpanded] = useState(false);
  if (!complex) return <FormattedText onDark text={linkFormulaTerms(full)} emptyText="" />;
  const detail = <span className="sp-formula-detail"><FormattedText onDark text={linkFormulaTerms(full)} emptyText="" /></span>;
  return <span className="sp-formula-value">
    <HoverCard content={<div className="sp-tip sp-formula-preview"><strong>Формула</strong>{detail}</div>}>
      <button type="button" className="sp-formula-trigger" aria-label={`Формула: ${full}`}
        aria-expanded={expanded} onClick={event => { event.stopPropagation(); setExpanded(value => !value); }}>
        Формула
      </button>
    </HoverCard>
    {expanded && detail}
  </span>;
}
