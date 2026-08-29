import { describe, expect, it } from 'vitest';
import { fitActionPopoverToViewport } from './SheetActionLine';

describe('action hover-card viewport placement', () => {
  it('opens a tall card above a bottom-screen action and keeps it inside the viewport', () => {
    expect(fitActionPopoverToViewport(
      { x: 620, y: 690 },
      { width: 340, height: 560 },
      { width: 1280, height: 720 },
    )).toEqual({ left: 632, top: 118 });
  });

  it('clamps oversized cards to the readable viewport margin', () => {
    expect(fitActionPopoverToViewport(
      { x: 12, y: 700 },
      { width: 340, height: 900 },
      { width: 360, height: 720 },
    )).toEqual({ left: 12, top: 8 });
  });

  it('keeps ordinary cards below the pointer when space is available', () => {
    expect(fitActionPopoverToViewport(
      { x: 100, y: 100 },
      { width: 340, height: 240 },
      { width: 1280, height: 720 },
    )).toEqual({ left: 112, top: 112 });
  });
});
