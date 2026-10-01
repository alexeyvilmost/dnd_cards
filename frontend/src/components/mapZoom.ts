export interface MapZoomRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface MapZoomAnchor {
  x: number;
  y: number;
  clientX: number;
  clientY: number;
}

/** Fractional map coordinates also describe the empty space around its edges. */
export function captureMapZoomAnchor(rect: MapZoomRect, clientX: number, clientY: number): MapZoomAnchor | null {
  if (rect.width <= 0 || rect.height <= 0
    || ![rect.left, rect.top, rect.width, rect.height, clientX, clientY].every(Number.isFinite)) return null;
  return {x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height, clientX, clientY};
}

/** Measure after layout, so rounded cell sizes, padding and fallback notices
 * cannot move the map coordinate which was underneath the pointer. */
export function mapZoomScrollDelta(rect: MapZoomRect, anchor: MapZoomAnchor): {x: number; y: number} {
  return {x: rect.left + anchor.x * rect.width - anchor.clientX,
    y: rect.top + anchor.y * rect.height - anchor.clientY};
}
