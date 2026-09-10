import { describe, expect, it } from 'vitest';
import type { PendingChoice } from '../mechanics/collectChoices';
import { validateMasteryRestSelection } from './masteryRest';

const choice = { id: 'base', count: 3, source: 'weapon', grantKind: 'weapon_mastery',
  origin: { kind: 'class', id: 'fighter' } } as PendingChoice;
const choices = [choice, { ...choice, id: 'extra', count: 1 }];
const original = { base: ['longsword', 'shortbow', 'spear'], extra: ['warhammer'] };
describe('Fighter Long Rest weapon drills', () => {
  it('keeps all selections or replaces one weapon across progression choices', () => {
    expect(validateMasteryRestSelection(choices, original, {})).toEqual(original);
    expect(validateMasteryRestSelection(choices, original, { extra: ['maul'] })).toEqual({ ...original, extra: ['maul'] });
  });
  it('rejects two replacements split across base and extra choices', () => {
    expect(() => validateMasteryRestSelection(choices, original, { base: ['longsword','shortbow','dagger'], extra: ['maul'] }))
      .toThrow('один вид');
  });
  it('rejects duplicates, unknown weapons, missing slots and unrelated build changes', () => {
    for (const selection of [{ extra: ['spear'] }, { extra: ['invented'] }, { extra: [] }, { style: ['defense'] }]) {
      expect(() => validateMasteryRestSelection(choices, original, selection)).toThrow();
    }
  });
  it('uses the last rested choice as the next rest baseline', () => {
    const rested = validateMasteryRestSelection(choices, original, { extra: ['maul'] });
    expect(validateMasteryRestSelection(choices, rested, { base: ['longsword','shortbow','dagger'] }))
      .toEqual({ base: ['longsword','shortbow','dagger'], extra: ['maul'] });
  });
});
