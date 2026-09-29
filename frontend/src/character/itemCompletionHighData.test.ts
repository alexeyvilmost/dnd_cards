import { describe, expect, it } from 'vitest';
import manifest from '../../../scripts/content/data/item-completion-high-related-20260929.json';
import { projectRuleAction } from '../canon/ruleActionProjection';
import { validateMechanics } from '../engine/validateMechanics';
import type { Action } from '../types';

const related = manifest.entities as unknown as Array<{ entity_type: string; patch: Action }>;
describe('high item canonical related actions', () => {
  it.each(related.filter(entity=>entity.entity_type==='action').map(entity=>[entity.patch.card_number,entity.patch] as const))('%s compiles and validates its exact generated declaration', (_ref, action) => {
    expect(() => projectRuleAction(action)).not.toThrow();
    const validation = validateMechanics(action.mechanics!, { id: action.id, name: action.name, kind: 'action' });
    expect(validation.errors).toEqual([]);
  });
});
