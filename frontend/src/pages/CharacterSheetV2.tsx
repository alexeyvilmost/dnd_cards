import { useRef, useState, type ReactNode } from 'react';
import type { AssembledCharacter } from '../character/assemble';
import { effectAbilityPresentation } from '../character/abilityDisplay';
import type { CharacterRuleState } from '../character/rules/types';
import type { CharacterDraft, ForgeCharacter } from '../character/types';
import { ABILITY_LABEL_RU } from '../character/types';
import type { CharacterContext, EngineEvent, RuntimeState, ValueBreakdown } from '../mvp/contracts';
import { breakdownValue } from '../engine/breakdown';
import { plannedD20BonusDice, plannedValuesRng, type PlannedDie } from '../engine/dicePlan';
import { rollEvent } from '../engine/events';
import { collectRollModifiers } from '../engine/modifiers';
import { rollD20 } from '../engine/roll';
import { finalizeSheetD20Roll } from '../character/sheetD20Roll';
import { useDiceDialog } from '../contexts/DiceDialogContext';
import { getSkillGrantSource, grantReason } from '../character/rules/resolveCharacterRules';
import { type Card, type Spell } from '../types';
import { useSiteSettings } from '../settings';
import ForgeAbilityDisplay from '../components/forge/ForgeAbilityDisplay';
import ValueBreakdownTip from '../components/ValueBreakdownTip';
import ValueBreakdownPanel from '../components/ValueBreakdownPanel';
import CollapsibleSection from '../components/CollapsibleSection';
import SheetActionsPanel from '../components/SheetActionsPanel';
import SheetConditionsPanel from '../components/SheetConditionsPanel';
import SheetEquipmentPanel from '../components/SheetEquipmentPanel';
import SheetInPlayController from '../components/SheetInPlayController';
import type { PendingChoice } from '../mechanics/collectChoices';
import type { EffectiveSense } from '../rules-core/dwarfTraits';
import SheetHpDialog from '../components/SheetHpDialog';
import SheetRestButtons from '../components/SheetRestButtons';
import EffectiveSenseValue from '../components/EffectiveSenseValue';
import type { EncounterApply } from '../battle/encountersApi';
import { charactersV3Api, type CharacterEventRow } from '../character/api';
import { writeRulesEngineRuntimeTurnState } from '../character/runtime';
import { persistCharacterRuntime } from '../character/runtimePersistence';
import type { SheetAtomicRetryEnvelope } from '../character/sheetAtomicRetry';
import CharacterSheetFirstColumn, { CHARACTER_SENSE_LABELS } from '../components/CharacterSheetFirstColumn';
import ActiveEffectCard from '../components/ActiveEffectCard';
import { groupActiveEffectsForDisplay } from '../engine/effects';
import './CharacterSheetV2.css';

const fmtMod = (n: number) => (n >= 0 ? `+${n}` : String(n));
// D3: локализация особых чувств и небазовых режимов перемещения.
const SPEED_MODE_LABEL: Record<string, string> = {
  fly: 'Полёт', swim: 'Плавание', climb: 'Лазание', burrow: 'Копание',
};
const READ_ONLY_RESOURCE_LABEL: Record<string, string> = {
  action: 'Действие',
  bonus_action: 'Бонусное действие',
  reaction: 'Реакция',
  heroic_inspiration: 'Героическое вдохновение',
};
const readOnlyResourceLabel = (key: string) => READ_ONLY_RESOURCE_LABEL[key]
  ?? key.replaceAll('_', ' ');
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
  effectiveSenses: readonly EffectiveSense[];
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
  onPersistedEvents: (rows: CharacterEventRow[]) => void;
  pendingAtomicRetry: SheetAtomicRetryEnvelope | null;
  onPendingAtomicRetryChange: (retry: SheetAtomicRetryEnvelope | null) => void;
  readOnly: boolean;
  encounterApply?: EncounterApply;
  combatActive?: boolean;
  sheetActionDisabledReason?: string;
  onRollInitiative?: () => void;
  rollingInitiative?: boolean;
}

