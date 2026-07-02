import { describe, expect, it } from 'vitest';

describe('engine smoke', () => {
  it('vitest подключён', () => {
    expect(1 + 1).toBe(2);
  });
});
