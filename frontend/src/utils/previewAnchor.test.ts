// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { previewAnchor } from './previewAnchor';

describe('stationary entity preview anchor', () => {
  it('uses the centre of a trigger regardless of pointer entry coordinates', () => {
    const trigger = document.createElement('button');
    trigger.getBoundingClientRect = () => ({ left: 120, top: 240, width: 48, height: 48 }) as DOMRect;
    expect(previewAnchor(trigger)).toEqual({ x: 144, y: 264 });
  });
  it('anchors rows to their icon, not the centre of the long text', () => {
    const trigger = document.createElement('button');
    trigger.innerHTML = '<span class="sheet-item-row-thumb"></span><span>Long title</span>';
    trigger.getBoundingClientRect = () => ({ left: 100, top: 200, width: 400, height: 48 }) as DOMRect;
    trigger.firstElementChild!.getBoundingClientRect = () => ({ left: 108, top: 208, width: 32, height: 32 }) as DOMRect;
    expect(previewAnchor(trigger)).toEqual({ x: 124, y: 224 });
  });
});
