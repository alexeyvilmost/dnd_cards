import { useState, type ReactNode } from 'react';
import type { AssembledCharacter } from '../character/assemble';
import type { CharacterRuleState } from '../character/rules/types';
import type { CharacterDraft, ForgeCharacter } from '../character/types';
import { ABILITY_KEYS, ABILITY_LABEL_RU } from '../character/types';
import type { CharacterContext, EngineEvent, RuntimeState, ValueBreakdown } from '../mvp/contracts';
import { breakdownValue } from '../engine/breakdown';
import { plannedValuesRng } from '../engine/dicePlan';
import { rollEvent } from '../engine/events';
import { collectRollModifiers } from '../engine/modifiers';
import { rollD20 } from '../engine/roll';
import { useDiceDialog } from '../contexts/DiceDialogContext';
import { abilityOfSkill } from '../character/rules/foundation';
import { getSkillGrantSource, grantReason } from '../character/rules/resolveCharacterRules';
import { SKILLS } from '../mechanics/registries';
import { type Card, type Spell } from '../types';
import { useSiteSettings } from '../settings';
import ForgeAbilityDisplay from '../components/forge/ForgeAbilityDisplay';
import ValueBreakdownTip from '../components/ValueBreakdownTip';
import CollapsibleSection from '../components/CollapsibleSection';
import SheetActionsPanel from '../components/SheetActionsPanel';
import SheetConditionsPanel from '../components/SheetConditionsPanel';
import SheetEquipmentPanel from '../components/SheetEquipmentPanel';
import SheetChoicesPanel from '../components/SheetChoicesPanel';
import type { PendingChoice } from '../mechanics/collectChoices';
import SheetHpDialog from '../components/SheetHpDialog';
import SheetRestButtons from '../components/SheetRestButtons';
import './CharacterSheetV2.css';

const fmtMod = (n: number) => (n >= 0 ? `+${n}` : String(n));
const abbr3 = (label: string) => label.slice(0, 3).toUpperCase();
const ABILITY_ORDER = new Map(ABILITY_KEYS.map((ability, index) => [ability, index]));
const SORTED_SKILLS = [...SKILLS].sort((left, right) => {
  const byAbility = (ABILITY_ORDER.get(abilityOfSkill(left.id)) ?? ABILITY_KEYS.length)
    - (ABILITY_ORDER.get(abilityOfSkill(right.id)) ?? ABILITY_KEYS.length);
  return byAbility || left.label.localeCompare(right.label, 'ru');
});
// D3: локализация особых чувств и небазовых режимов перемещения.
const SENSE_LABEL: Record<string, string> = {
  darkvision: 'Тёмное зрение', blindsight: 'Слепое зрение',
  tremorsense: 'Чувство вибрации', truesight: 'Истинное зрение',
};
const SPEED_MODE_LABEL: Record<string, string> = {
  fly: 'Полёт', swim: 'Плавание', climb: 'Лазание', burrow: 'Копание',
};
const originLabel = (kind: string) => {
  switch (kind) {
    case 'race': return 'Вид';
    case 'class': return 'Класс';
    case 'feat': return 'Черта';
    case 'background': return 'Предыстория';
    default: return 'Способность';
  }
};

interface Props {
  character: ForgeCharacter;
  assembled: AssembledCharacter;
  ruleState: CharacterRuleState;
  draft: CharacterDraft;
  sheetCtx: CharacterContext | null;
  runtimeState: RuntimeState | null;
  passives: Record<string, unknown>[];
  equipCards: Map<string, Card>;
  acBreakdown: ValueBreakdown | null;
  maxHpBreakdown: ValueBreakdown | null;
  initBreakdown: ValueBreakdown | null;
  speedBreakdown: ValueBreakdown | null;
  spellsByLevel: [number, Spell[]][];
  lineageName: string | null;
  inPlayChoices: PendingChoice[];
  onUpdated: (c: ForgeCharacter) => void;
  onEvents: (events: EngineEvent[]) => void;
}

