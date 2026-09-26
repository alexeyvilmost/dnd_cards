// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { preparePaperPortrait } from './portrait';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('paper portrait preparation', () => {
  it('accepts a source larger than the old 2 MB quota and scales its stored representation', async () => {
    const OriginalURL = URL;
    const revoke = vi.fn();
    vi.stubGlobal('URL', class extends OriginalURL {
      static createObjectURL() { return 'blob:paper-portrait'; }
      static revokeObjectURL = revoke;
    });
    vi.stubGlobal('Image', class {
      src = '';
      naturalWidth = 3200;
      naturalHeight = 2400;
      async decode() { return undefined; }
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/webp;base64,cG9ydHJhaXQ=');

    const file = new File([new Uint8Array(3 * 1024 * 1024)], 'portrait.png', { type: 'image/png' });
    const portrait = await preparePaperPortrait(file);
    expect(portrait).toMatch(/^data:image\/webp/);
    expect(HTMLCanvasElement.prototype.toDataURL).toHaveBeenCalledWith('image/webp', 0.9);
    expect(revoke).toHaveBeenCalledWith('blob:paper-portrait');
  });
});
