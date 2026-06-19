import { useState } from "react";
import { Spell } from "../api/client";
import { buildSpellTooltip, spellImageUrl, TooltipData, DEFAULT_ICON } from "../battle/tooltip";
import InspectTooltipLayer from "./InspectTooltipLayer";

interface Hover {
  data: TooltipData;
  anchor: DOMRect;
}

// Selectable spell icon grid (character builder, level-up, …): hover shows the
// inspect tooltip, click toggles selection (gold ring), capped at `max`.
export default function SpellPickGrid({
  names,
  catalog,
  selected,
  max,
  onToggle,
}: {
  names: string[];
  catalog: Record<string, Spell>;
  selected: string[];
  max: number;
  onToggle: (name: string) => void;
}) {
  const [hover, setHover] = useState<Hover | null>(null);
  const full = selected.length >= max;

  function tooltipFor(name: string): TooltipData {
    const sp = catalog[name];
    if (sp) return buildSpellTooltip(sp);
    return { name, subtype: "Заклинание", icon: spellImageUrl(), desc: "" };
  }

  return (
    <>
      <div className="spell-grid">
        {names.map((name) => {
          const tip = tooltipFor(name);
          const isSel = selected.includes(name);
          const locked = !isSel && full;
          return (
            <div className="spell-cell" key={name}>
              <button
                type="button"
                className={`ab ${isSel ? "selected" : locked ? "disabled" : "ready"}`}
                disabled={locked}
                onClick={() => onToggle(name)}
                onMouseEnter={(e) =>
                  setHover({ data: tip, anchor: e.currentTarget.getBoundingClientRect() })
                }
                onMouseLeave={() => setHover(null)}
                title={tip.name}
              >
                <img
                  src={tip.icon}
                  alt={tip.name}
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = DEFAULT_ICON;
                  }}
                />
              </button>
              <div className={`spell-name ${isSel ? "sel" : ""}`}>{tip.name}</div>
            </div>
          );
        })}
      </div>

      {hover && <InspectTooltipLayer data={hover.data} anchor={hover.anchor} />}
    </>
  );
}
