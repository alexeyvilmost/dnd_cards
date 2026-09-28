import { SPELL_CARD_CSS } from './spellCardStyle';

/** Structured terrain / area / world-object hover content in the shared .sp-tip style. */
export default function BattleMapCellPreview({
  title,
  subtype,
  lines,
}: {
  title: string;
  subtype?: string;
  lines: string[];
}) {
  return (
    <div className="sp-tip battle-map-cell-preview" role="tooltip">
      <style>{SPELL_CARD_CSS}</style>
      <h3>{title}</h3>
      {subtype ? <div className="sp-subtype">{subtype}</div> : null}
      <div className="sp-desc">
        {lines.map((line) => <p key={line}>{line}</p>)}
      </div>
      <div className="sp-spacer" />
    </div>
  );
}

export function coverLine(cover?: 'half' | 'three_quarters' | 'total' | null): string | null {
  if (cover === 'half') return 'Половинное укрытие · +2 КД';
  if (cover === 'three_quarters') return 'Укрытие на три четверти · +5 КД';
  if (cover === 'total') return 'Полное укрытие · блокирует обзор';
  return null;
}
