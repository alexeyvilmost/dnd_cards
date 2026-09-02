import { describe, expect, it } from 'vitest';
import type { AssembledCharacter } from './assemble';
import { emptyDraft, type ForgeCharacter } from './types';
import {
  applySkillConflictReplacement,
  availableReplacementSkills,
  conflictPartyPools,
  findConflictReplaceSlots,
} from './resolveConflict';
import { buildSavePayload, characterToDraft, MANUAL_SPELLS_KEY } from './forgeHelpers';
import { CLASS_SKILLS_KEY } from './pointBuy';
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
    } as unknown as AssembledCharacter['klass'],
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
  it('сохраняет происхождение вручную добавленных заклинаний в save→draft', () => {
    const assembled = assembledStub();
    const draft = {
      ...emptyDraft(),
      name: 'Тест',
      spellIds: ['10000000-0000-4000-8000-000000000001'],
      manualSpellIds: ['10000000-0000-4000-8000-000000000001'],
    };
    const ruleState = resolveCharacterRules({ draft, assembled });
    const payload = buildSavePayload(draft, assembled, ruleState);
    expect(payload.resolved_choices?.[MANUAL_SPELLS_KEY]).toEqual(draft.manualSpellIds);
    const reloaded = characterToDraft({
      id: 'char-manual-spell',
      name: draft.name,
      spell_ids: draft.spellIds,
      resolved_choices: payload.resolved_choices,
      rule_state: ruleState,
    } as ForgeCharacter);
    expect(reloaded.manualSpellIds).toEqual(draft.manualSpellIds);
  });

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

    const slots = findConflictReplaceSlots(conflict as RuleConflict, draft, assembled, ruleState);
    expect(slots).toHaveLength(1);
    expect(slots[0].kind).toBe('class_skills');
    expect(slots[0].sourceName).toBe('Воин');

    const parties = conflictPartyPools(conflict as RuleConflict, assembled);
    expect(parties.map((p) => p.sourceName).sort()).toEqual(['Артист', 'Воин']);

    const options = availableReplacementSkills(slots[0], parties, ruleState);
    const ids = options.map((o) => o.id);
    expect(ids).toContain('perception');
    expect(ids).not.toContain('acrobatics');
    expect(ids).not.toContain('athletics');
    expect(ids).not.toContain('performance');
  });

  it('замена навыка класса снимает конфликт и переживает save→draft', () => {
    const assembled = assembledStub();
    const draft = {
      ...emptyDraft(),
      name: 'Тест',
      classId: 'fighter',
      backgroundId: 'entertainer',
      classSkillChoices: ['acrobatics', 'athletics'],
      abilities: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
    };
    const ruleState = resolveCharacterRules({ draft, assembled });
    const conflict = ruleState.conflicts.find((c) => c.code === 'duplicate_proficiency')!;
    const slots = findConflictReplaceSlots(conflict, draft, assembled, ruleState);
    const next = applySkillConflictReplacement(draft, slots[0], 'perception', ruleState);
    expect(next.classSkillChoices).toEqual(['perception', 'athletics']);
    const nextRules = resolveCharacterRules({ draft: next, assembled });
    expect(nextRules.conflicts.filter((c) => c.code === 'duplicate_proficiency')).toHaveLength(0);
    expect(nextRules.proficiencies.skills).toEqual(
      expect.arrayContaining(['perception', 'athletics', 'acrobatics', 'performance']),
    );

    const payload = buildSavePayload(next, assembled, nextRules);
    expect(payload.resolved_choices?.[CLASS_SKILLS_KEY]).toEqual(['perception', 'athletics']);
    expect(payload.skill_proficiencies).toEqual(
      expect.arrayContaining(['perception', 'athletics', 'acrobatics', 'performance']),
    );

    const reloaded = characterToDraft({
      id: 'char-1',
      name: 'Тест',
      resolved_choices: payload.resolved_choices,
      rule_state: nextRules,
      skill_proficiencies: payload.skill_proficiencies,
    } as ForgeCharacter);
    expect(reloaded.classSkillChoices).toEqual(['perception', 'athletics']);
    const afterReload = resolveCharacterRules({ draft: reloaded, assembled });
    expect(afterReload.proficiencies.skills).toContain('perception');
    expect(afterReload.conflicts.filter((c) => c.code === 'duplicate_proficiency')).toHaveLength(0);
  });
});
