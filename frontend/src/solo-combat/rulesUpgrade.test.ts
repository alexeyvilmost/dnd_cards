import { describe, expect, it } from 'vitest';
import { clearIncompatibleCombatSnapshot, isIncompatibleCombatRulesError } from './rulesUpgrade';

describe('combat rules upgrade recovery', () => {
  it('removes only the stale combat snapshot', () => {
    expect(clearIncompatibleCombatSnapshot({ solo_combat_v1: { stale: true }, rules_engine_runtime_v1: { hp: 7 }, custom: 1 }))
      .toEqual({ rules_engine_runtime_v1: { hp: 7 }, custom: 1 });
  });
  it('matches pinned and structural persisted-world mismatches', () => {
    expect(isIncompatibleCombatRulesError(new Error('Character uses an incompatible rules version'))).toBe(true);
    expect(isIncompatibleCombatRulesError(new Error(
      'world.actors.wizard.spellcastingAccess.preparedSources.CLASS-wizard.availableActionIds must equal its spellbook grants',
    ))).toBe(true);
    expect(isIncompatibleCombatRulesError(new Error('other'))).toBe(false);
  });
});