const CharacterSheetV2 = ({
  character, assembled, ruleState, draft, sheetCtx, runtimeState, passives, equipCards,
  acBreakdown, maxHpBreakdown, initBreakdown, speedBreakdown,
  lineageName, inPlayChoices, onUpdated, onEvents,
}: Props) => {
  const [hpOpen, setHpOpen] = useState(false);
  // E4/E5: единый «КЗ/Спас цели» на обе панели листа (Действия + Заклинания).
  const [targetAc, setTargetAc] = useState(10);
  const [targetSaveMod, setTargetSaveMod] = useState(0);
  const { entityDisplay } = useSiteSettings();
  const diceDialog = useDiceDialog();

  // Клик по спасброску/навыку — бросок к20 в журнал (учёт активных эффектов).
  const rollCheck = async (
    label: string,
    parts: { value: number; source: string; reason?: string }[],
    rollKind: 'saving_throw' | 'ability_check',
    filter?: Record<string, unknown>,
  ) => {
    // C14: числовые модификаторы эффектов УЖЕ входят в parts (breakdownSave/Skill добавляют
    // effectModifiers). collected нужен только для advantage — его модификаторы НЕ подмешиваем,
    // иначе литеральные бонусы задваивались бы (parts + collected).
    const collected = runtimeState
      ? collectRollModifiers(runtimeState, passives, { roll: rollKind, ...(filter ? { filter } : {}) })
      : { advantage: 'none' as const, modifiers: [] };
    const plan = Array.from(
      { length: collected.advantage === 'none' ? 1 : 2 },
      () => ({ sides: 20, label }),
    );
    const decision = await diceDialog.request(plan, label);
    if (decision.mode === 'cancel') return;
    const rng = decision.mode === 'manual'
      ? plannedValuesRng(plan, decision.values)
      : () => Math.random();
    const roll = rollD20({
      advantage: collected.advantage,
      modifiers: [...parts],
      rng,
    });
    onEvents([rollEvent(label, roll)]);
  };

  const scores = ruleState.abilities; // D3: с учётом grant_ability_score (ASI/раса), не «сырые» из драфта
  const pb = ruleState.proficiencyBonus;
  const saves = ruleState.proficiencies.savingThrows;
  const skills = ruleState.proficiencies.skills;
  const maxHP = maxHpBreakdown?.value ?? ruleState.maxHP;
  const currentHP = character.current_hp ?? maxHP;
  const tempHP = runtimeState?.hp.temp ?? 0;
  const ac = acBreakdown?.value ?? ruleState.armorClass;
  const initiative = initBreakdown?.value ?? ruleState.initiativeBonus;
  const speed = speedBreakdown?.value ?? ruleState.speed;
  const spellcasting = ruleState.spellcasting;
  const hpPct = maxHP > 0 ? Math.max(0, Math.min(100, (currentHP / maxHP) * 100)) : 0;

  const subLine = [
    assembled.race?.name, lineageName,
    assembled.klass ? `${assembled.klass.name} ${draft.level}` : null,
    assembled.background?.name,
  ].filter(Boolean).join(' · ');

  const pill = (label: string, value: ReactNode, bd?: ValueBreakdown | null) => (
    <div className="cs-pill">
      <span className="cs-pill-l">{label}</span>
      {bd ? (
        <ValueBreakdownTip breakdown={bd} label={label}><span className="cs-pill-v">{value}</span></ValueBreakdownTip>
      ) : (
        <span className="cs-pill-v">{value}</span>
      )}
    </div>
  );

  return (
    <div className="csheet">
      <div className="csheet-top">
        <div className="cs-ident">
          <div className="cs-portrait">
            {character.avatar_url
              ? <img src={character.avatar_url} alt="" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
              : <span>{(character.name || '?').slice(0, 1)}</span>}
          </div>
          <div className="cs-ident-txt">
            <div className="cs-name">{character.name || 'Без имени'}</div>
            <div className="cs-sub">{subLine || '—'}</div>
          </div>
        </div>

        <SheetRestButtons
          character={character}
          assembled={assembled}
          ruleState={ruleState}
          onUpdated={onUpdated}
          onEvents={onEvents}
          compact
        />

        <div className="cs-vitals">
          <div className="cs-ac">
            <ValueBreakdownTip breakdown={acBreakdown ?? { value: ac, parts: [] }} label="Класс доспеха">
              <span className="cs-ac-v">{ac}</span>
            </ValueBreakdownTip>
            <span className="cs-ac-l">КД</span>
          </div>
          <button type="button" className="cs-hp cs-hp-btn" onClick={() => setHpOpen(true)} title="Управление хитами">
            <div className="cs-hp-top">
              <span className="cs-hp-cur">{currentHP}</span>
              <span className="cs-hp-max">/ {maxHP}</span>
              {tempHP > 0 && <span className="cs-hp-tmp">+{tempHP}</span>}
              <span className="cs-hp-l">хиты</span>
            </div>
            <div className="cs-hp-bar"><i style={{ width: `${hpPct}%` }} /></div>
          </button>
          {pill('Иниц', fmtMod(initiative), initBreakdown)}
          {pill('Скор', `${speed}`, speedBreakdown)}
          {Object.entries(ruleState.speeds).map(([mode, v]) => pill(SPEED_MODE_LABEL[mode] ?? mode, `${v}`))}
          {pill('БМ', fmtMod(pb))}
          {spellcasting && pill('Заклин.', `СЛ ${spellcasting.saveDC} · ${fmtMod(spellcasting.attack)}`)}
        </div>
      </div>

      <div className="csheet-cols">
        {/* ЛЕВАЯ: характеристики, навыки, чувства */}
        <div className="csheet-col">
          <CollapsibleSection title="Характеристики">
            <div className="cs-abils">
              {ABILITY_KEYS.map((k) => {
                const score = scores[k] ?? 10;
                const mod = ruleState.abilityMods[k];
                const proficient = saves.includes(k);
                const saveBonus = ruleState.savingThrowBonuses[k];
                const saveBd = sheetCtx && runtimeState ? breakdownValue(`save:${k}`, sheetCtx, runtimeState, passives) : null;
                return (
                  <div key={k} className="cs-abil">
                    <div className="cs-abil-id">
                      <span className="cs-abil-ab">{abbr3(ABILITY_LABEL_RU[k])}</span>
                      <span className="cs-abil-sc">{score}</span>
                    </div>
                    <div className="cs-abil-mod">{fmtMod(mod)}</div>
                    <div
                      className={`cs-abil-save${proficient ? ' on' : ''} cs-rollable`}
                      title={`Бросить спасбросок ${ABILITY_LABEL_RU[k]}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => rollCheck(
                        `Спасбросок (${ABILITY_LABEL_RU[k]})`,
                        saveBd?.parts ?? [{ value: saveBonus, source: abbr3(ABILITY_LABEL_RU[k]) }],
                        'saving_throw',
                        { ability: k },
                      )}
                    >
                      <i className="cs-dot" />
                      {saveBd ? (
                        <ValueBreakdownTip breakdown={saveBd} label={`Спасбросок ${ABILITY_LABEL_RU[k]}`}>
                          <span>спас {fmtMod(saveBonus)}</span>
                        </ValueBreakdownTip>
                      ) : <span>спас {fmtMod(saveBonus)}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </CollapsibleSection>

          <CollapsibleSection title="Навыки">
            <ul className="cs-skills cs-skills--col">
              {SORTED_SKILLS.map((skill) => {
                const proficient = skills.includes(skill.id);
                const expert = ruleState.expertise.skills.includes(skill.id);
                const bonus = ruleState.skillBonuses[skill.id];
                const ability = abilityOfSkill(skill.id);
                const skillBd = sheetCtx && runtimeState ? breakdownValue(`skill:${skill.id}`, sheetCtx, runtimeState, passives) : null;
                const grant = getSkillGrantSource(ruleState, skill.id);
                const tip = [
                  `${abbr3(ABILITY_LABEL_RU[ability])} ${fmtMod(ruleState.abilityMods[ability])}`,
                  proficient ? `влад ${fmtMod(pb)}${grant ? ` (${grantReason(grant)})` : ''}` : null,
                  expert ? `эксп ${fmtMod(pb)}` : null,
                ].filter(Boolean).join(' + ');
                return (
                  <li
                    key={skill.id}
                    className={`${proficient ? 'on' : ''} cs-rollable`}
                    title={`${fmtMod(bonus)} = ${tip} · клик — бросок`}
                    onClick={() => rollCheck(
                      `Проверка (${skill.label})`,
                      skillBd?.parts ?? [{ value: bonus, source: skill.label }],
                      'ability_check',
                      { skill: skill.id },
                    )}
                  >
                    <i className="cs-dot" />
                    <span className="cs-skill-nm">{skill.label}{expert ? ' ⁑' : ''}</span>
                    <span className="cs-skill-ab">{abbr3(ABILITY_LABEL_RU[ability])}</span>
                    {skillBd ? (
                      <ValueBreakdownTip breakdown={skillBd} label={skill.label}><span className="cs-skill-v">{fmtMod(bonus)}</span></ValueBreakdownTip>
                    ) : <span className="cs-skill-v">{fmtMod(bonus)}</span>}
                  </li>
                );
              })}
            </ul>
          </CollapsibleSection>

          <CollapsibleSection title="Чувства">
            <div className="cs-kv"><span>Пассивное восприятие</span><b>{ruleState.passivePerception}</b></div>
            {ruleState.senses.length > 0
              ? ruleState.senses.map((s) => (
                  <div key={s.sense} className="cs-kv"><span>{SENSE_LABEL[s.sense] ?? s.sense}</span><b>{s.range} фт</b></div>
                ))
              : <div className="cs-kv cs-muted"><span>Тёмное зрение</span><b>—</b></div>}
          </CollapsibleSection>

          <CollapsibleSection title="Состояния">
            <SheetConditionsPanel
              character={character}
              onUpdated={onUpdated}
              onEvents={onEvents}
              embedded
            />
          </CollapsibleSection>
        </div>

        {/* ЦЕНТР: действия и заклинания — игрок обращается к ним чаще всего, потому в центре. */}
        <div className="csheet-col csheet-col--ctrl">
          <CollapsibleSection title="Действия">
            <SheetActionsPanel
              character={character}
              assembled={assembled}
              ruleState={ruleState}
              equipCards={equipCards}
              maxHp={maxHP}
              onUpdated={onUpdated}
              onEvents={onEvents}
              embedded
              targetAc={targetAc}
              onTargetAcChange={setTargetAc}
              targetSaveMod={targetSaveMod}
              onTargetSaveModChange={setTargetSaveMod}
              encounterId={character.current_encounter_id ?? undefined}
            />
          </CollapsibleSection>

          {assembled.spells.length > 0 && (
            <CollapsibleSection title="Заклинания">
              {/* Заклинания = 1:1 с блоком «Действия»: тот же SheetActionsPanel/
                  SheetActionLine (одна модель отображения строк и иконок), только
                  сгруппировано по кругам. Общий targetAc — поле не дублируется. */}
              <SheetActionsPanel
                character={character}
                assembled={assembled}
                ruleState={ruleState}
                equipCards={equipCards}
                onUpdated={onUpdated}
                onEvents={onEvents}
                embedded
                spellsOnly
                targetAc={targetAc}
                onTargetAcChange={setTargetAc}
                targetSaveMod={targetSaveMod}
                onTargetSaveModChange={setTargetSaveMod}
                encounterId={character.current_encounter_id ?? undefined}
              />
            </CollapsibleSection>
          )}
        </div>

        {/* ПРАВАЯ: инвентарь, черты и способности, выборы «в игре» */}
        <div className="csheet-col">
          {inPlayChoices.length > 0 && (
            <SheetChoicesPanel
              character={character}
              choices={inPlayChoices}
              resolved={draft.resolvedChoices}
              onUpdated={onUpdated}
            />
          )}
          <CollapsibleSection title="Инвентарь и экипировка">
            <SheetEquipmentPanel
              character={character}
              ruleState={ruleState}
              onUpdated={onUpdated}
              embedded
              passives={passives}
            />
          </CollapsibleSection>

          <CollapsibleSection title="Черты и способности">
            {assembled.feats.length > 0 && (
              <div className="cs-tags">
                {assembled.feats.map((f) => <span key={f.id} className="cs-tag">{f.name}</span>)}
              </div>
            )}
            <ForgeAbilityDisplay
              mode={entityDisplay.effects}
              linesClassName="cs-lines"
              entries={assembled.effects.map(({ effect, origin }) => ({
                key: effect.id,
                name: effect.name,
                imageUrl: effect.image_url,
                sourceLabel: `${originLabel(origin.kind)} · ${origin.name}`,
                effect,
              }))}
            />
            <ForgeAbilityDisplay
              mode={entityDisplay.actions}
              linesClassName="cs-lines"
              entries={assembled.actions.map(({ action, origin }) => ({
                key: action.id,
                name: action.name,
                imageUrl: action.image_url,
                sourceLabel: `${originLabel(origin.kind)} · ${origin.name}`,
                action,
              }))}
            />
            {assembled.feats.length === 0 && assembled.effects.length === 0 && assembled.actions.length === 0 && (
              <p className="cs-hook-note">Нет привязанных способностей.</p>
            )}
          </CollapsibleSection>
        </div>
      </div>

      {ruleState.conflicts.length > 0 && (
        <div className="cs-conflicts">
          {ruleState.conflicts.map((c, i) => <span key={i}>⚠ {c.message}</span>)}
        </div>
      )}

      <SheetHpDialog
        open={hpOpen}
        onClose={() => setHpOpen(false)}
        character={character}
        maxHp={maxHP}
        maxHpBreakdown={maxHpBreakdown}
        onUpdated={onUpdated}
        onEvents={onEvents}
        conSaveBonus={ruleState.savingThrowBonuses.con}
      />
    </div>
  );
};

export default CharacterSheetV2;
