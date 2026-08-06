import { describe, expect, it } from 'vitest';
import {
  choiceOptionGrantPayloads,
  materializeChoiceGrant,
  normalizeAppliedGrantPrimitive,
} from './grantSemantics';

describe('generic build grant semantics', () => {
  it.each([
    [{ kind: 'grant_proficiency', prof: 'skill', value: 'arcana' }, { kind: 'skill', mode: 'proficiency', value: 'arcana' }],
    [{ kind: 'grant_proficiency', prof: 'tool', value: 'smith', expert: true }, { kind: 'tool', mode: 'expertise', value: 'smith' }],
    [{ kind: 'grant_expertise', prof: 'skill', value: 'history' }, { kind: 'skill', mode: 'expertise', value: 'history' }],
    [{ kind: 'grant_language', value: 'draconic' }, { kind: 'language', mode: 'proficiency', value: 'draconic' }],
    [{ kind: 'grant_feat', value: 'feat-skilled' }, { kind: 'feat', mode: 'proficiency', value: 'feat-skilled' }],
    [{ kind: 'grant_spell', value: 'spell-shield' }, { kind: 'spell', mode: 'proficiency', value: 'spell-shield' }],
  ])('normalizes %o', (payload, expected) => {
    expect(normalizeAppliedGrantPrimitive(payload)).toMatchObject(expected);
  });

  it('materializes value_into without leaking the authoring directive', () => {
    expect(materializeChoiceGrant(
      { kind: 'damage', dice: '1d6', value_into: 'type' },
      'fire',
    )).toEqual({ kind: 'damage', dice: '1d6', type: 'fire' });
  });

  it('gives explicit item.grants precedence over the choice template', () => {
    expect(choiceOptionGrantPayloads({
      source: 'explicit',
      grant: { kind: 'grant_proficiency' },
      items: [{
        id: 'tool:smith',
        grants: [{ kind: 'grant_proficiency', prof: 'tool', value: 'smith' }],
      }],
    }, 'tool:smith')).toEqual([
      { kind: 'grant_proficiency', prof: 'tool', value: 'smith' },
    ]);
  });

  it('matches the executable implicit feat fallback', () => {
    expect(choiceOptionGrantPayloads({ source: 'feat' }, 'feat-skilled')).toEqual([
      { kind: 'grant_feat', value: 'feat-skilled' },
    ]);
  });
});
