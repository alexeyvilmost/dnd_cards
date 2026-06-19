import { ReactNode } from "react";
import { TooltipData, DMG_COLOR, DMG_GLYPH, DEFAULT_ICON } from "../battle/tooltip";

// Render **bold** segments inside description text.
function richText(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <b key={i}>{part.slice(2, -2)}</b>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

function StatRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="tip-srow">
      <span className="tip-lbl">{label}</span>
      {children}
    </div>
  );
}

export default function InspectTooltip({ data }: { data: TooltipData }) {
  const color = (data.dtype && DMG_COLOR[data.dtype]) || "#f3ead4";
  const glyph = (data.dtype && DMG_GLYPH[data.dtype]) || "";

  const hasStats = data.roll || data.dmg || data.heal;

  return (
    <div className="tip">
      <img
        className="tip-bigicon"
        src={data.icon}
        alt=""
        onError={(e) => {
          (e.target as HTMLImageElement).src = DEFAULT_ICON;
        }}
      />
      <h3 className="tip-title">{data.name}</h3>
      <div className="tip-subtype">{data.subtype}</div>

      {hasStats && (
        <div className="tip-stats">
          {data.roll === "attack" && (
            <StatRow label="Атака:">
              <span className="tip-die">к20</span>
              {data.attackBonus && <span className="tip-bonus">{data.attackBonus}</span>}
            </StatRow>
          )}
          {data.roll === "save" && (
            <StatRow label="Спасбросок:">
              <span className="tip-die">СБ</span>
              <span className="tip-bonus">
                {data.saveAbility || "—"}
                {data.saveDC != null ? ` Сл ${data.saveDC}` : ""}
              </span>
            </StatRow>
          )}
          {data.dmg && (
            <StatRow label="Урон:">
              <span className="tip-dmg" style={{ color }}>
                {glyph && <span className="tip-ic">{glyph}</span>}
                {data.dmg}
                {data.dtype ? ` · ${data.dtype}` : ""}
              </span>
            </StatRow>
          )}
          {data.heal && (
            <StatRow label="Лечение:">
              <span className="tip-dmg" style={{ color: "var(--dt-radiant)" }}>
                <span className="tip-ic">❤</span>
                {data.heal}
              </span>
            </StatRow>
          )}
        </div>
      )}

      {data.desc && <div className="tip-desc">{richText(data.desc)}</div>}
      {data.save && <div className="tip-saveline">{data.save}</div>}

      {data.meta && data.meta.length > 0 && (
        <div className="tip-meta">
          {data.meta.map(([ic, label], i) => (
            <span key={i}>
              <i>{ic}</i>
              {label}
            </span>
          ))}
        </div>
      )}

      {data.cost && data.cost.length > 0 && (
        <div className="tip-costbar">
          {data.cost.map((c, i) => (
            <span className="tip-cost" key={i}>
              <span className={`tip-pip ${c.shape}`} style={{ background: c.color }} />
              {c.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