const CharacterSheetV2 = ({
  character, assembled, ruleState, effectiveSenses, draft, sheetCtx, runtimeState, passives, equipCards,
  acBreakdown, maxHpBreakdown, initBreakdown, speedBreakdown,
  lineageName, inPlayChoices, onUpdated, onEvents, onPersistedEvents,
  pendingAtomicRetry, onPendingAtomicRetryChange, readOnly, encounterApply,
  combatActive, sheetActionDisabledReason, onRollInitiative, rollingInitiative,
}: Props) => {
  const [hpOpen, setHpOpen] = useState(false);
  const [longRestOpen, setLongRestOpen] = useState(false);
  // E4/E5: единый «КЗ/Спас цели» на обе панели листа (Действия + Заклинания).
  const [targetAc, setTargetAc] = useState<number | null>(10);
  const [targetSaveMod, setTargetSaveMod] = useState<number | null>(0);
  const [targetCharacterId, setTargetCharacterId] = useState<string | null>(null);
  const { entityDisplay } = useSiteSettings();
  const diceDialog = useDiceDialog();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const uploadAvatar = async (file?: File) => {
    if (!file || readOnly) return;
    setAvatarBusy(true);
    setAvatarError(null);
    try {
      const avatarUrl = await charactersV3Api.uploadAvatar(character.id, file);
      onUpdated({ ...character, avatar_url: avatarUrl });
    } catch (reason) {
      setAvatarError(reason instanceof Error ? reason.message : 'Не удалось загрузить токен');
    } finally {
      setAvatarBusy(false);
      if (avatarInputRef.current) avatarInputRef.current.value = '';
    }
  };

  // Клик по спасброску/навыку — бросок к20 в журнал (учёт активных эффектов).
  const rollCheck = async (
    label: string,
    breakdown: ValueBreakdown,
    rollKind: 'saving_throw' | 'ability_check',
    filter?: Record<string, unknown>,
  ) => {
    if (readOnly) return;
    const parts = breakdown.parts;
    // C14: числовые модификаторы эффектов УЖЕ входят в parts (breakdownSave/Skill добавляют
    // effectModifiers). collected нужен только для advantage — его модификаторы НЕ подмешиваем,
    // иначе литеральные бонусы задваивались бы (parts + collected).
    const collected = runtimeState
      ? collectRollModifiers(runtimeState, passives, { roll: rollKind, ...(filter ? { filter } : {}) })
      : { advantage: 'none' as const, modifiers: [], rules: [] as Record<string, unknown>[] };
    const plan: PlannedDie[] = Array.from(
      { length: collected.advantage === 'none' ? 1 : 2 },
      (_, index) => ({
        sides: 20,
        label,
        resultGroup: 'check',
        advantage: collected.advantage,
        ...(index === 0 ? { modifier: parts.reduce((sum, part) => sum + part.value, 0) } : {}),
      }),
    );
    plan.push(...plannedD20BonusDice(collected.rules, label, 'check'));
    const decision = await diceDialog.request(
      plan,
      label,
      <ValueBreakdownPanel breakdown={breakdown} label={label} />,
    );
    if (decision.mode === 'cancel') return;
    const rng = decision.mode === 'manual'
      ? plannedValuesRng(plan, decision.values)
      : () => Math.random();
    const roll = rollD20({
      advantage: collected.advantage,
      modifiers: [...parts],
      rng,
      rules: collected.rules,
    });
    const rollEvents: EngineEvent[] = [rollEvent(label, roll)];
    if (runtimeState) {
      const finalized = finalizeSheetD20Roll(runtimeState, rollKind, filter);
      rollEvents.push(...finalized.events);
      if (finalized.state !== runtimeState) {
        const updated = await persistCharacterRuntime(character, {
          active_effects: finalized.state.activeEffects,
          turn_state: writeRulesEngineRuntimeTurnState(character.turn_state, finalized.state),
        }, encounterApply);
        onUpdated(updated);
      }
    }
    onEvents(rollEvents);
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
  const passivePerceptionBd = sheetCtx && runtimeState
    ? breakdownValue('passive_perception', sheetCtx, runtimeState, passives)
    : null;
  const spellAttackBd = spellcasting && sheetCtx && runtimeState
    ? breakdownValue('spell_attack', sheetCtx, runtimeState, passives)
    : null;
  const spellDcBd = spellcasting && sheetCtx && runtimeState
    ? breakdownValue('spell_dc', sheetCtx, runtimeState, passives)
    : null;
  const hpPct = maxHP > 0 ? Math.max(0, Math.min(100, (currentHP / maxHP) * 100)) : 0;

  const classLine = (assembled.classes ?? (assembled.klass ? [assembled.klass] : []))
    .map((klass) => `${klass.name} ${draft.classLevels?.[klass.id] ?? (klass.id === draft.classId ? draft.level : 0)}`)
    .filter((label) => !label.endsWith(' 0'))
    .join(' / ');
  const subLine = [
    assembled.race?.name, lineageName,
    classLine || null,
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
          <button type="button" className="cs-portrait cs-portrait-btn" disabled={readOnly || avatarBusy} onClick={() => avatarInputRef.current?.click()} title={readOnly ? 'Лист открыт только для чтения' : 'Загрузить токен персонажа'}>
            {character.avatar_url
              ? <img src={character.avatar_url} alt="" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
              : <span>{(character.name || '?').slice(0, 1)}</span>}
          </button>
          <input ref={avatarInputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => void uploadAvatar(event.target.files?.[0])} />
          <div className="cs-ident-txt">
            <div className="cs-name">{character.name || 'Без имени'}</div>
            <div className="cs-sub">{subLine || '—'}</div>
          </div>
        </div>

        {!readOnly && (
          <SheetRestButtons
            character={character}
            assembled={assembled}
            ruleState={ruleState}
            itemCards={[...equipCards.values()]}
            onUpdated={onUpdated}
            onEvents={onEvents}
            onPersistedEvents={onPersistedEvents}
            compact
            onLongRestComplete={() => setLongRestOpen(true)}
            encounterApply={encounterApply}
            disabledReason={combatActive ? 'Персонаж находится в бою: управляйте ходом и отдыхом на поле' : undefined}
          />
        )}

        <div className="cs-vitals">
          <div className="cs-ac">
            <div className="cs-ac-inner">
              <ValueBreakdownTip breakdown={acBreakdown ?? { value: ac, parts: [] }} label="Класс доспеха">
                <span className="cs-ac-v">{ac}</span>
              </ValueBreakdownTip>
              <span className="cs-ac-l">КД</span>
            </div>
          </div>
          <button type="button" className="cs-hp cs-hp-btn" disabled={readOnly} onClick={() => setHpOpen(true)} title={readOnly ? 'Лист открыт только для чтения' : 'Управление хитами'}>
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
          {spellcasting && pill('СЛ закл.', spellcasting.saveDC, spellDcBd)}
          {spellcasting && pill('Атака закл.', fmtMod(spellcasting.attack), spellAttackBd)}
        </div>
      </div>
      {avatarError && <p className="issues cs-avatar-error" role="alert">{avatarError}</p>}

      <div className="csheet-cols">
        {/* ЛЕВАЯ: характеристики, навыки, чувства */}
        <CharacterSheetFirstColumn
          abilities={scores}
          abilityMods={ruleState.abilityMods}
          savingThrowProficiencies={saves}
          savingThrowBonuses={ruleState.savingThrowBonuses}
          skillProficiencies={skills}
          skillExpertise={ruleState.expertise.skills}
          skillBonuses={ruleState.skillBonuses}
          proficiencyBonus={pb}
          passivePerception={passivePerceptionBd
            ? <ValueBreakdownTip breakdown={passivePerceptionBd} label="Пассивное восприятие"><span>{passivePerceptionBd.value}</span></ValueBreakdownTip>
            : ruleState.passivePerception}
          senses={effectiveSenses.map((sense) => ({
            key: sense.sense,
            label: CHARACTER_SENSE_LABELS[sense.sense] ?? sense.sense,
            value: <EffectiveSenseValue sense={sense} />,
          }))}
          conditions={readOnly
            ? runtimeState?.activeEffects.length
              ? <div className="cs-active-effects">{groupActiveEffectsForDisplay(runtimeState.activeEffects)
                .map((group) => <ActiveEffectCard key={group.key} group={group} />)}</div>
              : <p className="cs-hook-note">Активных состояний и эффектов нет.</p>
            : <SheetConditionsPanel character={character} onUpdated={onUpdated} onEvents={onEvents} passives={passives} embedded encounterApply={encounterApply} />}
          breakdownFor={sheetCtx && runtimeState
            ? (key) => breakdownValue(key, sheetCtx, runtimeState, passives)
            : undefined}
          skillSourceReason={(skillId) => {
            const grant = getSkillGrantSource(ruleState, skillId);
            return grant ? grantReason(grant) : undefined;
          }}
          onRollSave={readOnly ? undefined : (ability, breakdown) => { void rollCheck(
            `Спасбросок (${ABILITY_LABEL_RU[ability]})`, breakdown, 'saving_throw', { ability },
          ); }}
          onRollSkill={readOnly ? undefined : (skillId, label, _ability, breakdown) => { void rollCheck(
            `Проверка (${label})`, breakdown, 'ability_check', { skill: skillId },
          ); }}
          initiative={!readOnly && onRollInitiative
            ? {
                value: initiative,
                rolling: rollingInitiative,
                onRoll: onRollInitiative,
                breakdown: initBreakdown,
              }
            : undefined}
        />

        {/* ЦЕНТР: действия и заклинания — игрок обращается к ним чаще всего, потому в центре. */}
        <div className="csheet-col csheet-col--ctrl">
          {readOnly && (
            <CollapsibleSection title="Ресурсы">
              {runtimeState && Object.keys(runtimeState.maxResources).length ? (
                <div className="cs-kv-list">
                  {Object.entries(runtimeState.maxResources).map(([key, maximum]) => (
                    <div key={key} className="cs-kv">
                      <span>{readOnlyResourceLabel(key)}</span>
                      <b>{runtimeState.resources[key] ?? 0}/{maximum}</b>
                    </div>
                  ))}
                </div>
              ) : <p className="cs-hook-note">Отслеживаемых ресурсов нет.</p>}
            </CollapsibleSection>
          )}
          <CollapsibleSection title="Действия">
            {readOnly ? (
              assembled.actions.length ? (
                <div className="cs-tags">
                  {assembled.actions.map(({ action, origin }) => (
                    <span key={`${action.id}:${origin.id}`} className="cs-tag">{action.name}</span>
                  ))}
                </div>
              ) : <p className="cs-hook-note">Действия не указаны.</p>
            ) : <SheetActionsPanel
              character={character}
              assembled={assembled}
              ruleState={ruleState}
              equipCards={equipCards}
              maxHp={maxHP}
              onUpdated={onUpdated}
              onEvents={onEvents}
              onPersistedEvents={onPersistedEvents}
              pendingAtomicRetry={pendingAtomicRetry}
              onPendingAtomicRetryChange={onPendingAtomicRetryChange}
              embedded
              targetAc={targetAc}
              onTargetAcChange={setTargetAc}
              targetSaveMod={targetSaveMod}
              onTargetSaveModChange={setTargetSaveMod}
              targetCharacterId={targetCharacterId}
              onTargetCharacterChange={setTargetCharacterId}
              encounterId={character.current_encounter_id ?? undefined}
              encounterApply={encounterApply}
              disabledReason={sheetActionDisabledReason}
            />}
          </CollapsibleSection>

          {assembled.spells.length > 0 && (
            <CollapsibleSection title="Заклинания">
              {/* Заклинания = 1:1 с блоком «Действия»: тот же SheetActionsPanel/
                  SheetActionLine (одна модель отображения строк и иконок), только
                  сгруппировано по кругам. Общий targetAc — поле не дублируется. */}
              {readOnly ? (
                <div className="cs-tags">
                  {assembled.spells.map((spell) => (
                    <span key={spell.id} className="cs-tag">{spell.name}</span>
                  ))}
                </div>
              ) : <SheetActionsPanel
                character={character}
                assembled={assembled}
                ruleState={ruleState}
                equipCards={equipCards}
                onUpdated={onUpdated}
                onEvents={onEvents}
                onPersistedEvents={onPersistedEvents}
                pendingAtomicRetry={pendingAtomicRetry}
                onPendingAtomicRetryChange={onPendingAtomicRetryChange}
                showAtomicRetryControl={false}
                embedded
                spellsOnly
                targetAc={targetAc}
                onTargetAcChange={setTargetAc}
                targetSaveMod={targetSaveMod}
                onTargetSaveModChange={setTargetSaveMod}
                targetCharacterId={targetCharacterId}
                onTargetCharacterChange={setTargetCharacterId}
                encounterId={character.current_encounter_id ?? undefined}
                encounterApply={encounterApply}
                disabledReason={sheetActionDisabledReason}
              />}
            </CollapsibleSection>
          )}
        </div>

        {/* ПРАВАЯ: инвентарь, черты и способности */}
        <div className="csheet-col">
          <CollapsibleSection title="Инвентарь и экипировка">
            {readOnly ? (
              (character.inventory_items?.length ?? 0) > 0 ? (
                <div className="cs-kv-list">
                  {(character.inventory_items ?? []).map((item, index) => (
                    <div key={`${item.card_id}:${item.container_id ?? 'root'}:${index}`} className="cs-kv">
                      <span>{equipCards.get(item.card_id)?.name ?? item.card_id}</span>
                      <b>×{item.qty}</b>
                    </div>
                  ))}
                </div>
              ) : <p className="cs-hook-note">Инвентарь пуст.</p>
            ) : <SheetEquipmentPanel
              character={character}
              ruleState={ruleState}
              onUpdated={onUpdated}
              embedded
              passives={passives}
              encounterApply={encounterApply}
            />}
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
              entries={assembled.effects.map(({ effect, origin }) => {
                const p = effectAbilityPresentation(effect, origin, assembled.feats, originLabel);
                return {
                  key: effect.id,
                  name: p.name,
                  imageUrl: effect.image_url,
                  fallbackImageUrl: p.fallbackImageUrl,
                  sourceLabel: p.sourceLabel,
                  effect: p.effect,
                };
              })}
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

      {!readOnly && <SheetInPlayController
        character={character}
        draft={draft}
        assembled={assembled}
        ruleState={ruleState}
        choices={inPlayChoices}
        resolved={draft.resolvedChoices}
        conflicts={ruleState.conflicts}
        onUpdated={onUpdated}
        equipCards={equipCards}
        longRestOpen={longRestOpen}
        onLongRestClose={() => setLongRestOpen(false)}
      />}

      {!readOnly && <SheetHpDialog
        open={hpOpen}
        onClose={() => setHpOpen(false)}
        character={character}
        maxHp={maxHP}
        maxHpBreakdown={maxHpBreakdown}
        onUpdated={onUpdated}
        onEvents={onEvents}
        conSaveBonus={ruleState.savingThrowBonuses.con}
        sheetCtx={sheetCtx}
        passives={passives}
        encounterApply={encounterApply}
      />}
    </div>
  );
};

export default CharacterSheetV2;
