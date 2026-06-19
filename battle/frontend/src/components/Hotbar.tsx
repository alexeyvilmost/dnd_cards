import { useState } from "react";
import { TooltipData, DEFAULT_ICON } from "../battle/tooltip";
import InspectTooltipLayer from "./InspectTooltipLayer";

export type HotbarState = "ready" | "disabled" | "selected";

export interface HotbarItem {
  id: string;
  icon: string;
  tooltip: TooltipData;
  state?: HotbarState;
  badge?: string | number;
  corner?: "bonus" | "reaction";
  onClick?: () => void;
}

export interface HotbarGroup {
  label: string;
  kind: "main" | "bonus" | "reaction" | "spell" | "passive";
  items: HotbarItem[];
}

interface HoverState {
  data: TooltipData;
  anchor: DOMRect;
}

export default function Hotbar({ groups }: { groups: HotbarGroup[] }) {
  const [hover, setHover] = useState<HoverState | null>(null);

  return (
    <div className="hotbar">
      {groups
        .filter((g) => g.items.length > 0)
        .map((g) => (
          <div className="hb-group" key={g.label}>
            <div className="hb-glabel">
              <span className={`hb-dot ${g.kind}`} />
              {g.label}
            </div>
            <div className="hb-slots">
              {g.items.map((it) => {
                const state = it.state || "ready";
                return (
                  <button
                    key={it.id}
                    className={`ab ${state}`}
                    disabled={state === "disabled"}
                    onClick={it.onClick}
                    onMouseEnter={(e) =>
                      setHover({ data: it.tooltip, anchor: e.currentTarget.getBoundingClientRect() })
                    }
                    onMouseLeave={() => setHover(null)}
                  >
                    <img
                      src={it.icon}
                      alt={it.tooltip.name}
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = DEFAULT_ICON;
                      }}
                    />
                    {it.badge != null && <span className="ab-badge">{it.badge}</span>}
                    {it.corner && <span className={`ab-corner ${it.corner}`} />}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

      {hover && <InspectTooltipLayer data={hover.data} anchor={hover.anchor} />}
    </div>
  );
}
