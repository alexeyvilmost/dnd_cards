import { abilityOfSkill } from '../character/rules/foundation';
import { ABILITY_KEYS, ABILITY_LABEL_RU, type ForgeCharacter } from '../character/types';
import { SKILLS } from '../mechanics/registries';
import type { SoloCombatState } from '../solo-combat/types';
import CollapsibleSection from './CollapsibleSection';

const fmt = (value: number) => value >= 0 ? `+${value}` : String(value);
const abbr = (value: string) => value.slice(0, 3).toUpperCase();

export default function CombatCharacterSidebar({
  character,
  state,
}: {
  character: ForgeCharacter;
  state: SoloCombatState;
}) {
  const actor = state.world.actors[state.characterId];
  const rules = character.rule_state;
  const scores = rules?.abilities ?? actor.character.abilityScores ?? {};
  const mods = rules?.abilityMods ?? actor.character.abilityMods;
  const saveProficiencies = new Set(rules?.proficiencies.savingThrows
    ?? character.saving_throw_proficiencies ?? []);
  const skillProficiencies = new Set(rules?.proficiencies.skills
    ?? character.skill_proficiencies ?? []);
  const expertise = new Set(rules?.expertise.skills ?? character.skill_expertise ?? []);
  const sortedSkills = [...SKILLS].sort((left, right) => {
    const leftAbility = ABILITY_KEYS.indexOf(abilityOfSkill(left.id));
    const rightAbility = ABILITY_KEYS.indexOf(abilityOfSkill(right.id));
    return leftAbility - rightAbility || left.label.localeCompare(right.label, 'ru');
  });

  return (
    <div className="combat-sheet-sidebar csheet-col">
      <CollapsibleSection title="Характеристики">
        <div className="cs-abils">
          {ABILITY_KEYS.map((key) => {
            const score = Number(scores[key] ?? 10);
            const mod = Number(mods[key] ?? Math.floor((score - 10) / 2));
            const save = Number(rules?.savingThrowBonuses[key]
              ?? mod + (saveProficiencies.has(key) ? Number(character.proficiency_bonus ?? 2) : 0));
            return (
              <div key={key} className="cs-abil">
                <div className="cs-abil-id"><span className="cs-abil-ab">{abbr(ABILITY_LABEL_RU[key])}</span><span className="cs-abil-sc">{score}</span></div>
                <div className="cs-abil-mod">{fmt(mod)}</div>
                <div className={`cs-abil-save${saveProficiencies.has(key) ? ' on' : ''}`}><i className="cs-dot" />спас {fmt(save)}</div>
              </div>
            );
          })}
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Навыки">
        <ul className="cs-skills cs-skills--col">
          {sortedSkills.map((skill, index) => {
            const ability = abilityOfSkill(skill.id);
            const previous = index ? abilityOfSkill(sortedSkills[index - 1].id) : null;
            const proficient = skillProficiencies.has(skill.id);
            const expert = expertise.has(skill.id);
            const bonus = Number(rules?.skillBonuses[skill.id]
              ?? Number(mods[ability] ?? 0)
                + (proficient ? Number(character.proficiency_bonus ?? 2) : 0)
                + (expert ? Number(character.proficiency_bonus ?? 2) : 0));
            return (
              <li key={skill.id} className={`${proficient ? 'on' : ''}${previous && previous !== ability ? ' cs-skill-sep' : ''}`}>
                <i className="cs-dot" /><span className="cs-skill-nm">{skill.label}{expert ? ' ⁑' : ''}</span>
                <span className="cs-skill-ab">{abbr(ABILITY_LABEL_RU[ability])}</span><span className="cs-skill-v">{fmt(bonus)}</span>
              </li>
            );
          })}
        </ul>
      </CollapsibleSection>

      <CollapsibleSection title="Чувства">
        <div className="cs-kv"><span>Пассивное восприятие</span><b>{rules?.passivePerception ?? character.passive_perception ?? 10}</b></div>
        {(rules?.senses ?? []).map((sense) => <div key={sense.sense} className="cs-kv"><span>{sense.sense}</span><b>{sense.range} фт.</b></div>)}
      </CollapsibleSection>

      <CollapsibleSection title="Состояния">
        {actor.runtime.activeEffects.length
          ? <div className="cs-tags">{actor.runtime.activeEffects.map((effect) => <span key={effect.id} className="cs-tag">{effect.name}</span>)}</div>
          : <p className="cs-hook-note">Активных состояний и эффектов нет.</p>}
      </CollapsibleSection>
    </div>
  );
}
