import { describe, expect, it } from 'vitest';
import { appendCustomProperty, normalizeCustomProperty } from './PropertySelector';

describe('PropertySelector custom properties', () => {
  it('normalizes surrounding and repeated whitespace', () => {
    expect(normalizeCustomProperty('  Требует   две руки  ')).toBe('Требует две руки');
  });

  it('appends a custom property without changing its display name', () => {
    expect(appendCustomProperty(['light'], 'Особая заточка')).toEqual([
      'light',
      'Особая заточка',
    ]);
  });

  it('does not add blank or case-insensitive duplicates', () => {
    const properties = ['Особая заточка'];
    expect(appendCustomProperty(properties, '   ')).toBe(properties);
    expect(appendCustomProperty(properties, 'особая заточка')).toBe(properties);
  });
});
