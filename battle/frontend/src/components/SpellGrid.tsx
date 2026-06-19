import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Spell } from "../api/client";
import { buildSpellTooltip, spellImageUrl, TooltipData, DEFAULT_ICON } from "../battle/tooltip";
import InspectTooltipLayer from "./InspectTooltipLayer";

export interface SpellGroup {
  label: string;
  spells: Spell[];
}

interface Hover {
  data: TooltipData;
  anchor: DOMRect;
}

export default function SpellGrid({
  groups,
  onDelete,
}: {
  groups: SpellGroup[];
  onDelete?: (s: Spell) => void;
}) {
  const nav = useNavigate();
  const [hover, setHover] = useState<Hover | null>(null);

  return (
    <>
      {groups
        .filter((g) => g.spells.length > 0)
        .map((g) => (
          <div className="panel" key={g.label}>
            <h2>{g.label}</h2>
            <div className="spell-grid">
              {g.spells.map((s) => {
                const tip = buildSpellTooltip(s);
                return (
                  <div className="spell-cell" key={s.id || s.name}>
                    <button
                      className={`ab ready ${s.battle_ready ? "" : "draft"}`}
                      onClick={() => s.id && nav(`/spellbook/${s.id}/edit`)}
                      onMouseEnter={(e) =>
                        setHover({ data: tip, anchor: e.currentTarget.getBoundingClientRect() })
                      }
                      onMouseLeave={() => setHover(null)}
                      title={tip.name}
                    >
                      <img
                        src={spellImageUrl(s)}
                        alt={tip.name}
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = DEFAULT_ICON;
                        }}
                      />
                      {!s.battle_ready && <span className="spell-draft">✎</span>}
                    </button>
                    {onDelete && s.id && (
                      <button
                        className="spell-del"
                        onClick={() => onDelete(s)}
                        title="Удалить заклинание"
                      >
                        🗑
                      </button>
                    )}
                    <div className="spell-name">{tip.name}</div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

      {hover && <InspectTooltipLayer data={hover.data} anchor={hover.anchor} />}
    </>
  );
}
