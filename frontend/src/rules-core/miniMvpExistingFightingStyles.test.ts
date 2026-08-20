import { describe, expect, it } from 'vitest';
import definitions from '../../../scripts/content/data/mini-mvp-existing-fighting-styles.v1.json';
import { validateMechanics } from '../engine/validateMechanics';
import {
  EXISTING_STYLE_EXPECTED_SCENARIOS,
  evaluateExistingMiniMvpFightingStyleScenarios,
} from '../testing/miniMvpFightingStylePrimitiveScenarios';

type Dict = Record<string, unknown>;

const styles = new Map(definitions.map((definition) => [
  definition.card_number,
  definition.mechanics as Dict,
]));

describe('mini-MVP existing locked Fighting Styles', () => {
  it('pins four exact schema-valid executable definitions', () => {
    expect(definitions.map((definition) => definition.card_number)).toEqual([
      'fs_archery', 'fs_defense', 'fs_protection', 'fs_two_weapon',
    ]);
    for (const definition of definitions) {
      expect(validateMechanics(definition.mechanics as Dict, {
        id: definition.card_number,
        name: definition.name,
        kind: 'passive_effect',
      })).toMatchObject({ valid: true, errors: [] });
      expect(JSON.stringify(definition.mechanics)).not.toContain('"kind":"narrative"');
    }
  });

  it('executes positive and negative scenarios for modifiers and Protection Reaction', () => {
    expect(evaluateExistingMiniMvpFightingStyleScenarios(styles))
      .toEqual(EXISTING_STYLE_EXPECTED_SCENARIOS);
  });
});
