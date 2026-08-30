import { ABILITY_KEYS, type AbilityKey, type ForgeCharacter } from '../character/types';
import { abilityOfSkill } from '../character/rules/foundation';
import { SKILLS } from '../mechanics/registries';
import type { SoloCombatState } from '../solo-combat/types';
import type { ActiveEffectEntry } from '../mvp/contracts';
import CharacterSheetFirstColumn, { CHARACTER_SENSE_LABELS } from './CharacterSheetFirstColumn';
import { groupActiveEffectsForDisplay } from '../engine/effects';

const abilityRecord = (value: Partial<Record<AbilityKey, number>>, fallback: number): Record<AbilityKey, number> =>
  Object.fromEntries(ABILITY_KEYS.map((ability) => [ability, Number(value[ability] ?? fallback)])) as Record<AbilityKey, number>;

export function CombatActiveEffects({ effects }: { effects: readonly ActiveEffectEntry[] }) {
  if (!effects.length) return <p className="cs-hook-note">Активных состояний и эффектов нет.</p>;
  return (
    <div className="combat-sheet-effects">
      {groupActiveEffectsForDisplay(effects).map((group) => (
        <div key={group.key} className="combat-sheet-effect">
          <strong className="cs-tag">{group.name}</strong>
          {group.instructions.map((instruction) => <small key={instruction}>{instruction}</small>)}
        </div>
      ))}
    </div>
  );
}

export default function CombatCharacterSidebar({
  character,
  state,
  actorId = state.characterId,
}: {
  character: ForgeCharacter;
  state: SoloCombatState;
  actorId?: string;
}) {
  const actor = state.world.actors[actorId];
  const rules = character.rule_state;
  const abilities = abilityRecord(rules?.abilities ?? actor.character.abilityScores ?? {}, 10);
  const abilityMods = abilityRecord(rules?.abilityMods ?? actor.character.abilityMods ?? {}, 0);
  const saveProficiencies = (rules?.proficiencies.savingThrows
    ?? character.saving_throw_proficiencies
    ?? []) as AbilityKey[];
  const skillProficiencies = rules?.proficiencies.skills ?? character.skill_proficiencies ?? [];
  const skillExpertise = rules?.expertise.skills ?? character.skill_expertise ?? [];
  const proficiencyBonus = Number(character.proficiency_bonus ?? actor.character.profBonus ?? 2);
  const savingThrowBonuses = abilityRecord(rules?.savingThrowBonuses ?? Object.fromEntries(
    ABILITY_KEYS.map((ability) => [ability, abilityMods[ability] + (saveProficiencies.includes(ability) ? proficiencyBonus : 0)]),
  ), 0);
  const skillBonuses = rules?.skillBonuses ?? Object.fromEntries(SKILLS.map((skill) => {
    const ability = abilityOfSkill(skill.id);
    return [skill.id, abilityMods[ability]
      + (skillProficiencies.includes(skill.id) ? proficiencyBonus : 0)
      + (skillExpertise.includes(skill.id) ? proficiencyBonus : 0)];
  }));

  return (
    <CharacterSheetFirstColumn
      className="combat-sheet-sidebar"
      abilities={abilities}
      abilityMods={abilityMods}
      savingThrowProficiencies={saveProficiencies}
      savingThrowBonuses={savingThrowBonuses}
      skillProficiencies={skillProficiencies}
      skillExpertise={skillExpertise}
      skillBonuses={skillBonuses}
      proficiencyBonus={proficiencyBonus}
      passivePerception={rules?.passivePerception ?? character.passive_perception ?? 10}
      senses={(rules?.senses ?? []).map((sense) => ({
        key: sense.sense,
        label: CHARACTER_SENSE_LABELS[sense.sense] ?? sense.sense,
        value: `${sense.range} фт.`,
      }))}
      conditions={<CombatActiveEffects effects={actor.runtime.activeEffects} />}
    />
  );
}
