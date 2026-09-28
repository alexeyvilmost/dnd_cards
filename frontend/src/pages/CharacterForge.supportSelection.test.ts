import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

describe('CharacterForge uncertified entity selection', () => {
  it('does not gate catalog choices behind verification status', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./CharacterForge.tsx', import.meta.url)),
      'utf8',
    );

    expect(source).not.toContain('window.confirm');
    expect(source).not.toContain('supportSelectionWarning');
    expect(source).not.toContain('filterEntitiesBySupport');
    expect(source).not.toContain('showAllContent');
    expect(source).not.toContain('проверенного каталога');
  });
});
