import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

describe('CharacterForge uncertified entity selection', () => {
  it('never introduces a second confirmation window after the user reveals all entities', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./CharacterForge.tsx', import.meta.url)),
      'utf8',
    );

    expect(source).not.toContain('window.confirm');
    expect(source).not.toContain('supportSelectionWarning');
    expect(source).toContain('Непроверенные варианты доступны без дополнительных окон.');
  });
});
