import {describe, expect, it} from 'vitest';
import {activeEffectRequirementIssue} from '../engine/actionRequirements';
import {runtimeActionContext} from '../engine/actionGrantContext';
import type {CharacterContext, RuntimeState} from '../mvp/contracts';

describe('shared runtime grants across prerequisites and execution context', () => {
  it.each([{reference: 'gift-a', level: 2, threshold: 2, bonus: 3},
    {reference: 'gift-b', level: 6, threshold: 5, bonus: 5}])(
    'uses the saved grant for $reference after reload and rejects expired or ungranted actions',
    ({reference, level, threshold, bonus}) => {
      const character: CharacterContext = {level, profBonus: 2,
        abilityMods: {str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0}};
      const runtime: RuntimeState = {hp: {current: 10, max: 10, temp: 0}, resources: {}, maxResources: {},
        equipment: {}, inventory: [], activeEffects: [{id: `grant-${reference}`, name: 'Fixture grant', source: 'caster', roundsLeft: 2,
          mechanics: {kind: 'grant_action', value: reference, min_level: threshold},
          actionContext: {sourceId: 'caster', character: {...character, profBonus: bonus}}}]};
      const restored: RuntimeState = JSON.parse(JSON.stringify(runtime));
      const mechanics = {requires_runtime_action_grant: [reference]};
      expect(activeEffectRequirementIssue(mechanics, restored, character)).toBeNull();
      const context = runtimeActionContext(restored, mechanics, {character, rng: () => {throw Error('This projection must not roll');}});
      expect(context.character.profBonus).toBe(bonus);
      expect(context.effectSourceId).toBe('caster');
      expect(context.suppressSpellCastEvent).toBe(true);
      expect(activeEffectRequirementIssue(mechanics, restored, {...character, level: threshold - 1})).not.toBeNull();
      expect(activeEffectRequirementIssue({requires_runtime_action_grant: ['unrelated']}, restored, character)).not.toBeNull();
      restored.activeEffects[0].roundsLeft = 0;
      expect(activeEffectRequirementIssue(mechanics, restored, character)).not.toBeNull();
      expect(runtime.activeEffects[0].roundsLeft).toBe(2);
    });
});
