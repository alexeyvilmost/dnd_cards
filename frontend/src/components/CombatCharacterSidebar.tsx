import { ABILITY_KEYS, type AbilityKey, type ForgeCharacter } from '../character/types';
import { abilityOfSkill } from '../character/rules/foundation';
import { SKILLS } from '../mechanics/registries';
import type { SoloCombatState } from '../solo-combat/types';
import type { ActiveEffectEntry } from '../mvp/contracts';
import type { RemoteManipulatorCommand } from '../engine/execute';
import CharacterSheetFirstColumn, { CHARACTER_SENSE_LABELS } from './CharacterSheetFirstColumn';
import CollapsibleSection from './CollapsibleSection';
import { getDamageLabel } from '../utils/damageTypes';
import {
  collectCombatDefenses,
  COMBAT_DEFENSE_LABELS,
} from './CombatActorInspector';
import { groupActiveEffectsForDisplay } from '../engine/effects';
import {
  combatGrappleStatusRows,
  type CombatGrappleStatusRow,
} from '../solo-combat/grapplePresentation';
import RemoteManipulatorControl, { remoteManipulatorSpec } from './RemoteManipulatorControl';

const abilityRecord = (value: Partial<Record<AbilityKey, number>>, fallback: number): Record<AbilityKey, number> =>
  Object.fromEntries(ABILITY_KEYS.map((ability) => [ability, Number(value[ability] ?? fallback)])) as Record<AbilityKey, number>;

export function CombatActiveEffects({
  effects,
  grappleStatuses = [],
  onRemoteManipulator,
  remoteManipulatorDisabled = false,
}: {
  effects: readonly ActiveEffectEntry[];
  grappleStatuses?: readonly CombatGrappleStatusRow[];
  onRemoteManipulator?: (command: RemoteManipulatorCommand) => void | Promise<void>;
  remoteManipulatorDisabled?: boolean;
}) {
  if (!effects.length && !grappleStatuses.length) {
    return <p className="cs-hook-note">Активных состояний и эффектов нет.</p>;
  }
  return (
    <div className="combat-sheet-effects">
      {groupActiveEffectsForDisplay(effects).map((group) => {
        const remoteManipulator = group.effects.find((effect) => remoteManipulatorSpec(effect));
        return <div key={group.key} className="combat-sheet-effect">
          <strong className="cs-tag">{group.name}</strong>
          {group.source && <small>Источник: {group.source}</small>}
          <small>Длительность: {group.duration}</small>
          {group.instructions.map((instruction) => <small key={instruction}>{instruction}</small>)}
          {remoteManipulator && onRemoteManipulator && (
            <RemoteManipulatorControl
              effect={remoteManipulator}
              disabled={remoteManipulatorDisabled}
              onExecute={onRemoteManipulator}
            />
          )}
        </div>;
      })}
      {grappleStatuses.map((status) => (
        <div key={status.key} className="combat-sheet-effect">
          <strong className="cs-tag">{status.name}</strong>
          {status.instructions.map((instruction) => <small key={instruction}>{instruction}</small>)}
        </div>
      ))}
    </div>
  );
}

export default function CombatCharacterSidebar({
  character,
  state,
  actorId = state.characterId,
  onRemoteManipulator,
  remoteManipulatorDisabled = false,
}: {
  character: ForgeCharacter;
  state: SoloCombatState;
  actorId?: string;
  onRemoteManipulator?: (command: RemoteManipulatorCommand) => void | Promise<void>;
  remoteManipulatorDisabled?: boolean;
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
  const presentation = state.actorPresentation[actorId];
  const defenses = collectCombatDefenses([
    ...(actor.passives ?? []),
    ...(presentation?.traits.map((trait) => trait.mechanics) ?? []),
    ...actor.runtime.activeEffects.map((effect) => effect.mechanics),
  ]);
  for (const immunity of actor.traits?.conditionImmunities ?? []) {
    if (!defenses.some((row) => row.kind === 'condition_immunity' && row.value === immunity.condition)) {
      defenses.push({ kind: 'condition_immunity', value: immunity.condition });
    }
  }

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
      conditions={<CombatActiveEffects
        effects={actor.runtime.activeEffects}
        grappleStatuses={combatGrappleStatusRows(state.world, actorId)}
        onRemoteManipulator={onRemoteManipulator}
        remoteManipulatorDisabled={remoteManipulatorDisabled || (actor.runtime.resources?.action ?? 0) < 1}
      />}
      additionalSections={<>
        <CollapsibleSection title="Защита">
          {defenses.length
            ? <dl className="combat-actor-inspector__defenses">{defenses.map((defense) => (
              <div key={`${defense.kind}:${defense.value}`}>
                <dt>{COMBAT_DEFENSE_LABELS[defense.kind]}</dt>
                <dd>{defense.kind === 'condition_immunity' ? defense.value : getDamageLabel(defense.value)}</dd>
              </div>
            ))}</dl>
            : <p className="combat-actor-inspector__empty">Особых защит нет</p>}
        </CollapsibleSection>
        {presentation?.traits.length ? (
          <CollapsibleSection title="Особенности">
            <div className="combat-actor-inspector__entries">
              {presentation.traits.map((trait) => (
                <details key={trait.id}>
                  <summary>{trait.name}</summary>
                  {trait.description && <p>{trait.description}</p>}
                </details>
              ))}
            </div>
          </CollapsibleSection>
        ) : null}
      </>}
    />
  );
}
