import { describe, expect, it } from 'vitest';
import { resourceView } from './eventDisplay';

describe('resourceView', () => {
  it('скрывает внутренний идентификатор заряда способности', () => {
    expect(resourceView([], 'uses_ACTION-0005').label).toBe('Заряд способности');
  });
});
