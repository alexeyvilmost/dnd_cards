import { useLayoutEffect, useRef, useState } from "react";
import InspectTooltip from "./InspectTooltip";
import { TooltipData } from "../battle/tooltip";

// Fixed-positioned tooltip that anchors above (or below, if cramped) an element.
// Shared by Hotbar and SpellGrid so the hover behaviour stays identical.
export default function InspectTooltipLayer({
  data,
  anchor,
}: {
  data: TooltipData;
  anchor: DOMRect;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!ref.current) return;
    const tw = ref.current.offsetWidth;
    const th = ref.current.offsetHeight;
    let left = anchor.left + anchor.width / 2 - tw / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - tw - 12));
    let top = anchor.top - th - 14;
    if (top < 12) top = anchor.bottom + 14;
    setPos({ left, top });
  }, [data, anchor]);

  return (
    <div
      ref={ref}
      className="tip-layer"
      style={{ left: pos ? pos.left : -9999, top: pos ? pos.top : -9999, opacity: pos ? 1 : 0 }}
    >
      <InspectTooltip data={data} />
    </div>
  );
}
