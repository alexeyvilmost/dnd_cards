import {describe, expect, it} from 'vitest';
import {captureMapZoomAnchor, mapZoomScrollDelta} from './mapZoom';

describe('map zoom pointer anchor geometry', () => {
  it.each([
    [{left: 45, top: -120, width: 1280, height: 960}, {x: 240, y: 380}, 1.1],
    [{left: -280, top: 310, width: 1876, height: 804}, {x: 760, y: 190}, .875],
  ] as const)('retains a map coordinate through a scale change, including empty map margins', (before, pointer, ratio) => {
    const anchor = captureMapZoomAnchor(before, pointer.x, pointer.y)!;
    const after = {...before, width: before.width * ratio, height: before.height * ratio};
    const delta = mapZoomScrollDelta(after, anchor);
    // Scrolling translates the whole map. Reproject the original map point,
    // rather than asserting an implementation-specific offset expression.
    expect(after.left - delta.x + anchor.x * after.width).toBeCloseTo(pointer.x, 10);
    expect(after.top - delta.y + anchor.y * after.height).toBeCloseTo(pointer.y, 10);
  });

  it('measures the committed rectangle after padding or layout changes', () => {
    const anchor = captureMapZoomAnchor({left: -200, top: 180, width: 1120, height: 800}, 100, 220)!;
    const next = {left: -130, top: 205, width: 1232, height: 880};
    const delta = mapZoomScrollDelta(next, anchor);
    expect(next.left - delta.x + anchor.x * next.width).toBeCloseTo(100);
    expect(next.top - delta.y + anchor.y * next.height).toBeCloseTo(220);
  });

  it('does not capture an unmounted or unmeasurable map', () => {
    expect(captureMapZoomAnchor({left: 0, top: 0, width: 0, height: 0}, 100, 120)).toBeNull();
    expect(captureMapZoomAnchor({left: 0, top: 0, width: 100, height: 120}, NaN, 120)).toBeNull();
  });
});
