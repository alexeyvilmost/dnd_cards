import { describe, expect, it } from 'vitest';
import { generalFeatPrerequisiteIssue } from './featPrerequisites';

const state = (level: number, str = 12): any => ({ classLevels: { fighter: level }, abilities: { str }, spells: { known: [], cantrips: [], leveled: [] }, proficiencies: { armor: [], skills: [], savingThrows: [], tools: [], languages: [], weapons: [] } });
const feat = (prerequisite: string): any => ({ category: 'general', prerequisite });

describe('generalFeatPrerequisiteIssue', () => {
  it('enforces level and alternative ability thresholds', () => {
    expect(generalFeatPrerequisiteIssue(feat('уровень 4+, Сила или Ловкость 13+'), state(3, 14))).toContain('уровень');
    expect(generalFeatPrerequisiteIssue(feat('уровень 4+, Сила или Ловкость 13+'), state(4, 12))).toContain('13+');
    expect(generalFeatPrerequisiteIssue(feat('уровень 4+, Сила или Ловкость 13+'), state(4, 13))).toBeUndefined();
  });
  it('uses total multiclass level and enforces casting, armor, and shield gates', () => {
    const multiclass = { ...state(2, 13), classLevels: { fighter: 2, rogue: 2 } };
    expect(generalFeatPrerequisiteIssue(feat('уровень 4+, Сила 13+'), multiclass)).toBeUndefined();
    expect(generalFeatPrerequisiteIssue(feat('уровень 4+, умение Сотворение заклинаний или Магия договора'), multiclass)).toContain('Сотворение');
    expect(generalFeatPrerequisiteIssue(feat('уровень 4+, навык обращения со Средними доспехами'), multiclass)).toContain('доспехами');
    expect(generalFeatPrerequisiteIssue(feat('уровень 4+, навык обращения с Щитами'), multiclass)).toContain('щитами');
    const eligible = {
      ...multiclass,
      spells: { known: ['spell'], cantrips: [], leveled: ['spell'] },
      proficiencies: { ...multiclass.proficiencies, armor: ['medium', 'shield'] },
    };
    expect(generalFeatPrerequisiteIssue(feat('уровень 4+, умение Сотворение заклинаний или Магия договора'), eligible)).toBeUndefined();
    expect(generalFeatPrerequisiteIssue(feat('уровень 4+, навык обращения со Средними доспехами'), eligible)).toBeUndefined();
    expect(generalFeatPrerequisiteIssue(feat('уровень 4+, навык обращения с Щитами'), eligible)).toBeUndefined();
  });
});
