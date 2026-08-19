import { Fragment, type ReactNode } from 'react';
import { abilityOfSkill } from '../character/rules/foundation';
import { ABILITY_KEYS, ABILITY_LABEL_RU, type AbilityKey } from '../character/types';
import { SKILLS } from '../mechanics/registries';
import type { RollModifier, ValueBreakdown } from '../mvp/contracts';
import CollapsibleSection from './CollapsibleSection';
import ValueBreakdownTip from './ValueBreakdownTip';

const formatModifier = (value: number) => value >= 0 ? `+${value}` : String(value);
const abbreviation = (label: string) => label.slice(0, 3).toUpperCase();
const abilityOrder = new Map(ABILITY_KEYS.map((ability, index) => [ability, index]));
const sortedSkills = [...SKILLS].sort((left, right) => {
  const byAbility = (abilityOrder.get(abilityOfSkill(left.id)) ?? ABILITY_KEYS.length)
    - (abilityOrder.get(abilityOfSkill(right.id)) ?? ABILITY_KEYS.length);
  return byAbility || left.label.localeCompare(right.label, 'ru');
});

type NumericAbilityMap = Record<AbilityKey, number>;
type FirstColumnBreakdownKey = `ability:${AbilityKey}` | `ability_mod:${AbilityKey}` | `save:${AbilityKey}` | `skill:${string}`;

export const CHARACTER_SENSE_LABELS: Record<string, string> = {
  darkvision: 'Тёмное зрение',
  blindsight: 'Слепое зрение',
  tremorsense: 'Чувство вибрации',
  truesight: 'Истинное зрение',
};

export interface CharacterSheetFirstColumnProps {
  className?: string;
  abilities: Partial<NumericAbilityMap>;
  abilityMods: Partial<NumericAbilityMap>;
  savingThrowProficiencies: readonly string[];
  savingThrowBonuses: Partial<NumericAbilityMap>;
  skillProficiencies: readonly string[];
  skillExpertise: readonly string[];
  skillBonuses: Record<string, number>;
  proficiencyBonus: number;
  passivePerception: ReactNode;
  senses: Array<{ key: string; label: string; value: ReactNode }>;
  conditions: ReactNode;
  breakdownFor?: (key: FirstColumnBreakdownKey) => ValueBreakdown | null;
  skillSourceReason?: (skillId: string) => string | undefined;
  onRollSave?: (ability: AbilityKey, parts: RollModifier[]) => void;
  onRollSkill?: (skillId: string, label: string, ability: AbilityKey, parts: RollModifier[]) => void;
  initiative?: { value: number; rolling?: boolean; onRoll?: () => void };
}

