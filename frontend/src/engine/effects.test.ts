import { describe, expect, it } from 'vitest';
import { expiryLabel } from './effects';

describe('подпись длительности активного эффекта', () => {
  it('показывает оставшиеся ходы вместо «без срока»', () => {
    expect(expiryLabel(undefined, 10)).toBe('10 ходов');
    expect(expiryLabel(undefined, 2)).toBe('2 хода');
    expect(expiryLabel(undefined, 1)).toBe('1 ход');
  });
});
