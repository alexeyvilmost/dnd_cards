import type { Concept } from '../types';
import { FormattedText } from '../utils/formattedText';
import OriginalName from './OriginalName';

interface ConceptPreviewProps {
  concept: Concept;
  className?: string;
  disableHover?: boolean;
  onClick?: () => void;
}

// Самодостаточные стили (как у SpellPreview) — корректно рендерится и в портале ховера.
const CONCEPT_CSS = `
.concept-tip { position: relative; width: 300px; max-width: 100%; box-sizing: border-box;
  background: #1c1813; color: #e8e0d0; border: 1px solid #6b5836; border-radius: 12px;
  padding: 14px 16px; box-shadow: 0 12px 40px rgba(0,0,0,0.55); }
.concept-tip-icon { position: absolute; top: -18px; right: -12px; width: 64px; height: 64px;
  object-fit: contain; filter: drop-shadow(0 4px 10px rgba(0,0,0,0.6)); }
.concept-tip-title { margin: 0 0 2px; font-size: 18px; font-weight: 700; color: #d8b978; padding-right: 56px; }
.concept-tip-type { font-size: 12px; color: #a99f8b; margin-bottom: 8px; }
.concept-tip-desc { font-size: 13.5px; line-height: 1.4; color: #d8cdb6; white-space: pre-wrap; }
`;

const ConceptPreview: React.FC<ConceptPreviewProps> = ({ concept, className = '', onClick }) => (
  <div
    className={`concept-tip ${className}`}
    onClick={onClick}
    style={onClick ? { cursor: 'pointer' } : undefined}
  >
    <style>{CONCEPT_CSS}</style>
    {concept.image_url?.trim() && (
      <img
        className="concept-tip-icon"
        src={concept.image_url}
        alt=""
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
      />
    )}
    <h3 className="concept-tip-title">{concept.name || 'Понятие'}</h3>
    <OriginalName nameEn={concept.name_en} />
    <div className="concept-tip-type">Понятие</div>
    <div className="concept-tip-desc">
      <FormattedText text={concept.description || ''} emptyText="—" />
    </div>
  </div>
);

export default ConceptPreview;