/** The actual first column of the character sheet, shared verbatim with combat. */
export default function CharacterSheetFirstColumn({
  className = '',
  abilities,
  abilityMods,
  savingThrowProficiencies,
  savingThrowBonuses,
  skillProficiencies,
  skillExpertise,
  skillBonuses,
  proficiencyBonus,
  passivePerception,
  senses,
  conditions,
  breakdownFor,
  skillSourceReason,
  onRollSave,
  onRollSkill,
  initiative,
}: CharacterSheetFirstColumnProps) {
  const saveProficiencies = new Set(savingThrowProficiencies);
  const proficientSkills = new Set(skillProficiencies);
  const expertise = new Set(skillExpertise);

  return (
    <div className={`csheet-col${className ? ` ${className}` : ''}`}>
      <CollapsibleSection title="Характеристики">
        <div className="cs-abils">
          {ABILITY_KEYS.map((ability) => {
            const score = abilities[ability] ?? 10;
            const modifier = abilityMods[ability] ?? Math.floor((score - 10) / 2);
            const proficient = saveProficiencies.has(ability);
            const saveBonus = savingThrowBonuses[ability] ?? modifier + (proficient ? proficiencyBonus : 0);
            const scoreBreakdown = breakdownFor?.(`ability:${ability}`) ?? null;
            const modifierBreakdown = breakdownFor?.(`ability_mod:${ability}`) ?? null;
            const saveBreakdown = breakdownFor?.(`save:${ability}`) ?? null;
            const saveParts = saveBreakdown?.parts ?? [{ value: saveBonus, source: abbreviation(ABILITY_LABEL_RU[ability]) }];
            const saveInteractive = Boolean(onRollSave);
            return (
              <div key={ability} className="cs-abil">
                <div className="cs-abil-id">
                  <span className="cs-abil-ab">{abbreviation(ABILITY_LABEL_RU[ability])}</span>
                  {scoreBreakdown
                    ? <ValueBreakdownTip breakdown={scoreBreakdown} label={ABILITY_LABEL_RU[ability]}><span className="cs-abil-sc">{score}</span></ValueBreakdownTip>
                    : <span className="cs-abil-sc">{score}</span>}
                </div>
                <div className="cs-abil-mod">
                  {modifierBreakdown
                    ? <ValueBreakdownTip breakdown={modifierBreakdown} label={`Модификатор ${ABILITY_LABEL_RU[ability]}`}><span>{formatModifier(modifier)}</span></ValueBreakdownTip>
                    : formatModifier(modifier)}
                </div>
                <div
                  className={`cs-abil-save${proficient ? ' on' : ''}${saveInteractive ? ' cs-rollable' : ''}`}
                  title={saveInteractive ? `Бросить спасбросок ${ABILITY_LABEL_RU[ability]}` : undefined}
                  role={saveInteractive ? 'button' : undefined}
                  tabIndex={saveInteractive ? 0 : -1}
                  onClick={saveInteractive ? () => onRollSave?.(ability, saveParts) : undefined}
                >
                  <i className="cs-dot" />
                  {saveBreakdown
                    ? <ValueBreakdownTip breakdown={saveBreakdown} label={`Спасбросок ${ABILITY_LABEL_RU[ability]}`}><span>спас {formatModifier(saveBonus)}</span></ValueBreakdownTip>
                    : <span>спас {formatModifier(saveBonus)}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Навыки">
        <ul className="cs-skills cs-skills--col">
          {sortedSkills.map((skill, index) => {
            const ability = abilityOfSkill(skill.id);
            const previousAbility = index > 0 ? abilityOfSkill(sortedSkills[index - 1].id) : null;
            const abilitySeparator = previousAbility != null && previousAbility !== ability;
            const proficient = proficientSkills.has(skill.id);
            const expert = expertise.has(skill.id);
            const bonus = skillBonuses[skill.id] ?? (abilityMods[ability] ?? 0)
              + (proficient ? proficiencyBonus : 0)
              + (expert ? proficiencyBonus : 0);
            const skillBreakdown = breakdownFor?.(`skill:${skill.id}`) ?? null;
            const sourceReason = skillSourceReason?.(skill.id);
            const tip = [
              `${abbreviation(ABILITY_LABEL_RU[ability])} ${formatModifier(abilityMods[ability] ?? 0)}`,
              proficient ? `влад ${formatModifier(proficiencyBonus)}${sourceReason ? ` (${sourceReason})` : ''}` : null,
              expert ? `эксп ${formatModifier(proficiencyBonus)}` : null,
            ].filter(Boolean).join(' + ');
            const skillParts = skillBreakdown?.parts ?? [{ value: bonus, source: skill.label }];
            const skillInteractive = Boolean(onRollSkill);
            return (
              <Fragment key={skill.id}>
                {initiative?.onRoll && ability === 'dex' && previousAbility !== 'dex' && (
                  <li className="cs-rollable cs-initiative-skill cs-skill-sep" title="Бросить инициативу (Ловкость)" onClick={initiative.rolling ? undefined : initiative.onRoll}>
                    <i className="cs-dot" /><span className="cs-skill-nm">Инициатива</span><span className="cs-skill-ab">ЛОВ</span><span className="cs-skill-v">{initiative.rolling ? '…' : formatModifier(initiative.value)}</span>
                  </li>
                )}
                <li
                  className={`${proficient ? 'on ' : ''}${skillInteractive ? 'cs-rollable' : ''}${abilitySeparator ? ' cs-skill-sep' : ''}`.trim()}
                  title={skillInteractive ? `${formatModifier(bonus)} = ${tip} · клик — бросок` : undefined}
                  onClick={skillInteractive ? () => onRollSkill?.(skill.id, skill.label, ability, skillParts) : undefined}
                >
                  <i className="cs-dot" />
                  <span className="cs-skill-nm">{skill.label}{expert ? ' ⁑' : ''}</span>
                  <span className="cs-skill-ab">{abbreviation(ABILITY_LABEL_RU[ability])}</span>
                  {skillBreakdown
                    ? <ValueBreakdownTip breakdown={skillBreakdown} label={skill.label}><span className="cs-skill-v">{formatModifier(bonus)}</span></ValueBreakdownTip>
                    : <span className="cs-skill-v">{formatModifier(bonus)}</span>}
                </li>
              </Fragment>
            );
          })}
        </ul>
      </CollapsibleSection>

      <CollapsibleSection title="Чувства">
        <div className="cs-kv"><span>Пассивное восприятие</span><b>{passivePerception}</b></div>
        {senses.length
          ? senses.map((sense) => <div key={sense.key} className="cs-kv"><span>{sense.label}</span><b>{sense.value}</b></div>)
          : <div className="cs-kv cs-muted"><span>Тёмное зрение</span><b>—</b></div>}
      </CollapsibleSection>

      <CollapsibleSection title="Состояния">
        {conditions}
      </CollapsibleSection>
    </div>
  );
}
