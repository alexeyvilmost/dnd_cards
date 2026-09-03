import { describe, expect, it } from 'vitest';
import type { CharacterClass } from '../types';
import { computeMulticlassMaxHP } from './derive';
import { addClassLevel, multiclassPrerequisiteIssues, normalizedClassLevels, normalizedSubclassIds, subclassSelectionIssues, totalClassLevel } from './multiclass';

const klass = (id: string, card_number: string): CharacterClass => ({
  id, card_number, name: card_number, description: '', rarity: 'common', created_at: '', updated_at: '',
});

describe('multiclass progression', () => {
  it('backfills legacy single-class characters without changing their total level', () => {
    const levels = normalizedClassLevels(null, 'fighter-id', 2);
    expect(levels).toEqual({ 'fighter-id': 2 });
    expect(totalClassLevel(levels)).toBe(2);
  });

  it('adds a level to the selected destination class', () => {
    const levels = addClassLevel({ classId: 'fighter-id', classLevels: { 'fighter-id': 1 }, level: 1 }, 'wizard-id');
    expect(levels).toEqual({ 'fighter-id': 1, 'wizard-id': 1 });
  });

  it('preserves one subclass per owning class and backfills the legacy primary selection', () => {
    expect(normalizedSubclassIds({ wizard: 'evoker' }, 'fighter', 'champion')).toEqual({
      fighter: 'champion', wizard: 'evoker',
    });
    expect(normalizedSubclassIds({ fighter: 'battle-master' }, 'fighter', 'champion')).toEqual({
      fighter: 'battle-master',
    });
  });

  it('requires every already-due subclass and rejects a subclass owned by another class', () => {
    const fighter = { ...klass('fighter', 'CLASS-warrior'), subclass_level: 3 };
    const wizard = { ...klass('wizard', 'CLASS-wizard'), subclass_level: 3 };
    const champion = { ...klass('champion', 'fighter_champion'), parent_class_id: fighter.id, is_subclass: true };
    const evoker = { ...klass('evoker', 'wizard_evoker'), parent_class_id: wizard.id, is_subclass: true };
    const classes = [fighter, wizard, champion, evoker];
    expect(subclassSelectionIssues(classes, { fighter: 3, wizard: 3 }, { fighter: 'champion' }))
      .toEqual([{ classId: 'wizard', className: 'CLASS-wizard', reason: 'missing' }]);
    expect(subclassSelectionIssues(classes, { fighter: 3, wizard: 3 }, { fighter: 'evoker', wizard: 'evoker' }))
      .toEqual([{ classId: 'fighter', className: 'CLASS-warrior', reason: 'invalid' }]);
  });

  it('enforces every ability in a multiclass prerequisite', () => {
    expect(multiclassPrerequisiteIssues(klass('m', 'CLASS-monk'), { dex: 13, wis: 12 }))
      .toEqual(['WIS 13']);
    expect(multiclassPrerequisiteIssues(klass('f', 'CLASS-warrior'), { str: 8, dex: 13 }))
      .toEqual([]);
  });

  it('uses the initial class maximum Hit Die and each later class average', () => {
    expect(computeMulticlassMaxHP([
      { id: 'fighter-id', hit_die: 'd10', level: 1 },
      { id: 'wizard-id', hit_die: 'd6', level: 1 },
    ], 'fighter-id', 14)).toBe(18); // 10+2, then 4+2
  });
});
