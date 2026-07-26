import { describe, expect, it } from 'vitest';
import type { AssembledCharacter } from './assemble';
import { emptyDraft } from './types';
import {
  applySkillConflictReplacement,
  availableReplacementSkills,
  conflictPartyPools,
  findConflictReplaceSlots,
} from './resolveConflict';
import { resolveCharacterRules } from './rules/resolveCharacterRules';
import type { RuleConflict } from './rules/types';

function assembledStub(over: Partial<AssembledCharacter> = {}): AssembledCharacter {
  return {
    race: null,
    lineage: null,
    klass: {
      id: 'fighter',
      name: 'Воин',
      skill_choices: {
        count: 2,
        options: ['acrobatics', 'animal_handling', 'athletics', 'history', 'insight', 'intimidation', 'perception', 'survival'],
      },
    } as AssembledCharacter['klass'],
    background: {
      id: 'entertainer',
      name: 'Артист',
      skill_proficiencies: ['acrobatics', 'performance'],
    } as AssembledCharacter['background'],
    feats: [],
    effects: [],
    actions: [],
    spells: [],
    pendingChoices: [],
    derived: { spellcasting: null },
    variables: {},
    ...over,
  } as AssembledCharacter;
}

describe('resolveConflict skill duplicate', () => {
  it('находит слот навыков класса Воина и предлагает незанятые из пулов Воин/Артист', () => {
    const assembled = assembledStub();
    const draft = {
      ...emptyDraft(),
      classId: 'fighter',
      backgroundId: 'entertainer',
      classSkillChoices: ['acrobatics', 'athletics'],
    };
    const ruleState = resolveCharacterRules({ draft, assembled });
    const conflict = ruleState.conflicts.find((c) => c.code === 'duplicate_proficiency' && c.value === 'acrobatics');
    expect(conflict).toBeTruthy();

    const slots = findConflictReplaceSlots(conflict as RuleConflict, draft, assembled);
    expect(slots).toHaveLength(1);
    expect(slots[0].kind).toBe('class_skills');
    expect(slots[0].sourceName).toBe('Воин');

    const parties = conflictPartyPools(conflict as RuleConflict, draft, assembled);
    expect(parties.map((p) => p.sourceName).sort()).toEqual(['Артист', 'Воин']);

    const options = availableReplacementSkills(slots[0], parties, ruleState);
    const ids = options.map((o) => o.id);
    expect(ids).toContain('perception');
    expect(ids).not.toContain('acrobatics');
    expect(ids).not.toContain('athletics');
    expect(ids).not.toContain('performance');
  });

  it('замена навыка класса снимает конфликт', () => {
    const assembled = assembledStub();
    const draft = {
      ...emptyDraft(),
      classId: 'fighter',
      backgroundId: 'entertainer',
      classSkillChoices: ['acrobatics', 'athletics'],
    };
    const ruleState = resolveCharacterRules({ draft, assembled });
    const conflict = ruleState.conflicts.find((c) => c.code === 'duplicate_proficiency')!;
    const slots = findConflictReplaceSlots(conflict, draft, assembled);
    const next = applySkillConflictReplacement(draft, slots[0], 'perception');
    expect(next.classSkillChoices).toEqual(['perception', 'athletics']);
    const nextRules = resolveCharacterRules({ draft: next, assembled });
    expect(nextRules.conflicts.filter((c) => c.code === 'duplicate_proficiency')).toHaveLength(0);
    expect(nextRules.proficiencies.skills).toEqual(
      expect.arrayContaining(['perception', 'athletics', 'acrobatics', 'performance']),
    );
  });
});
