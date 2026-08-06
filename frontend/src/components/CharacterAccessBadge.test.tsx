// @vitest-environment jsdom

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { isCharacterReadOnly } from '../character/types';
import CharacterAccessBadge, { LEGACY_READ_ONLY_LABEL } from './CharacterAccessBadge';

describe('CharacterAccessBadge', () => {
  it('labels legacy public characters as read-only', () => {
    const html = renderToStaticMarkup(
      <CharacterAccessBadge character={{ access_mode: 'legacy_public_readonly' }} />,
    );
    expect(html).toContain(LEGACY_READ_ONLY_LABEL);
    expect(html).toContain('role="status"');
  });

  it('stays hidden only for an explicit owner projection', () => {
    expect(renderToStaticMarkup(<CharacterAccessBadge character={{ access_mode: 'owner' }} />)).toBe('');
  });

  it('fails closed when a malformed response omits the server projection', () => {
    expect(isCharacterReadOnly({ access_mode: undefined as never })).toBe(true);
  });
});
