import { useLayoutEffect, useRef, useState } from 'react';

export function fitActionPopoverToViewport(
  anchor: { x: number; y: number },
  popover: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = 8,
  gap = 12,
): { left: number; top: number } {
  const maxLeft = Math.max(margin, viewport.width - popover.width - margin);
  const left = Math.max(margin, Math.min(anchor.x + gap, maxLeft));
  const below = anchor.y + gap;
  const preferredTop = below + popover.height <= viewport.height - margin
    ? below
    : anchor.y - popover.height - gap;
  const maxTop = Math.max(margin, viewport.height - popover.height - margin);
  return { left, top: Math.max(margin, Math.min(preferredTop, maxTop)) };
}

export function useViewportPopoverPosition(
  open: boolean,
  anchor: { x: number; y: number },
) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [popoverPos, setPopoverPos] = useState({ left: 8, top: 8 });

  useLayoutEffect(() => {
    if (!open || !popoverRef.current) return undefined;
    const place = () => {
      const rect = popoverRef.current?.getBoundingClientRect();
      if (!rect) return;
      const next = fitActionPopoverToViewport(
        anchor,
        { width: rect.width, height: rect.height },
        { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight },
      );
      setPopoverPos((current) => current.left === next.left && current.top === next.top ? current : next);
    };
    place();
    const frame = window.requestAnimationFrame(place);
    // Injected preview styles can settle after the first layout frame without
    // changing the ResizeObserver content box (for example, scrollbar-gutter).
    const settleTimers = [0, 100, 250].map((delay) => window.setTimeout(place, delay));
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    observer?.observe(popoverRef.current);
    window.addEventListener('resize', place);
    return () => {
      window.cancelAnimationFrame(frame);
      settleTimers.forEach((timer) => window.clearTimeout(timer));
      observer?.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [open, anchor.x, anchor.y]);

  return { popoverRef, popoverPos };
}
