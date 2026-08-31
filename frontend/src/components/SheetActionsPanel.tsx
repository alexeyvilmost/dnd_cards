import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { charactersV3Api, type CharacterEventRow } from '../character/api';
import { actionsApi, effectsApi } from '../api/client';
import { getCardsIndex } from '../utils/cardsIndex';
import type { AssembledCharacter } from '../character/assemble';
import { actionInteractsWithTarget, actionForcesTargetSave, collectSheetActions, collectGrantActionSlugs, collectGrantEffectSlugs, type SheetAction, type GrantedAction } from '../character/actionSheet';
import { useBasicActions } from '../character/basicActions';
import { collectItemMechanics, readAttunedIds } from '../character/attunement';
import { collectPassiveMechanics } from '../character/resourceInit';
import {
  buildCharacterContext,
  alignRuntimeHp,
  forgeToRuntimeState,
  buildTargetFromCharacter,
  writeRulesEngineRuntimeTurnState,
} from '../character/runtime';
import { encountersApi, type EncounterApply } from '../battle/encountersApi';
import { persistCharacterRuntime } from '../character/runtimePersistence';
import type { Combatant, BattleLogEntry, PendingSave, PendingAttack, SaveOutcome } from '../battle/encounterTypes';
import { pendingAttackDamage } from '../battle/pendingAttack';
import { describeEngineEvent, narrativeEvent } from '../engine/events';
import { rollD20 } from '../engine/roll';
import { isCharacterReadOnly, type ForgeCharacter } from '../character/types';
import type { CharacterRuleState } from '../character/rules/types';
import { isActionUsesKey } from '../engine/actionUses';
import { applyFreeuseCost, findFreeusePoolKey, freeuseKey, isFreeusePoolKey } from '../engine/freeuse';
import { startConcentration } from '../engine/concentration';
import { canPay } from '../engine/cost';
import { deniedCapabilities } from '../engine/modifiers';
import { plannedValuesRng, PLANNING_RNG } from '../engine/dicePlan';
import { executeRemoteManipulator, readTargetSave, InsufficientResourcesError } from '../engine/execute';
import { describeMechanicsLine } from '../engine/describeMechanics';
import {
  bindEquippedWeaponActionContext,
  equippedWeaponChoices,
  weaponActionAvailability,
  weaponAttackPreview,
} from '../engine/weapon';
import { costAmount } from '../engine/cost';
import { inventoryQty } from '../character/inventory';
import { expiryLabel, groupActiveEffectsForDisplay, removeActiveEffectGroup } from '../engine/effects';
import { useDiceDialog } from '../contexts/DiceDialogContext';
import { useChoiceDialog } from '../contexts/ChoiceDialogContext';
import { useToast } from '../contexts/ToastContext';
import { collectInPlayActionChoices } from '../mechanics/collectChoices';
import { findResource, useResourceOptions } from '../utils/resources';
import { useSiteSettings } from '../settings';
import { getSpellLevelLabel, SPELL_SCHOOL_OPTIONS, type Card } from '../types';
import { isSpellActionPrepared } from '../rules-core/spellcastingAccess';
import { collectSheetSpellCastOptions, type SheetSpellCastOption } from '../character/sheetSpellCastingUi';
import type { EngineEvent, ExecuteContext, ReactionOffer, RollLog, RuntimeState, TargetContext } from '../mvp/contracts';
import { getSettings } from '../settings';
import { useReactionPrompt } from '../contexts/ReactionPromptContext';
import SheetActionLine from './SheetActionLine';
import SpellPreview from './SpellPreview';
import FreeuseSpellsTile from './FreeuseSpellsTile';
import ActionPreview from './ActionPreview';
import SheetResourceTile from './SheetResourceTile';
import { loadMasteryEffects } from '../utils/mastery';
import {
  collectSheetPrimitiveChoices,
  executeSheetCanonicalAction,
  executeSheetAction,
  planSheetActionDice,
  sheetPrimitiveCastTimingIssue,
  validateSheetCanonicalAction,
  UnsupportedSheetPendingResolutionError,
  type SheetCanonicalActionContext,
} from '../character/sheetActionOrchestrator';
import {
  buildSheetPrimitiveCommandInput,
  isSheetNoPendingPrimitive,
  isSheetPendingCombatPrimitive,
  sheetActionRequiresActorTargets,
  sheetPrimitiveDefinitionIssue,
  sheetPrimitiveDisabledReason,
} from '../character/sheetPrimitiveUi';
import { projectRunnableSheetCanonicalActions } from '../character/sheetCanonicalActionProjection';
import { applyUnarmedDamageProfileToAction } from '../rules-core/fightingStyleComplexPrimitives';
import { sheetWorldInputFormContext } from '../character/sheetWorldInputForm';
import { useSheetWorldInputDialog } from './SheetWorldInputDialog';
import {
  useSheetCombatTargetDialog,
  type SheetCombatTargetCandidate,
} from './SheetCombatTargetDialog';
import SheetPendingCombatPanel from './SheetPendingCombatPanel';
import RemoteManipulatorControl, { remoteManipulatorSpec } from './RemoteManipulatorControl';
import SheetCompanionControls, {
  type SheetCompanionTouchDeclaration,
} from './SheetCompanionControls';
import {
  buildSheetCanonicalRuntime,
  projectSheetCanonicalPersistence,
  synchronizeSheetCanonicalRuntime,
  writeSheetCanonicalWorld,
} from '../character/sheetCanonicalWorld';
import type {
  ActorState,
  DecisionResponse,
  GameCommand,
  RuleActionDefinition,
  WorldState,
} from '../rules-core/domain';
import type { SheetCanonicalCommandInput } from '../character/sheetCanonicalCommand';
import { loadSheetCombatParticipant } from '../character/sheetCombatTargetRuntime';
import { playerFacingSheetActionError } from '../character/sheetActionError';
import {
  commitPreparedSheetAtomicWorld,
  prepareSheetAtomicWorldCommit,
  projectSheetAtomicParticipantWorld,
  type PreparedSheetAtomicWorldCommit,
} from '../character/sheetAtomicWorldCommit';
import {
  buildSheetCombatDeclaration,
  UNARMED_STRIKE_PRIMITIVE,
} from '../character/sheetCombatDeclaration';
import {
  advanceSheetCombatTurn,
  commitPreparedSheetCombat,
  clearSheetCombatSession,
  createSheetCombatSession,
  executeSheetCombatAction,
  hasSheetCombatSession,
  newSheetRuntimeCommandId,
  prepareSheetCombatCommit,
  readSheetCombatSession,
  assertCertifiedSheetCombatSession,
  resolveSheetCombatDecision,
  type PreparedSheetCombatCommit,
  type SheetCombatParticipantSeed,
  type SheetCombatSession,
  type SheetCombatTransition,
} from '../character/sheetCombatSession';
import {
  assertCertifiedSheetCombatActorAction,
  loadCertifiedSheetCombatCatalog,
  type CertifiedSheetCombatCatalog,
} from '../character/sheetCombatCertifiedCatalog';
import {
  buildDismissFamiliarCommand,
  buildPactBladeTouchCommand,
  buildPactTomeRestCommand,
  buildReappearFamiliarCommand,
  collectSheetCompanionControls,
} from '../character/sheetCompanionActions';
import {
  prepareSheetCompanionCommand,
  prepareSheetFamiliarTouchInteraction,
  sheetCompanionRetryPolicy,
  type PreparedSheetCompanionInteraction,
} from '../character/sheetCompanionInteraction';
import {
  commitSheetRuntimeCommand,
  type CommittedSheetRuntimeCommand,
} from '../character/sheetRuntimeCommand';
import {
  sheetAtomicRetryLabel,
  type SheetAtomicRetryEnvelope,
} from '../character/sheetAtomicRetry';
import {
  createSheetSceneTargetActor,
  buildSheetSceneTargetContext,
  TRAINING_DUMMY,
  TRAINING_DUMMY_TARGET_ID,
} from '../character/sheetSceneTargets';

interface Props {
  character: ForgeCharacter;
  assembled: AssembledCharacter;
  ruleState: CharacterRuleState;
  equipCards: Map<string, Card>;
  /** S3: механики эффектов, ВЫДАННЫХ предметами (grant_effect), для числового канала действий. */
  itemGrantedPassives?: Record<string, unknown>[];
  /** Истинный максимум HP (breakdown, с бонусами предметов/эффектов). Без него боевой кэп берёт
   *  «голый» ruleState.maxHP и, если предмет поднимает максимум, действие срезало бы HP до него. */
  maxHp?: number;
  onUpdated: (c: ForgeCharacter) => void;
  onEvents?: (events: EngineEvent[]) => void;
  /** Reconciles rows that the accepted atomic command already persisted. Never writes them again. */
  onPersistedEvents?: (rows: CharacterEventRow[]) => void;
  /** Controlled above sibling action/spell panels and section unmounts. */
  pendingAtomicRetry?: SheetAtomicRetryEnvelope | null;
  onPendingAtomicRetryChange?: (retry: SheetAtomicRetryEnvelope | null) => void;
  /** The parent may nominate one sibling as the retry-control owner. */
  showAtomicRetryControl?: boolean;
  embedded?: boolean;
  /** false — ресурсы/эффекты рисует соседняя SheetRuntimePanel (классический макет). */
  showResources?: boolean;
  showEffects?: boolean;
  /** Только заклинания, сгруппированные по кругам (блок «Заклинания» = 1:1 с блоком «Действия»). */
  spellsOnly?: boolean;
  /** Явный наблюдаемый факт «КЗ цели». null/undefined означает, что факт ещё не объявлен. */
  targetAc?: number | null;
  onTargetAcChange?: (n: number | null) => void;
  /** Контролируемый «Спас цели» (E5): единый модификатор спасброска цели
   *  (передаётся во все ability; движок берёт нужный по механике действия). */
  targetSaveMod?: number | null;
  onTargetSaveModChange?: (n: number | null) => void;
  /** Shared selection for action and spell panels of the same character sheet. */
  targetCharacterId?: string | null;
  onTargetCharacterChange?: (id: string | null) => void;
  /** Онлайн-бой: если персонаж сейчас в бою — id боя. Тогда пикер целей в диалоге кубов
   *  ограничивается комбатантами этого боя, а урон/лечение/эффекты применяются к комбатанту
   *  через encountersApi.apply (синк на доску боя и другие устройства), а не в запись персонажа. */
  encounterId?: string;
  /** Version-aware command writer from the active encounter stream. */
  encounterApply?: EncounterApply;
  /** Мобильный лист сначала открывает полноэкранную карточку, а применение запускает из неё. */
  onInspectAction?: (
    action: SheetAction,
    apply: () => void,
    disabledReason?: string,
  ) => void;
  disableHoverPreviews?: boolean;
}

/**
 * Atomic runtime commands have already written their journal rows inside the
 * server transaction. Keep both sheet event sinks visible at this boundary so
 * a regression test can prove that accepted atomic rows are reconciled through
 * the read-only sink and never sent back through the legacy writer.
 */
export function surfaceAcceptedSheetAtomicEvents(input: {
  rows?: CharacterEventRow[];
  onEvents?: (events: EngineEvent[]) => void;
  onPersistedEvents?: (rows: CharacterEventRow[]) => void;
}): void {
  if (!input.rows) return;
  input.onPersistedEvents?.(input.rows);
}

export function contextualizeSheetJournalEvents(input: {
  actionName: string;
  targetNames?: readonly string[];
  events: readonly EngineEvent[];
}): EngineEvent[] {
  if (!input.events.length) return [];
  const targets = [...new Set((input.targetNames ?? []).map((name) => name.trim()).filter(Boolean))];
  return [
    narrativeEvent(`${input.actionName}${targets.length ? ` → ${targets.join(', ')}` : ''}`),
    ...input.events,
  ];
}

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `id-${Math.random().toString(36).slice(2)}`);

export interface ExplicitSheetTargetFacts {
  armorClass: number | null | undefined;
  savingThrowModifier: number | null | undefined;
}

function targetResolutionRequirements(mechanics: Record<string, unknown>): {
  attack: boolean;
  save: boolean;
} {
  const effects = Array.isArray(mechanics.effects)
    ? mechanics.effects as Record<string, unknown>[]
    : [];
  return {
    attack: effects.some((effect) => effect.resolution === 'attack_roll'),
    save: effects.some((effect) => effect.resolution === 'save'),
  };
}

/** Legacy execution accepts no invented target statistics. */
export function explicitSheetTargetFactsIssue(
  mechanics: Record<string, unknown>,
  facts: ExplicitSheetTargetFacts,
): string | null {
  const required = targetResolutionRequirements(mechanics);
  if (required.attack && (typeof facts.armorClass !== 'number'
    || !Number.isFinite(facts.armorClass)
    || facts.armorClass <= 0)) {
    return 'Укажите КЗ цели или выберите персонажа с явно рассчитанной КЗ';
  }
  if (required.save && (typeof facts.savingThrowModifier !== 'number'
    || !Number.isSafeInteger(facts.savingThrowModifier))) {
    return 'Укажите модификатор спасброска цели или выберите персонажа с рассчитанными спасбросками';
  }
  return null;
}

export function explicitSheetTargetContext(
  mechanics: Record<string, unknown>,
  facts: ExplicitSheetTargetFacts,
): TargetContext | undefined {
  const issue = explicitSheetTargetFactsIssue(mechanics, facts);
  if (issue) throw new Error(issue);
  const required = targetResolutionRequirements(mechanics);
  if (!required.attack && !required.save) return undefined;
  return {
    ...(required.attack ? { ac: facts.armorClass as number } : {}),
    ...(required.save ? {
      saveMods: {
        dex: facts.savingThrowModifier as number,
        con: facts.savingThrowModifier as number,
        str: facts.savingThrowModifier as number,
        int: facts.savingThrowModifier as number,
        wis: facts.savingThrowModifier as number,
        cha: facts.savingThrowModifier as number,
      },
    } : {}),
  };
}

// Дельта исхода спасброска: изменение состояния цели после прогона движка относительно БАЗЫ
// прогона (baseHp/baseTemp). Прогон делается по цели с огромным hp, поэтому дельта несёт ИСТИННЫЙ
// урон без упора в 0 (ограничит уже цель по своему текущему hp). ts undefined (успешный негейт —
// движок не мутировал цель) → нулевая дельта.
function outcomeDelta(baseHp: number, baseTemp: number, prevEffects: { id?: string }[], ts: RuntimeState | undefined): SaveOutcome {
  if (!ts) return { hpDelta: 0, tempDelta: 0, addEffects: [] };
  const prevIds = new Set((prevEffects ?? []).map((e) => e.id));
  const addEffects = ((ts.activeEffects ?? []) as { id?: string; name?: string }[])
    .filter((e) => !(e.id && prevIds.has(e.id))) as SaveOutcome['addEffects'];
  return { hpDelta: ts.hp.current - baseHp, tempDelta: (ts.hp.temp ?? 0) - baseTemp, addEffects };
}

const GROUP_DETAIL: Record<SheetAction['group'], string> = {
  basic: 'Базовое действие', race: 'Вид', class: 'Класс', item: 'Предмет', spell: 'Заклинание',
};
const spellSchoolLabel = (s?: string | null) => SPELL_SCHOOL_OPTIONS.find((o) => o.value === s)?.label || s || '';
export function sheetActionDisplayName(
  action: Pick<SheetAction, 'name' | 'mechanics'>,
): string {
  const primitive = action.mechanics.primitive as Record<string, unknown> | undefined;
  if (primitive?.type !== 'weapon_attack') return action.name;
  const effects = Array.isArray(action.mechanics.effects)
    ? action.mechanics.effects as Array<Record<string, unknown>>
    : [];
  const attackKind = effects.find((effect) => effect.resolution === 'attack_roll')?.attack_kind;
  if (attackKind === 'weapon_ranged') return 'Дальнобойная атака оружием';
  if (attackKind === 'weapon_melee') return 'Рукопашная атака оружием';
  return action.name;
}
// Вторая строка ряда действия (как у предметов, но без веса/цены).
const actionDetail = (a: SheetAction): string => {
  if (a.spellRef) {
    const lvl = a.spellRef.level ?? a.level ?? 0;
    return `${lvl === 0 ? 'Заговор' : `${lvl} уровень`}${a.spellRef.school ? ` · ${spellSchoolLabel(a.spellRef.school)}` : ''}`;
  }
  if (a.group === 'basic') return 'Базовое действие';
  return a.sourceLabel ?? GROUP_DETAIL[a.group] ?? '';
};

/** Выбор источника оплаты каста: за ячейку уровня level или бесплатно (freeuse-пул). */
type CastChoice = { via: 'slot'; level: number } | { via: 'free' };

export function characterInteractionTargetOption(
  candidate: Pick<ForgeCharacter, 'id' | 'name' | 'access_mode'>,
  charmerIds: ReadonlySet<string>,
): { id: string; name: string; disabled?: true; reason?: string } {
  if (isCharacterReadOnly(candidate)) {
    return {
      id: candidate.id,
      name: candidate.name,
      disabled: true,
      reason: 'архивный публичный лист доступен только для чтения',
    };
  }
  if (charmerIds.has(candidate.id)) {
    return {
      id: candidate.id,
      name: candidate.name,
      disabled: true,
      reason: 'вы очарованы им',
    };
  }
  return { id: candidate.id, name: candidate.name };
}

/** Target relations are mechanics-owned; localized names never decide picker membership. */
export function sheetMechanicsAllowsSelfTarget(mechanics: Record<string, unknown>): boolean {
  const targeting = mechanics.targeting as Record<string, unknown> | undefined;
  return Array.isArray(targeting?.allowed_relations)
    && targeting.allowed_relations.includes('self');
}

export function sheetSelectedTargetRelationIssue(input: {
  actorId: string;
  targetId?: string;
  allowsSelf: boolean;
}): string | null {
  return input.targetId === input.actorId && !input.allowsSelf
    ? 'Выбранное действие не разрешает цель «на себя»'
    : null;
}

function sameRuntimeValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function runtimeRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Legacy execution projects source and target state separately. When both are
 * the same actor, perform a three-way merge and reject genuinely conflicting
 * mutations instead of losing either the action cost or the target effect.
 */
function mergeSelfTargetValue(
  before: unknown,
  source: unknown,
  target: unknown,
  path: string,
): unknown {
  if (sameRuntimeValue(source, before)) return target;
  if (sameRuntimeValue(target, before) || sameRuntimeValue(source, target)) return source;
  if (runtimeRecord(before) && runtimeRecord(source) && runtimeRecord(target)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(source), ...Object.keys(target)]);
    return Object.fromEntries([...keys].map((key) => [
      key,
      mergeSelfTargetValue(before[key], source[key], target[key], `${path}.${key}`),
    ]));
  }
  throw new Error(`Self-targeted action changes ${path} through conflicting source and target paths`);
}

export function mergeSelfTargetRuntime(
  before: RuntimeState,
  source: RuntimeState,
  target: RuntimeState,
): RuntimeState {
  return mergeSelfTargetValue(before, source, target, 'runtime') as RuntimeState;
}

/** Keep subsequent interactions in this tab on the exact server-committed runtime snapshot. */
export function replaceCachedInteractionTarget(
  cached: readonly ForgeCharacter[],
  persisted: ForgeCharacter,
): ForgeCharacter[] {
  return cached.some((candidate) => candidate.id === persisted.id)
    ? cached.map((candidate) => candidate.id === persisted.id ? persisted : candidate)
    : [...cached, persisted];
}

/** Апкаст (D1): заклинание со стоимостью spell_slot уровня N доступно, если есть ЛЮБОЙ
 *  слот уровня ≥ N (не только базового) — иначе кастер со свободным старшим слотом, но
 *  потраченным базовым, не смог бы кастовать. Прочие ресурсы стоимости — обычной проверкой.
 *  freeuseAvailable снимает ТОЛЬКО требование ячейки (каст из пула бесплатных использований),
 *  но НЕ экономику действий: не-слотовые косты (основное/бонусное действие, реакция, предмет)
 *  проверяются всегда — без свободного действия заклинание недоступно даже при freeuse. */
export function payableWithUpcast(runtime: RuntimeState, cost: Record<string, unknown>[], freeuseAvailable = false): boolean {
  const slot = cost.find((c) => String(c.resource ?? '') === 'spell_slot' && c.level != null);
  const nonSlot = cost.filter((c) => c !== slot);
  if (nonSlot.length && !canPay(runtime, nonSlot).ok) return false;
  if (slot && !freeuseAvailable) {
    const base = Number(slot.level) || 0;
    const need = Number(slot.amount ?? 1) || 1;
    let ok = false;
    for (let L = base; L <= 9; L++) if ((runtime.resources[`spell_slot_${L}`] ?? 0) >= need) { ok = true; break; }
    if (!ok) return false;
  }
  return true;
}

function persistPayload(state: RuntimeState, prevTurnState: Record<string, unknown> | null | undefined, includeInventory: boolean) {
  return {
    current_hp: state.hp.current,
    max_hp: state.hp.max,
    resources: state.resources,
    max_resources: state.maxResources,
    active_effects: state.activeEffects,
    // S4: инвентарь персистим ТОЛЬКО когда действие реально израсходовало предмет — иначе каждое
    // действие затирало бы inventory_items локальным снимком и могло откатить параллельное изменение
    // сумки (экипировка/покупка/расход в другой вкладке). Бэкенд уже принимает inventory_items.
    ...(includeInventory ? { inventory_items: state.inventory.map((r) => ({ card_id: r.cardId, qty: r.qty, ...(r.containerId ? { container_id: r.containerId } : {}) })) } : {}),
    // temp_hp обновляем, остальные поля turn_state (спасброски смерти) сохраняем
    turn_state: writeRulesEngineRuntimeTurnState(prevTurnState, state),
  };
}

/** Действие тратит ЛЮБОЙ ресурс — основное/бонусное действие, реакцию, слот заклинания, заряд,
 *  очки, расходник. Для таких при включённом диалоге кубов показываем «Применить»/«Отмена». */
function spendsResource(mech: Record<string, unknown>): boolean {
  const activation = mech.activation as Record<string, unknown> | undefined;
  const cost = activation?.cost as Record<string, unknown>[] | undefined;
  if (!Array.isArray(cost)) return false;
  return cost.some((c) => !!String(c.resource ?? ''));
}

function mechanicsPrimitiveType(mechanics: Record<string, unknown>): string | null {
  const primitive = mechanics.primitive;
  if (!primitive || typeof primitive !== 'object' || Array.isArray(primitive)) return null;
  const type = (primitive as Record<string, unknown>).type;
  return typeof type === 'string' && type ? type : null;
}

/** Every spell row uses canonical grant/preparation access, primitive or not. */
export function sheetActionNeedsCanonicalAvailability(
  action: Pick<SheetAction, 'mechanics' | 'spellRef'>,
): boolean {
  return action.spellRef !== undefined || mechanicsPrimitiveType(action.mechanics) !== null;
}

/**
 * Compatibility projection for the data-owned basic Unarmed Strike row. It is
 * structural (not tied to an id/name), so another entity with the same generic
 * attack contract can reuse the scene-target flow.
 */
export function legacyUnarmedTargetAction(action: SheetAction): RuleActionDefinition | null {
  const effects = Array.isArray(action.mechanics.effects)
    ? action.mechanics.effects as Record<string, unknown>[]
    : [];
  if (mechanicsPrimitiveType(action.mechanics)
    || !effects.some((effect) => (
      effect.resolution === 'attack_roll' && effect.attack_kind === 'unarmed'
    ))) return null;
  const targeting = action.mechanics.targeting;
  const declared = targeting && typeof targeting === 'object' && !Array.isArray(targeting)
    ? targeting as Record<string, unknown>
    : {};
  const rangeMatch = String(declared.range ?? '').match(/\d+/);
  const rangeFt = rangeMatch ? Number(rangeMatch[0]) : 5;
  const sourceId = action.actionRef?.id ?? action.id;
  const sourceCard = action.actionRef?.card_number ?? action.id;
  return {
    id: action.id,
    name: action.name,
    kind: 'nonSpell',
    sourceEntityIds: [sourceId, sourceCard],
    mechanics: {
      ...action.mechanics,
      primitive: { type: UNARMED_STRIKE_PRIMITIVE },
      targeting: {
        domain: 'actor',
        actor_targets: true,
        shape: 'single',
        min_targets: 1,
        max_targets: 1,
        range_ft: rangeFt,
        requires_line_of_sight: true,
        allowed_relations: ['enemy'],
      },
    },
    targeting: {
      minTargets: 1,
      maxTargets: 1,
      rangeFt,
      requiresLineOfSight: true,
      allowedRelations: ['enemy'],
    },
  };
}

export default function SheetActionsPanel({
  character,
  assembled,
  ruleState,
  equipCards,
  itemGrantedPassives,
  maxHp,
  onUpdated,
  onEvents,
  onPersistedEvents,
  pendingAtomicRetry: pendingAtomicRetryProp,
  onPendingAtomicRetryChange,
  showAtomicRetryControl = true,
  embedded,
  showResources = true,
  showEffects = true,
  spellsOnly = false,
  targetAc: targetAcProp,
  onTargetAcChange,
  targetSaveMod: targetSaveModProp,
  onTargetSaveModChange,
  targetCharacterId: targetCharacterIdProp,
  onTargetCharacterChange,
  encounterId,
  encounterApply,
  onInspectAction,
  disableHoverPreviews = false,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Пикер источника оплаты каста (D1 апкаст + freeuse): промис-модалка без нового провайдера.
  // via:'slot' — за ячейку уровня level; via:'free' — из пула бесплатных использований.
  const [slotPick, setSlotPick] = useState<{
    baseLevel: number;
    options: number[];
    freeuse?: { current: number; max: number; level: number };
    resolve: (v: CastChoice | null) => void;
  } | null>(null);
  const requestCastChoice = (baseLevel: number, options: number[], freeuse?: { current: number; max: number; level: number }) =>
    new Promise<CastChoice | null>((resolve) => setSlotPick({ baseLevel, options, freeuse, resolve }));
  const resolveCast = (v: CastChoice | null) => { slotPick?.resolve(v); setSlotPick(null); };
  const [localTargetAc, setLocalTargetAc] = useState<number | null>(10);
  // E4: если родитель управляет «КЗ цели» — используем его; иначе локальный стейт.
  const targetAc = targetAcProp ?? localTargetAc;
  const setTargetAc = (n: number | null) => {
    if (onTargetAcChange) onTargetAcChange(n);
    else setLocalTargetAc(n);
  };
  const [localTargetSaveMod, setLocalTargetSaveMod] = useState<number | null>(0);
  // E5: единый модификатор спасброска цели (раньше saveMods жёстко = 0).
  const targetSaveMod = targetSaveModProp ?? localTargetSaveMod;
  const setTargetSaveMod = (n: number | null) => {
    if (onTargetSaveModChange) onTargetSaveModChange(n);
    else setLocalTargetSaveMod(n);
  };
  // One selected sheet supplies real AC, saves, HP and effects. Manual target
  // facts remain available when the target is not represented by a sheet.
  const targetCharsRef = useRef<ForgeCharacter[] | null>(null);
  const loadTargetChars = useCallback(async (): Promise<ForgeCharacter[]> => {
    if (targetCharsRef.current) return targetCharsRef.current;
    try {
      const list = await charactersV3Api.list();
      targetCharsRef.current = list;
      return list;
    } catch { return []; }
  }, []);
  const [availableSheetTargets, setAvailableSheetTargets] = useState<ForgeCharacter[]>([]);
  const [localSelectedSheetTargetId, setLocalSelectedSheetTargetId] = useState('');
  const selectedSheetTargetId = targetCharacterIdProp ?? localSelectedSheetTargetId;
  const setSelectedSheetTargetId = (id: string) => {
    if (onTargetCharacterChange) onTargetCharacterChange(id || null);
    else setLocalSelectedSheetTargetId(id);
  };
  const diceDialog = useDiceDialog();
  const choiceDialog = useChoiceDialog();
  const worldInputDialog = useSheetWorldInputDialog();
  const combatTargetDialog = useSheetCombatTargetDialog();
  const reactionPrompt = useReactionPrompt();
  const { showToast } = useToast();
  const [localAtomicRetry, setLocalAtomicRetry] = useState<SheetAtomicRetryEnvelope | null>(null);
  const pendingAtomicRetryCandidate = pendingAtomicRetryProp === undefined
    ? localAtomicRetry
    : pendingAtomicRetryProp;
  const pendingAtomicRetry = pendingAtomicRetryCandidate?.characterId === character.id
    ? pendingAtomicRetryCandidate
    : null;
  const setPendingAtomicRetry = (retry: SheetAtomicRetryEnvelope | null) => {
    if (onPendingAtomicRetryChange) onPendingAtomicRetryChange(retry);
    else setLocalAtomicRetry(retry);
  };

  const resetCombatContinuation = useCallback(async () => {
    if (!hasSheetCombatSession(character.turn_state)) return;
    if (!window.confirm(
      'Сбросить сохранённое продолжение одиночного боя? Уже применённые хиты и потраченные ресурсы останутся в листе.',
    )) return;
    if (!Number.isSafeInteger(character.runtime_revision)) {
      setError('Нельзя сбросить бой без server runtime_revision');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await charactersV3Api.patchRuntime(character.id, {
        expected_runtime_revision: character.runtime_revision,
        turn_state: clearSheetCombatSession(character.turn_state),
      });
      onUpdated(updated);
      showToast({
        type: 'success',
        title: 'Одиночный бой завершён',
        message: 'Сохранённое продолжение боя сброшено.',
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [character, onUpdated, showToast]);
  const [certifiedCombat, setCertifiedCombat] = useState<{
    catalog: CertifiedSheetCombatCatalog | null;
    error: Error | null;
    loading: boolean;
  }>({ catalog: null, error: null, loading: true });
  useEffect(() => {
    let active = true;
    void loadCertifiedSheetCombatCatalog()
      .then((catalog) => {
        if (active) setCertifiedCombat({ catalog, error: null, loading: false });
      })
      .catch((cause) => {
        if (active) setCertifiedCombat({
          catalog: null,
          error: cause instanceof Error ? cause : new Error(String(cause)),
          loading: false,
        });
      });
    return () => { active = false; };
  }, []);

  const runtime = useMemo(
    () => alignRuntimeHp(forgeToRuntimeState(character), maxHp ?? ruleState.maxHP),
    [character, maxHp, ruleState.maxHP],
  );
  const combatContinuation = useMemo((): {
    session: SheetCombatSession | null;
    error: Error | null;
  } => {
    try {
      return {
        session: readSheetCombatSession(
          character.turn_state,
          character.id,
          character.runtime_revision,
          certifiedCombat.catalog?.ruleset,
        ),
        error: null,
      };
    } catch (cause) {
      return {
        session: null,
        error: cause instanceof Error ? cause : new Error(String(cause)),
      };
    }
  }, [
    character.id,
    character.runtime_revision,
    character.turn_state,
    certifiedCombat.catalog?.ruleset,
  ]);
  // Пассивки персонажа + механики надетых предметов (с учётом настройки).
  const passives = useMemo(() => {
    const items = collectItemMechanics(character.equipment ?? {}, equipCards, character.turn_state, runtime.inventory)
      .map((im) => im.mechanics);
    // S3: выданные предметами эффекты (grant_effect) — тот же числовой канал, что и механики предметов.
    return [...collectPassiveMechanics(assembled, character.resolved_choices ?? {}), ...items, ...(itemGrantedPassives ?? [])];
  }, [assembled, character.equipment, character.turn_state, character.resolved_choices, equipCards, runtime.inventory, itemGrantedPassives]);

  // D: способности экономики хода, запрещённые состояниями (Недееспособный → действие/бонусное/
  // реакция/концентрация). Гейтят запуск и доступность действий с соответствующей стоимостью.
  const deniedCaps = useMemo(() => deniedCapabilities(runtime, passives), [runtime, passives]);

  // E: id существ, очаровавших меня (sourceId condition:charmed). Их нельзя выбирать целью.
  const charmerIds = useMemo(() => {
    const out = new Set<string>();
    for (const e of runtime.activeEffects ?? []) {
      const m = e.mechanics as Record<string, unknown> | undefined;
      if (m?.kind === 'condition' && m?.value === 'charmed' && e.sourceId) out.add(e.sourceId);
    }
    return out;
  }, [runtime]);
  const selectedSheetTarget = useMemo(() => (
    availableSheetTargets.find((candidate) => candidate.id === selectedSheetTargetId)
  ), [availableSheetTargets, selectedSheetTargetId]);
  useEffect(() => {
    let active = true;
    void loadTargetChars().then((candidates) => {
      if (active) setAvailableSheetTargets(candidates.filter((candidate) => (
        !isCharacterReadOnly(candidate)
      )));
    });
    return () => { active = false; };
  }, [character.id, loadTargetChars]);

  // D: причина запрета действия недееспособностью (стоимость с запрещённым типом / концентрация).
  const CAP_RU: Record<string, string> = {
    action: 'тратить действие', bonus_action: 'тратить бонусное действие',
    reaction: 'использовать реакцию', concentration: 'концентрироваться',
  };
  const deniedActionReason = (action: SheetAction, cost: Record<string, unknown>[]): string | null => {
    if (!deniedCaps.size) return null;
    const cap = cost.map((c) => String(c.resource ?? '')).find((r) => deniedCaps.has(r));
    if (cap) return `Недееспособен: нельзя ${CAP_RU[cap] ?? cap}`;
    const dur = action.mechanics.duration as Record<string, unknown> | undefined;
    if (deniedCaps.has('concentration') && dur?.concentration) return 'Недееспособен: нельзя концентрироваться';
    return null;
  };

  const equippedCards = useMemo(() => {
    const out: Card[] = [];
    for (const id of Object.values(runtime.equipment)) {
      if (id && equipCards.has(id)) out.push(equipCards.get(id)!);
    }
    return out;
  }, [runtime.equipment, equipCards]);

  const ctx = useMemo(
    () => ({
      ...buildCharacterContext(
        ruleState,
        { level: character.level, abilities: character.abilities ?? {} },
        equippedCards,
        assembled.klass,
      ),
      spellcastingMod: ruleState.spellcasting
        ? ruleState.abilityMods[ruleState.spellcasting.ability]
        : undefined,
      passives,
      // Настройка на предметы: ненастроенный магический предмет даёт только чистые статы.
      attunedIds: readAttunedIds(character.turn_state),
    }),
    [ruleState, character, equippedCards, assembled.klass, passives],
  );

  const itemMechs = useMemo(
    () => collectItemMechanics(character.equipment ?? {}, equipCards, character.turn_state, runtime.inventory),
    [character.equipment, character.turn_state, equipCards, runtime.inventory],
  );
  const basicActions = useBasicActions();

  // grant_action: доступ к библиотечному действию по slug. Источники — ПРЕДМЕТЫ (S6, приёмы оружия
  // BG3) И ПАССИВКИ-эффекты вида/класса/черты (дыхание Драконорождённого, откровение Аасимара).
  // Карта действия несёт экономику/поведение; здесь только доступ к нему на листе.
  const [grantedActions, setGrantedActions] = useState<GrantedAction[]>([]);
  useEffect(() => {
    if (spellsOnly) { setGrantedActions((p) => (p.length ? [] : p)); return; }
    const refs: { slug: string; sourceLabel: string; group: SheetAction['group'] }[] = [];
    const seen = new Set<string>();
    const collect = (mech: Record<string, unknown> | null | undefined, sourceLabel: string, group: SheetAction['group']) => {
      for (const slug of collectGrantActionSlugs(mech, character.level)) {
        if (seen.has(slug)) continue;
        seen.add(slug);
        refs.push({ slug, sourceLabel, group });
      }
    };
    for (const im of itemMechs) collect(im.card.mechanics, im.card.name, 'item');
    for (const { effect, origin } of assembled.effects) {
      collect(effect.mechanics as Record<string, unknown>, effect.name, origin.kind === 'race' ? 'race' : 'class');
    }
    if (!refs.length) { setGrantedActions((p) => (p.length ? [] : p)); return; }
    let stale = false;
    Promise.all(refs.map((r): Promise<GrantedAction | null> => actionsApi.getAction(r.slug)
      .then((action): GrantedAction => ({ action, sourceLabel: r.sourceLabel, group: r.group }))
      .catch(() => null)))
      .then((list) => { if (!stale) setGrantedActions(list.filter((x): x is GrantedAction => x !== null)); })
      .catch(() => { if (!stale) setGrantedActions((p) => (p.length ? [] : p)); });
    return () => { stale = true; };
  }, [itemMechs, assembled.effects, character.level, spellsOnly]);

  // S3-полировка (#32): общий индекс карт — резолвер имён СОДЕРЖИМОГО контейнера (его карты не в
  // equipCards, т.к. лежат внутри мешка) для диалога выбора «Достать» и журнала распаковки.
  const [cardsIndex, setCardsIndex] = useState<Map<string, Card>>(new Map());
  const [cardsIndexReady, setCardsIndexReady] = useState(false);
  const [cardsIndexError, setCardsIndexError] = useState<Error | null>(null);
  useEffect(() => {
    let alive = true;
    getCardsIndex()
      .then((m) => {
        if (!alive) return;
        setCardsIndex(m);
        setCardsIndexReady(true);
        setCardsIndexError(null);
      })
      .catch((cause) => {
        if (!alive) return;
        setCardsIndexError(cause instanceof Error ? cause : new Error(String(cause)));
      });
    return () => { alive = false; };
  }, []);

  // S2/S3 контейнеры: носимые карты-контейнеры → действие «Распаковать» (mode='all') или «Достать» (mode='choice').
  const containerCards = useMemo(() => {
    const ids = new Set<string>();
    for (const r of runtime.inventory) ids.add(r.cardId);
    for (const id of Object.values(runtime.equipment)) if (id) ids.add(id);
    const out: Card[] = [];
    for (const id of ids) {
      const card = equipCards.get(id);
      if (card && (card.container_mode === 'all' || card.container_mode === 'choice') && Array.isArray(card.contents) && card.contents.length) out.push(card);
    }
    return out;
  }, [runtime.inventory, runtime.equipment, equipCards]);

  const collectedActions = useMemo(
    () => collectSheetActions(assembled, itemMechs, basicActions, grantedActions, containerCards,
      (id) => equipCards.get(id)?.name ?? cardsIndex.get(id)?.name),
    [assembled, itemMechs, basicActions, grantedActions, containerCards, equipCards, cardsIndex],
  );
  const contextualCostProjection = useMemo(() => {
    const issues = new Map<string, string>();
    const projected = collectedActions.map((action) => {
      try {
        const contextual = {
          ...action,
          mechanics: bindEquippedWeaponActionContext(
            action.mechanics,
            runtime.equipment,
            equipCards,
          ),
        };
        const heldCards = (['main_hand', 'off_hand'] as const)
          .flatMap((slot) => {
            const cardId = runtime.equipment[slot];
            return cardId && equipCards.get(cardId) ? [equipCards.get(cardId)!] : [];
          });
        const unarmedFacts = {
          holdingWeaponOrShield: heldCards.some((card) => (
            card.type === 'weapon' || card.type === 'shield' || card.defense_type === 'shield'
          )),
        };
        const profiled = applyUnarmedDamageProfileToAction(contextual, passives, unarmedFacts);
        const profiledActionRef = action.actionRef
          ? applyUnarmedDamageProfileToAction(action.actionRef, passives, unarmedFacts)
          : undefined;
        return {
          ...profiled,
          ...(profiledActionRef
            ? { actionRef: { ...profiledActionRef, mechanics: profiled.mechanics } }
            : {}),
        };
      } catch (cause) {
        issues.set(action.id, cause instanceof Error ? cause.message : String(cause));
        return action;
      }
    });
    return { actions: projected, issues };
  }, [collectedActions, runtime.equipment, equipCards, passives]);
  const allActions = contextualCostProjection.actions;

  // Триггерные способности-СЛУШАТЕЛИ (interrupt): mode reaction/triggered + activation.trigger.event
  // (Божественная кара при попадании, особенности Голиафа). Отдаём движку как ctx.triggers; из
  // кликабельного списка исключаем — их нельзя применить проактивно, только по событию.
  const isTriggerAbility = (m: Record<string, unknown> | undefined): boolean => {
    const act = m?.activation as Record<string, unknown> | undefined;
    const mode = String(act?.mode ?? '');
    return !!(act?.trigger as Record<string, unknown> | undefined)?.event && (mode === 'reaction' || mode === 'triggered');
  };
  const triggerSources = useMemo(
    () => allActions.filter((a) => isTriggerAbility(a.mechanics)).map((a) => ({ ...a.mechanics, name: a.name, id: a.mechanics?.id ?? a.name })),
    [allActions],
  );
  const actions = useMemo(() => allActions.filter((a) => !isTriggerAbility(a.mechanics)), [allActions]);
  const canonicalSheetActions = useMemo(() => projectRunnableSheetCanonicalActions({
    actions: collectedActions,
    equipment: runtime.equipment,
    cards: equipCards,
    passives,
  }).actions, [collectedActions, runtime.equipment, equipCards, passives]);

  // Доспехи мага и т.п.: каст выдаёт ОТДЕЛЬНЫЙ эффект через grant_effect. Движок синхронный —
  // предзагружаем механику каждого выдаваемого эффекта по slug (кэш getEffect), кладём в execCtx,
  // чтобы applyGrantEffect поставил стоячий активный эффект (set_value ac_base → КЗ обновится).
  const [grantedEffectsBySlug, setGrantedEffectsBySlug] = useState<Record<string, { name?: string; mechanics?: unknown; repeatable?: boolean }>>({});
  // Искусность оружия (Weapon Mastery 2024): движок синхронный, поэтому механику мастерства
  // (как и grantedEffects) резолвим заранее — id эффекта из card.mastery → {name, mechanics}.
  // Без этой карты мастерство молча не сработает.
  const [masteryById, setMasteryById] = useState<Record<string, { name?: string; mechanics?: unknown }>>({});
  useEffect(() => {
    let stale = false;
    loadMasteryEffects().then((list) => {
      if (stale) return;
      const map: Record<string, { name?: string; mechanics?: unknown }> = {};
      for (const e of list) map[e.id] = { name: e.name, mechanics: e.mechanics };
      setMasteryById(map);
    });
    return () => { stale = true; };
  }, []);
  const grantEffectSlugs = useMemo(() => {
    const set = new Set<string>();
    for (const a of actions) for (const slug of collectGrantEffectSlugs(a.mechanics)) set.add(slug);
    return [...set];
  }, [actions]);
  useEffect(() => {
    if (!grantEffectSlugs.length) { setGrantedEffectsBySlug((p) => (Object.keys(p).length ? {} : p)); return; }
    let stale = false;
    Promise.all(grantEffectSlugs.map((slug) => effectsApi.getEffect(slug)
      .then((eff) => [slug, { name: eff.name, mechanics: eff.mechanics, repeatable: eff.repeatable }] as const)
      .catch(() => null)))
      .then((pairs) => {
        if (stale) return;
        const map: Record<string, { name?: string; mechanics?: unknown; repeatable?: boolean }> = {};
        for (const p of pairs) if (p) map[p[0]] = p[1];
        setGrantedEffectsBySlug(map);
      })
      .catch(() => { if (!stale) setGrantedEffectsBySlug((p) => (Object.keys(p).length ? {} : p)); });
    return () => { stale = true; };
  }, [grantEffectSlugs.join('|')]);

  const canonicalBuild = useMemo(() => {
    const needsCanonical = allActions.some((candidate) => (
      sheetActionNeedsCanonicalAvailability(candidate)
    )) || assembled.effects.some(({ effect }) => (
      mechanicsPrimitiveType((effect.mechanics ?? {}) as Record<string, unknown>)?.startsWith('pact_') === true
    ));
    if (!needsCanonical) return { runtime: null, error: null };
    if (!cardsIndexReady) {
      return {
        runtime: null,
        error: cardsIndexError
          ? new Error(`Не удалось загрузить канонический каталог карт: ${cardsIndexError.message}`)
          : new Error('Канонический каталог карт ещё загружается'),
      };
    }
    try {
      return {
        runtime: buildSheetCanonicalRuntime({
          character,
          assembled,
          ruleState,
          sheetActions: canonicalSheetActions,
          runtime,
          characterContext: ctx,
          passives,
          grantedEffects: grantedEffectsBySlug,
          masteryEffects: masteryById,
          cards: [...new Map([
            ...cardsIndex.entries(),
            ...equipCards.entries(),
          ]).values()],
          ac: ruleState.armorClass,
        }),
        error: null,
      };
    } catch (cause) {
      return {
        runtime: null,
        error: cause instanceof Error ? cause : new Error(String(cause)),
      };
    }
  }, [
    allActions,
    canonicalSheetActions,
    assembled,
    character,
    runtime,
    ctx,
    passives,
    grantedEffectsBySlug,
    masteryById,
    equipCards,
    cardsIndex,
    cardsIndexReady,
    cardsIndexError,
    ruleState,
  ]);

  const canonicalFor = (action: SheetAction): SheetCanonicalActionContext | undefined => {
    if (!sheetActionNeedsCanonicalAvailability(action)) return undefined;
    if (canonicalBuild.error) throw canonicalBuild.error;
    if (!canonicalBuild.runtime) {
      throw new Error('Каноническое состояние правил листа недоступно');
    }
    return { runtime: canonicalBuild.runtime, action: canonicalBuild.runtime.actionFor(action) };
  };

  const companionModel = useMemo(() => {
    if (!canonicalBuild.runtime) return null;
    try {
      return collectSheetCompanionControls({
        runtime: canonicalBuild.runtime,
        onlineEncounterId: encounterId ?? character.current_encounter_id,
      });
    } catch {
      return null;
    }
  }, [canonicalBuild.runtime, encounterId, character.current_encounter_id]);

  const resourceOptions = useResourceOptions();
  const { entityDisplay } = useSiteSettings();
  const actionsAsIcons = entityDisplay.actions === 'icon';
  // uses_<key> и freeuse-<spell> — виртуальные пулы: не плитки-ресурсы (freeuse рисуется
  // отдельной витриной FreeuseSpellsRow, uses — на строке действия).
  const resourceKeys = Object.keys(runtime.maxResources)
    .filter((k) => runtime.maxResources[k] > 0 && !isActionUsesKey(k) && !isFreeusePoolKey(k));

  const apply = useCallback(async (
    next: RuntimeState,
    events: EngineEvent[],
    canonicalWorld?: WorldState,
  ) => {
    setBusy(true);
    setError(null);
    try {
      // Инвентарь персистим при любом его изменении: расход (item_consumed) ИЛИ выдача (item_added, S1 контейнеры).
      const inventoryChanged = events.some((e) => e.type === 'item_consumed' || e.type === 'item_added');
      let turnState = character.turn_state;
      let runtimeToPersist = next;
      let currency: Record<string, number> | undefined;
      if (canonicalBuild.runtime) {
        const world = synchronizeSheetCanonicalRuntime(
          canonicalWorld ?? canonicalBuild.runtime.world,
          canonicalBuild.runtime.actorId,
          next,
          Object.keys(canonicalBuild.runtime.resourceBindings),
        );
        const projection = projectSheetCanonicalPersistence({
          runtime: world.actors[canonicalBuild.runtime.actorId].runtime,
          currency: character.currency,
          resourceBindings: canonicalBuild.runtime.resourceBindings,
        });
        runtimeToPersist = projection.runtime;
        currency = projection.currency;
        turnState = writeSheetCanonicalWorld(
          character.turn_state,
          canonicalBuild.runtime.actorId,
          world,
          canonicalBuild.runtime.resourceBindings,
        );
      }
      const updated = await persistCharacterRuntime(
        character,
        {
          ...persistPayload(runtimeToPersist, turnState, inventoryChanged),
          ...(currency ? { currency } : {}),
        },
        encounterApply,
      );
      onUpdated(updated);
      onEvents?.(events);
    } catch (e) {
      console.error(e);
      setError('Не удалось выполнить действие');
    } finally {
      setBusy(false);
    }
  }, [character, encounterApply, onUpdated, onEvents, canonicalBuild.runtime]);

  // freeuse-пул заклинания-действия (каст без ячейки) с текущим/макс. запасом и
  // фиксированным кругом бесплатного каста (spec.level или базовый круг). null — нет пула/зарядов.
  const freeuseFor = (action: SheetAction): { key: string; current: number; max: number; level: number } | null => {
    if (!action.spellRef) return null;
    const key = findFreeusePoolKey(runtime.resources, { cardNumber: action.spellRef.card_number, id: action.spellRef.id });
    if (!key || (runtime.resources[key] ?? 0) <= 0) return null;
    const spec = ruleState.freeuseSpells.find((s) => freeuseKey(s.spell) === key);
    const base = action.spellRef.level ?? action.level ?? 0;
    return { key, current: runtime.resources[key] ?? 0, max: runtime.maxResources[key] ?? 0, level: spec?.level ?? base };
  };

  const [companionTargets, setCompanionTargets] = useState<ForgeCharacter[]>([]);
  useEffect(() => {
    if (!companionModel?.familiar || !companionModel.touchSpells.length) {
      setCompanionTargets((current) => current.length ? [] : current);
      return;
    }
    let active = true;
    void loadTargetChars().then((listed) => {
      if (active) setCompanionTargets(listed.filter((candidate) => candidate.id !== character.id));
    });
    return () => { active = false; };
  }, [companionModel?.familiar?.actorId, companionModel?.touchSpells.length, character.id, loadTargetChars]);

  const runSingleCompanionCommand = async (command: GameCommand) => {
    if (!canonicalBuild.runtime || pendingAtomicRetry) return;
    try {
      const prepared = prepareSheetCompanionCommand({
        participant: { character, canonical: canonicalBuild.runtime },
        onlineEncounterId: encounterId ?? character.current_encounter_id,
        command,
        rng: Math.random,
      });
      await commitCompanionInteraction(prepared);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const handleCompanionDismiss = (mode: 'temporary' | 'forever') => {
    if (!canonicalBuild.runtime) return;
    if (mode === 'forever' && !window.confirm('Отпустить фамильяра навсегда?')) return;
    const command = buildDismissFamiliarCommand({
      runtime: canonicalBuild.runtime,
      onlineEncounterId: encounterId ?? character.current_encounter_id,
      commandId: newSheetRuntimeCommandId(),
      mode,
    });
    void runSingleCompanionCommand(command);
  };

  const handleCompanionReappear = (facts: {
    distanceFt: number;
    lineOfSight: boolean;
    unoccupiedSpace: true;
  }) => {
    if (!canonicalBuild.runtime) return;
    const command = buildReappearFamiliarCommand({
      runtime: canonicalBuild.runtime,
      onlineEncounterId: encounterId ?? character.current_encounter_id,
      commandId: newSheetRuntimeCommandId(),
      facts: {
        factsSource: 'scenario',
        boardRevision: canonicalBuild.runtime.world.revision,
        ...facts,
      },
    });
    void runSingleCompanionCommand(command);
  };

  const handlePactTomeReplace = (rest: 'short' | 'long') => {
    if (!canonicalBuild.runtime) return;
    const commandId = newSheetRuntimeCommandId();
    const command = buildPactTomeRestCommand({
      runtime: canonicalBuild.runtime,
      onlineEncounterId: encounterId ?? character.current_encounter_id,
      commandId,
      rest,
      bookObjectId: `sheet:tome:${commandId}`,
    });
    void runSingleCompanionCommand(command);
  };

  const handlePactBladeTouch = (weaponObjectId: string) => {
    if (!canonicalBuild.runtime) return;
    const command = buildPactBladeTouchCommand({
      runtime: canonicalBuild.runtime,
      onlineEncounterId: encounterId ?? character.current_encounter_id,
      commandId: newSheetRuntimeCommandId(),
      weaponObjectId,
      facts: {
        factsSource: 'scenario',
        boardRevision: canonicalBuild.runtime.world.revision,
        distanceFt: 0,
        lineOfSight: false,
        touched: true,
      },
    });
    void runSingleCompanionCommand(command);
  };

  const reconcileCommittedAtomicCommand = (committed: CommittedSheetRuntimeCommand) => {
    let cached = [...(targetCharsRef.current ?? [])];
    for (const next of Object.values(committed.characters)) {
      cached = replaceCachedInteractionTarget(cached, next);
      if (next.id === character.id) onUpdated(next);
    }
    targetCharsRef.current = cached;
    setAvailableSheetTargets(cached.filter((candidate) => !isCharacterReadOnly(candidate)));
    setCompanionTargets(cached.filter((candidate) => candidate.id !== character.id));
    setPendingAtomicRetry(null);
    try {
      surfaceAcceptedSheetAtomicEvents({
        rows: committed.persistedEvents,
        onEvents,
        onPersistedEvents,
      });
    } catch (cause) {
      console.error('Не удалось отобразить уже сохранённый журнал атомарной команды', cause);
    }
  };

  const refreshAfterDefinitiveAtomicRejection = async (message: string) => {
    setPendingAtomicRetry(null);
    targetCharsRef.current = null;
    setAvailableSheetTargets([]);
    setCompanionTargets([]);
    try {
      const refreshed = await charactersV3Api.list();
      targetCharsRef.current = refreshed;
      setAvailableSheetTargets(refreshed.filter((candidate) => !isCharacterReadOnly(candidate)));
      setCompanionTargets(refreshed.filter((candidate) => candidate.id !== character.id));
      const refreshedSource = refreshed.find((candidate) => candidate.id === character.id);
      if (refreshedSource) onUpdated(refreshedSource);
      setError(`${message} Данные обновлены; повторите действие.`);
    } catch {
      setError(`${message} Обновите страницу и повторите действие.`);
    }
  };

  const commitCompanionInteraction = async (prepared: PreparedSheetCompanionInteraction) => {
    setBusy(true);
    setError(null);
    let committed: CommittedSheetRuntimeCommand | null = null;
    try {
      committed = await commitSheetRuntimeCommand({
        request: prepared.request,
        commit: () => charactersV3Api.postRuntimeCommand(prepared.request),
        loadCurrent: charactersV3Api.get,
        viewingCharacterId: character.id,
        loadPersistedEvents: charactersV3Api.getEvents,
      });
    } catch (cause) {
      const message = playerFacingSheetActionError(cause);
      if (sheetCompanionRetryPolicy(cause) === 'retain_exact_retry') {
        setPendingAtomicRetry({ characterId: character.id, kind: 'companion', prepared });
        setError(`${message}. Безопасный повтор сохранён.`);
      } else {
        await refreshAfterDefinitiveAtomicRejection(message);
      }
    } finally {
      setBusy(false);
    }
    if (committed) reconcileCommittedAtomicCommand(committed);
  };

  const commitOrdinarySpellInteraction = async (prepared: PreparedSheetAtomicWorldCommit) => {
    setBusy(true);
    setError(null);
    let committed: CommittedSheetRuntimeCommand | null = null;
    try {
      committed = await commitSheetRuntimeCommand({
        request: prepared.request,
        commit: () => commitPreparedSheetAtomicWorld(
          { commit: charactersV3Api.postRuntimeCommand },
          prepared,
        ),
        loadCurrent: charactersV3Api.get,
        viewingCharacterId: character.id,
        loadPersistedEvents: charactersV3Api.getEvents,
      });
    } catch (cause) {
      const message = playerFacingSheetActionError(cause);
      if (sheetCompanionRetryPolicy(cause) === 'retain_exact_retry') {
        setPendingAtomicRetry({ characterId: character.id, kind: 'ordinary_spell', prepared });
        setError(`${message}. Безопасный повтор сохранён.`);
      } else {
        await refreshAfterDefinitiveAtomicRejection(message);
      }
    } finally {
      setBusy(false);
    }
    if (committed) reconcileCommittedAtomicCommand(committed);
  };

  const handleFamiliarTouch = async (declaration: SheetCompanionTouchDeclaration) => {
    if (!canonicalBuild.runtime || pendingAtomicRetry) return;
    try {
      const target = companionTargets.find((candidate) => candidate.id === declaration.targetActorId);
      if (!target) throw new Error('Выбранный лист цели больше недоступен');
      const cards = new Map([...cardsIndex.entries(), ...equipCards.entries()]);
      const targetSeed = await loadSheetCombatParticipant({ character: target, basicActions, cards });
      const prepared = prepareSheetFamiliarTouchInteraction({
        source: { character, canonical: canonicalBuild.runtime },
        target: targetSeed,
        commandId: newSheetRuntimeCommandId(),
        spellActionId: declaration.spellActionId,
        castOptionId: declaration.castOptionId,
        ownerToFamiliarFacts: {
          factsSource: 'scenario',
          boardRevision: canonicalBuild.runtime.world.revision,
          distanceFt: declaration.ownerDistanceFt,
          lineOfSight: declaration.ownerLineOfSight,
        },
        familiarToTargetFacts: {
          factsSource: 'scenario',
          boardRevision: canonicalBuild.runtime.world.revision,
          distanceFt: declaration.targetDistanceFt,
          lineOfSight: declaration.targetLineOfSight,
          cover: declaration.cover,
          relation: declaration.relation,
          willing: declaration.willing,
        },
        rng: Math.random,
      });
      await commitCompanionInteraction(prepared);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  // Персист изменённого состояния ЦЕЛИ выбранному персонажу (урон/лечение/эффекты).
  // turn_state сливаем с ЦЕЛЬЮ (не носителем!), чтобы не затереть её спасброски смерти.
  const persistTarget = useCallback(async (targetChar: ForgeCharacter, ts: RuntimeState) => {
    if (isCharacterReadOnly(targetChar)) {
      throw new Error('Архивный публичный лист нельзя изменить действием или заклинанием.');
    }
    const persistedTarget = await persistCharacterRuntime(targetChar, {
      current_hp: ts.hp.current,
      max_hp: ts.hp.max,
      active_effects: ts.activeEffects,
      turn_state: writeRulesEngineRuntimeTurnState(targetChar.turn_state, ts),
    }, targetChar.current_encounter_id === encounterId ? encounterApply : undefined);
    // Освежаем весь серверный runtime-снимок, включая once-per-turn/rest ledgers:
    // повторное действие по той же цели в этой вкладке не должно заново активировать
    // уже сработавшую реактивную способность.
    targetCharsRef.current = replaceCachedInteractionTarget(
      targetCharsRef.current ?? [],
      persistedTarget,
    );
  }, [encounterApply, encounterId]);

  // --- Онлайн-бой: цели = комбатанты боя, применение = патч комбатанта (синк на доску) ---
  // Свежий снимок комбатантов на каждое целевое действие (доска могла изменить HP из другого
  // устройства); внутри одного действия переиспользуем через ref.
  const encCombatantsRef = useRef<Combatant[]>([]);
  const encounterSeqRef = useRef<number | null>(null);
  const loadEncounterCombatants = useCallback(async (): Promise<Combatant[]> => {
    if (!encounterId) return [];
    try {
      const enc = await encountersApi.get(encounterId);
      encCombatantsRef.current = enc.state?.combatants ?? [];
      encounterSeqRef.current = enc.seq;
    } catch {
      encCombatantsRef.current = [];
      encounterSeqRef.current = null;
    }
    return encCombatantsRef.current;
  }, [encounterId]);

  const sendEncounter = useCallback(async (op: Parameters<EncounterApply>[0]) => {
    if (!encounterId) throw new Error('Бой не выбран');
    let expectedSeq = encounterSeqRef.current;
    if (expectedSeq == null) {
      const encounter = await encountersApi.get(encounterId);
      expectedSeq = encounter.seq;
      encounterSeqRef.current = encounter.seq;
      encCombatantsRef.current = encounter.state?.combatants ?? [];
    }
    const result = encounterApply
      ? await encounterApply(op, expectedSeq)
      : await encountersApi.apply(encounterId, expectedSeq, op);
    encounterSeqRef.current = result.seq;
    encCombatantsRef.current = result.state.combatants;
    return result;
  }, [encounterApply, encounterId]);

  // Богатая цель из комбатанта: для персонажа — статы из его листа (AC/спасброски/сопротивления),
  // но HP/состояния СИДИМ из комбатанта (боевая истина, иначе можно стартовать от устаревшего HP);
  // для монстра — минимальная цель (КЗ и спас-мод берём с доски/ручного поля).
  const buildEncounterTarget = useCallback(async (cb: Combatant): Promise<TargetContext> => {
    const battleHp = { current: cb.hp, max: cb.maxHp, temp: cb.temp ?? 0 };
    const effects = (cb.activeEffects as RuntimeState['activeEffects'] | undefined) ?? [];
    if (cb.characterId) {
      const chars = await loadTargetChars();
      const full = chars.find((c) => c.id === cb.characterId);
      if (full) {
        const base = buildTargetFromCharacter(full);
        const rs = base.runtimeState ?? forgeToRuntimeState(full);
        return { ...base, runtimeState: { ...rs, hp: battleHp, activeEffects: effects } };
      }
    }
    const explicitAc = typeof cb.ac === 'number' && Number.isFinite(cb.ac) && cb.ac > 0
      ? cb.ac
      : targetAc;
    return {
      id: cb.actorId,
      ...(typeof explicitAc === 'number' ? { ac: explicitAc } : {}),
      ...(typeof targetSaveMod === 'number' ? {
        saveMods: {
          dex: targetSaveMod,
          con: targetSaveMod,
          str: targetSaveMod,
          int: targetSaveMod,
          wis: targetSaveMod,
          cha: targetSaveMod,
        },
      } : {}),
      runtimeState: { hp: battleHp, resources: {}, maxResources: {}, equipment: {}, inventory: [], activeEffects: effects },
    };
  }, [loadTargetChars, targetAc, targetSaveMod]);

  // Применяем итоговое состояние цели к комбатанту (патч hp/temp/состояния) — сервер разошлёт
  // на доску и все устройства, сделает write-through в лист цели и запишет журналы. maxHp не трогаем.
  // Журнал строим по ДЕЛЬТЕ состояния ЦЕЛИ (before=cb, after=ts), а не фильтром r.events: движок
  // кладёт self- и target-события в один массив без атрибуции, и фильтр по типу залогировал бы
  // само-лечение каста (напр. Вампирское касание) в журнал цели. events нужен лишь для типа урона.
  const applyToEncounterTarget = useCallback(async (cb: Combatant, ts: RuntimeState, events: EngineEvent[], pendingAttack?: PendingAttack) => {
    if (!encounterId) return;
    const src = character.name;
    const log: BattleLogEntry[] = [];
    const add = (e: EngineEvent) => log.push({
      message: `${src} → ${cb.name}: ${describeEngineEvent(e)}`,
      type: e.type,
      payload: { ...e, source: src } as EngineEvent, // журнал цели: «Тест: Урон 6 (яд)»
      ...(cb.characterId ? { targetCharacterId: cb.characterId } : {}),
    });
    const hpLost = cb.hp - ts.hp.current;               // >0 — урон по hp
    const tempLost = (cb.temp ?? 0) - (ts.hp.temp ?? 0); // >0 — израсходованы врем. хиты (поглощение)
    const damage = Math.max(0, hpLost) + Math.max(0, tempLost);
    const healed = Math.max(0, -hpLost);
    const tempGained = Math.max(0, -tempLost);
    if (damage > 0) {
      const dt = (events.find((e) => e.type === 'damage') as { damageType?: string } | undefined)?.damageType ?? 'урон';
      add({ type: 'damage', amount: damage, damageType: dt });
    }
    if (healed > 0) add({ type: 'healing', amount: healed });
    if (tempGained > 0) add({ type: 'temp_hp', amount: tempGained });
    const prevIds = new Set((cb.activeEffects ?? []).map((e) => e.id));
    for (const e of ts.activeEffects ?? []) {
      const eff = e as { id?: string; name?: string; mechanics?: { kind?: string; value?: string } };
      if (eff.id && prevIds.has(eff.id)) continue; // уже был — не новое
      if (eff.mechanics?.kind === 'condition') add({ type: 'condition_applied', condition: eff.name ?? eff.mechanics.value ?? 'состояние' });
      else add({ type: 'effect_applied', name: eff.name ?? 'эффект' });
    }
    if (!log.length) log.push({ message: `${src} → ${cb.name}: без изменений` });
    // Щит: доставляем цели-персонажу pending-«атакован» — она сможет отреагировать (реакция при попадании).
    const pendingAttacks = pendingAttack ? [...(cb.pendingAttacks ?? []), pendingAttack] : cb.pendingAttacks;
    try {
      await sendEncounter({
        patches: [{ actor_id: cb.actorId, set: { hp: ts.hp.current, temp: ts.hp.temp, activeEffects: ts.activeEffects, ...(pendingAttack ? { pendingAttacks } : {}) } }],
        log,
      });
      encCombatantsRef.current = encCombatantsRef.current.map((c) =>
        c.actorId === cb.actorId ? { ...c, hp: ts.hp.current, temp: ts.hp.temp, activeEffects: ts.activeEffects as unknown as Combatant['activeEffects'], ...(pendingAttack ? { pendingAttacks } : {}) } : c);
    } catch (error) {
      console.error('Не удалось применить к цели в бою', error);
      throw new Error('Состояние цели изменилось: действие не применено и ресурсы источника не списаны', {
        cause: error,
      });
    }
  }, [encounterId, character.name, sendEncounter]);

  const commitCombat = async (
    prepared: PreparedSheetCombatCommit,
  ): Promise<boolean> => {
    setBusy(true);
    setError(null);
    let committed: CommittedSheetRuntimeCommand | null = null;
    try {
      committed = await commitSheetRuntimeCommand({
        request: prepared.request,
        commit: () => commitPreparedSheetCombat(
          { commit: charactersV3Api.postRuntimeCommand },
          prepared,
        ),
        loadCurrent: charactersV3Api.get,
        viewingCharacterId: character.id,
        loadPersistedEvents: charactersV3Api.getEvents,
      });
    } catch (cause) {
      console.error(cause);
      const detail = cause instanceof Error ? cause.message : String(cause);
      const retain = sheetCompanionRetryPolicy(cause) === 'retain_exact_retry';
      const message = retain
        ? `${detail}. Повтор отправит ту же атомарную команду.`
        : detail;
      if (retain) {
        setPendingAtomicRetry({ characterId: character.id, kind: 'combat', prepared });
        setError(message);
      } else {
        await refreshAfterDefinitiveAtomicRejection(message);
      }
      showToast({
        type: 'error',
        title: retain ? 'Действие не подтверждено сервером' : 'Действие отклонено сервером',
        message,
        duration: 15000,
      });
      return false;
    } finally {
      setBusy(false);
    }
    reconcileCommittedAtomicCommand(committed);
    return true;
  };

  const combatCharacters = async (
    session: SheetCombatSession,
  ): Promise<Record<string, ForgeCharacter>> => {
    const listed = await charactersV3Api.list();
    targetCharsRef.current = listed;
    const byId = Object.fromEntries(listed.map((candidate) => [candidate.id, candidate]));
    // Preserve the render-owned current sheet if list caching ever lags its
    // just-returned runtime command response.
    byId[character.id] = character;
    for (const [id, revision] of Object.entries(session.participantRevisions)) {
      const candidate = byId[id];
      if (!candidate || candidate.runtime_revision !== revision) {
        throw new Error(`Снимок ${id} изменился; перезагрузите лист перед продолжением`);
      }
    }
    return byId;
  };

  const commitCombatTransition = async (
    transition: SheetCombatTransition,
    characters: Readonly<Record<string, ForgeCharacter>>,
  ) => {
    const prepared = prepareSheetCombatCommit({ transition, characters });
    return commitCombat(prepared);
  };

  const requireCertifiedCombatSession = (session: SheetCombatSession) => {
    if (!certifiedCombat.catalog) {
      throw certifiedCombat.error
        ?? new Error(certifiedCombat.loading
          ? 'Сертифицированный combat release ещё загружается'
          : 'Сертифицированный combat release недоступен');
    }
    assertCertifiedSheetCombatSession(session, certifiedCombat.catalog);
    return certifiedCombat.catalog;
  };

  const resolveCombatDecision = async (response: DecisionResponse) => {
    const session = combatContinuation.session;
    if (!session?.world.pendingResolution) return;
    try {
      requireCertifiedCombatSession(session);
      const characters = await combatCharacters(session);
      const transition = resolveSheetCombatDecision({
        session,
        commandId: newSheetRuntimeCommandId(),
        response,
        rng: Math.random,
      });
      await commitCombatTransition(transition, characters);
    } catch (cause) {
      console.error(cause);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const moveCombatTurn = async () => {
    const session = combatContinuation.session;
    if (!session || session.world.pendingResolution || session.world.scene.mode !== 'encounter') return;
    const activeActorId = session.world.scene.initiative[session.world.scene.activeIndex];
    if (activeActorId !== character.id) return;
    try {
      requireCertifiedCombatSession(session);
      const characters = await combatCharacters(session);
      const transition = advanceSheetCombatTurn({
        session,
        commandId: newSheetRuntimeCommandId(),
        type: session.world.scene.turnStarted ? 'EndTurn' : 'StartTurn',
        actorId: character.id,
      });
      await commitCombatTransition(transition, characters);
    } catch (cause) {
      console.error(cause);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const runPendingCombatAction = async (
    action: SheetAction,
    canonical: SheetCanonicalActionContext,
  ) => {
    if (encounterId) {
      setError('Этот атомарный двухлистовый режим пока не смешивается с онлайн-боем');
      return;
    }
    if (pendingAtomicRetry) {
      setError('Сначала подтвердите предыдущую атомарную команду');
      return;
    }
    const existing = combatContinuation.session;
    if (combatContinuation.error) {
      setError(combatContinuation.error.message);
      return;
    }
    if (existing?.world.pendingResolution) {
      setError('Сначала завершите ожидающее решение');
      return;
    }
    if (existing && existing.world.scene.mode === 'encounter') {
      const activeId = existing.world.scene.initiative[existing.world.scene.activeIndex];
      if (activeId !== character.id || !existing.world.scene.turnStarted) {
        setError('Действие доступно только активному персонажу после начала его хода');
        return;
      }
    }
    try {
      if (!certifiedCombat.catalog) {
        throw certifiedCombat.error ?? new Error('Сертифицированный combat release ещё не загружен');
      }
      assertCertifiedSheetCombatActorAction(
        canonical.action,
        canonical.runtime.world.actors[character.id],
        certifiedCombat.catalog,
      );
      if (existing) assertCertifiedSheetCombatSession(existing, certifiedCombat.catalog);
      const requested = collectSheetPrimitiveChoices(canonical, 'encounter');
      const selectedChoices: Record<string, string[]> = {};
      if (requested.length) {
        const picked = await choiceDialog.request(requested, action.name);
        if (!picked) return;
        for (const [id, values] of Object.entries(picked)) {
          if (values.length) selectedChoices[id] = values;
        }
      }
      const base = buildSheetPrimitiveCommandInput({
        runtime: canonical.runtime,
        action: canonical.action,
        selectedChoices,
        sceneMode: 'encounter',
        targetIds: [],
      });
      const allCharacters = await loadTargetChars();
      const allowedIds = existing
        ? new Set(Object.keys(existing.participantRevisions))
        : null;
      const characterCandidates: SheetCombatTargetCandidate[] = allCharacters
        .filter((candidate) => (
          candidate.id !== character.id
          || canonical.action.targeting?.allowedRelations.includes('self')
        ))
        .filter((candidate) => !isCharacterReadOnly(candidate))
        .filter((candidate) => !allowedIds || allowedIds.has(candidate.id))
        .map((candidate) => {
          let reason: string | undefined;
          if (candidate.current_encounter_id) reason = 'персонаж уже в онлайн-бою';
          else if (!Number.isSafeInteger(candidate.runtime_revision)) reason = 'нет серверной runtime_revision';
          else if (candidate.system_id !== character.system_id) reason = 'другая система правил';
          return {
            id: candidate.id,
            name: candidate.name,
            defaultFacts: {
              factsSource: 'scenario',
              boardRevision: existing?.world.revision ?? canonical.runtime.world.revision,
              relation: candidate.id === character.id ? 'self' : 'enemy',
              ...(candidate.id === character.id ? { distanceFt: 0, willing: true } : {}),
              lineOfSight: true,
              cover: 'none',
            },
            ...(reason ? { disabled: true, reason } : {}),
          };
        });
      const dummyAvailable = !existing || Boolean(existing.world.actors[TRAINING_DUMMY_TARGET_ID]);
      const targetCandidates: SheetCombatTargetCandidate[] = [{
        id: TRAINING_DUMMY.id,
        name: TRAINING_DUMMY.name,
        description: TRAINING_DUMMY.description,
        defaultSelected: dummyAvailable,
        defaultFacts: {
          ...TRAINING_DUMMY.defaultFacts,
          boardRevision: existing?.world.revision ?? canonical.runtime.world.revision,
        },
        factEntryMode: 'distance_only',
        ...(!dummyAvailable ? {
          disabled: true,
          reason: 'Завершите старое продолжение боя, чтобы добавить цель сцены',
        } : {}),
      }, ...characterCandidates];
      if (!targetCandidates.some((candidate) => !candidate.disabled)) {
        throw new Error('Нет доступной цели для этого действия');
      }
      const declarationFacts = await combatTargetDialog.request({
        title: `${action.name}: цели и факты`,
        action: canonical.action,
        castLevel: base.spell?.castLevel,
        candidates: targetCandidates,
        requireTarget: true,
      });
      if (!declarationFacts) return;
      const selectedIds = new Set(declarationFacts.targets.map((target) => target.targetId));
      let session = existing;
      let characters: Record<string, ForgeCharacter>;
      if (session) {
        characters = await combatCharacters(session);
      } else {
        const selectedTargets = allCharacters.filter((candidate) => (
          candidate.id !== character.id && selectedIds.has(candidate.id)
        ));
        const cards = new Map([...cardsIndex.entries(), ...equipCards.entries()]);
        const targets = await Promise.all(selectedTargets.map((target) => (
          loadSheetCombatParticipant({ character: target, basicActions, cards })
        )));
        const sceneActors = selectedIds.has(TRAINING_DUMMY_TARGET_ID)
          ? [createSheetSceneTargetActor(TRAINING_DUMMY)]
          : [];
        session = await createSheetCombatSession({
          source: { character, canonical: canonical.runtime },
          targets,
          sceneActors,
          sceneMode: 'encounter',
        });
        characters = Object.fromEntries([
          [character.id, character],
          ...selectedTargets.map((target) => [target.id, target] as const),
        ]);
      }
      const declaration = buildSheetCombatDeclaration({
        action: canonical.action,
        base,
        targets: declarationFacts.targets,
        dartAllocation: declarationFacts.dartAllocation,
      });
      const transition = executeSheetCombatAction({
        session,
        actorId: character.id,
        actionId: canonical.action.id,
        declaration,
        commandId: newSheetRuntimeCommandId(),
        rng: Math.random,
      });
      const committed = await commitCombatTransition(transition, characters);
      if (committed) {
        showToast({
          type: 'success',
          title: 'Действие принято',
          message: transition.nextWorld.pendingResolution
            ? `${action.name}: ожидается решение цели`
            : `${action.name}: результат сохранён`,
        });
      }
    } catch (cause) {
      console.error(cause);
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      showToast({
        type: 'error',
        title: 'Действие не выполнено',
        message,
        duration: 15000,
      });
    }
  };

  const runAction = async (action: SheetAction) => {
    if (pendingAtomicRetry) {
      setError('Сначала подтвердите безопасный повтор предыдущей атомарной команды');
      return;
    }
    const contextualCostIssue = contextualCostProjection.issues.get(action.id);
    if (contextualCostIssue) {
      setError(contextualCostIssue);
      return;
    }
    let mech: Record<string, unknown> = { ...action.mechanics, name: action.name };
    const primitive = mechanicsPrimitiveType(mech);
    const authoritativePrimitive = primitive !== null && isSheetNoPendingPrimitive(primitive);
    let canonical: SheetCanonicalActionContext | undefined;
    if (sheetActionNeedsCanonicalAvailability(action)) {
      try {
        canonical = canonicalFor(action);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        return;
      }
    }
    if (primitive && isSheetPendingCombatPrimitive(primitive) && canonical) {
      await runPendingCombatAction(action, canonical);
      return;
    }
    let activation = mech.activation as Record<string, unknown> | undefined;
    let cost = (activation?.cost as Record<string, unknown>[]) ?? [];
    let canonicalSpellOption: SheetSpellCastOption | undefined;
    if (action.spellRef && canonical) {
      canonicalSpellOption = collectSheetSpellCastOptions({
        runtime: canonical.runtime,
        action: canonical.action,
      }).sort((left, right) => {
        const rank = (option: SheetSpellCastOption) => (
          option.payment.kind === 'none' ? 0 : option.payment.kind === 'free_use' ? 1 : 2
        );
        return rank(left) - rank(right) || left.id.localeCompare(right.id);
      })[0];
      if (!canonicalSpellOption) {
        setError('Нет доступного источника оплаты заклинания');
        return;
      }
      const withoutSpellPayment = cost.filter((entry) => {
        const resource = String(entry.resource ?? '');
        return resource !== 'spell_slot'
          && !resource.startsWith('spell_slot_')
          && !resource.startsWith('freeuse-');
      });
      const payment = canonicalSpellOption.payment;
      const paymentCost = payment.kind === 'none' || !payment.resource
        ? []
        : [{ resource: payment.resource, amount: 1 }];
      cost = [...withoutSpellPayment, ...paymentCost];
      activation = { ...(activation ?? {}), cost };
      mech = { ...mech, activation };
    }
    // D: недееспособность запрещает экономику хода — не запускаем действие с запрещённым типом.
    if (deniedActionReason(action, cost)) return;
    // freeuse: заклинание с пулом бесплатных использований (каст без ячейки). Считаем ДО гейта —
    // персонаж без ячеек (напр. предмет-каст) всё равно может кастовать бесплатно.
    const freeuse = freeuseFor(action);
    if (!authoritativePrimitive && cost.length && !payableWithUpcast(runtime, cost, !!freeuse)) return;
    // Оружейное действие без нужного оружия в руке — не запускаем.
    if (!weaponActionAvailability(action.mechanics, runtime.equipment, equipCards).available) return;
    const requiresActorTarget = canonical
      ? sheetActionRequiresActorTargets(canonical.action)
      : actionInteractsWithTarget(mech);
    let selectedTargetForAction = requiresActorTarget ? selectedSheetTarget : undefined;
    let sceneTarget: TargetContext | undefined;
    let canonicalTargetId: string | undefined;
    let ordinaryCanonicalExecution: {
      canonical: SheetCanonicalActionContext;
      commandId: string;
      declaration: SheetCanonicalCommandInput;
      targetActors: ActorState[];
      targetParticipants: SheetCombatParticipantSeed[];
    } | undefined;
    const allowsSelfTarget = canonical?.action.targeting?.allowedRelations.includes('self')
      ?? sheetMechanicsAllowsSelfTarget(mech);
    const selectedTargetIssue = sheetSelectedTargetRelationIssue({
      actorId: character.id,
      targetId: selectedTargetForAction?.id,
      allowsSelf: allowsSelfTarget,
    });
    if (selectedTargetIssue) {
      setError(selectedTargetIssue);
      return;
    }
    // Ordinary spells still use the sheet's dice/persistence adapter, but
    // targeting legality is proven by a detached canonical dispatch before
    // that adapter can spend anything. This covers data-owned constraints such
    // as willing/unarmored without interpreting a spell name in the UI.
    if (action.spellRef && canonical && canonicalSpellOption && !primitive && !encounterId) {
      const targeting = canonical.action.targeting;
      if (!targeting) {
        setError('Каноническое заклинание не содержит targeting-контракт');
        return;
      }
      const ordinaryInPlayChoices = collectInPlayActionChoices(
        mech,
        { kind: 'other', id: 'action', name: action.name },
      ).map((choice) => choice.source === 'equipped_weapon'
        ? {
            ...choice,
            items: equippedWeaponChoices(
              ctx,
              runtime.equipment,
              Array.isArray(choice.filter) ? choice.filter : [],
            ),
          }
        : choice);
      const ordinaryChoices: Record<string, string[]> = {};
      if (ordinaryInPlayChoices.length) {
        const picked = await choiceDialog.request(ordinaryInPlayChoices, action.name);
        if (!picked) return;
        for (const [id, selected] of Object.entries(picked)) {
          if (selected.length) ordinaryChoices[id] = selected;
        }
      }
      const baseDeclaration = {
        sceneMode: 'exploration' as const,
        targetIds: [],
        spell: canonicalSpellOption.declaration,
        ...(Object.keys(ordinaryChoices).length ? { choices: ordinaryChoices } : {}),
      };
      let declaration: SheetCanonicalCommandInput = baseDeclaration;
      const targetActors: ActorState[] = [];
      const targetCharacters: ForgeCharacter[] = [];
      if (!requiresActorTarget) {
        // World-domain, target-free, and self-resolving actions never invent
        // an actor identity from maxTargets. Their scene/world declaration is
        // intentionally actor-free and canonical rules resolve the effect.
      } else {
        const allCharacters = await loadTargetChars();
        const relationFor = (targetId: string) => {
          if (targetId === character.id && targeting.allowedRelations.includes('self')) return 'self' as const;
          if (targeting.allowedRelations.includes('ally')) return 'ally' as const;
          return targeting.allowedRelations[0];
        };
        const characterCandidates: SheetCombatTargetCandidate[] = allCharacters
          .filter((candidate) => !isCharacterReadOnly(candidate))
          .filter((candidate) => candidate.id !== character.id || targeting.allowedRelations.includes('self'))
          .map((candidate) => ({
            id: candidate.id,
            name: candidate.name,
            defaultSelected: candidate.id === selectedSheetTarget?.id,
            defaultFacts: {
              factsSource: 'scenario',
              boardRevision: canonical.runtime.world.revision,
              relation: relationFor(candidate.id),
              distanceFt: candidate.id === character.id ? 0 : Math.min(5, targeting.rangeFt),
              lineOfSight: true,
              cover: 'none',
              ...(targeting.requiresWilling ? { willing: true } : {}),
            },
          }));
        const dummyRelation = targeting.allowedRelations.includes('enemy')
          ? 'enemy' as const
          : targeting.allowedRelations.includes('ally')
            ? 'ally' as const
            : targeting.allowedRelations[0];
        const targetCandidates: SheetCombatTargetCandidate[] = [{
          id: TRAINING_DUMMY.id,
          name: TRAINING_DUMMY.name,
          description: TRAINING_DUMMY.description,
          defaultSelected: !selectedSheetTarget,
          defaultFacts: {
            ...TRAINING_DUMMY.defaultFacts,
            boardRevision: canonical.runtime.world.revision,
            relation: dummyRelation,
            distanceFt: Math.min(5, targeting.rangeFt),
            ...(targeting.requiresWilling ? { willing: true } : {}),
          },
        }, ...characterCandidates];
        const declared = await combatTargetDialog.request({
          title: `${action.name}: цели и факты`,
          action: canonical.action,
          castLevel: canonicalSpellOption.declaration.castLevel,
          candidates: targetCandidates,
          requireTarget: targeting.minTargets > 0,
        });
        if (!declared) return;
        declaration = buildSheetCombatDeclaration({
          action: canonical.action,
          base: baseDeclaration,
          targets: declared.targets,
        });
        canonicalTargetId = declaration.targetIds[0];
        const selectedCharacters: ForgeCharacter[] = [];
        let includesTrainingDummy = false;
        for (const targetId of declaration.targetIds) {
          if (targetId === TRAINING_DUMMY_TARGET_ID) {
            includesTrainingDummy = true;
            continue;
          }
          const selected = allCharacters.find((candidate) => candidate.id === targetId);
          if (!selected) {
            setError('Один из выбранных листов цели больше недоступен');
            return;
          }
          selectedCharacters.push(selected);
        }
        if (includesTrainingDummy) {
          sceneTarget = buildSheetSceneTargetContext(TRAINING_DUMMY);
          targetActors.push(createSheetSceneTargetActor(TRAINING_DUMMY));
        }
        selectedTargetForAction = selectedCharacters[0];
        const externalTargets = selectedCharacters.filter((selected) => selected.id !== character.id);
        targetCharacters.push(...externalTargets);
      }
      // The source's canonical world retains cross-sheet concentration actors.
      // Hydrate those participants too: replacing concentration must remove its
      // effects from old targets using current server snapshots, not stale cache.
      const priorExternalIds = [...new Set(
        canonical.runtime.world.concentrations[character.id]?.effectLinks
          .map((link) => link.actorId)
          .filter((actorId) => actorId !== character.id
            && canonical.runtime.world.actors[actorId]?.kind === 'playerCharacter') ?? [],
      )];
      if (priorExternalIds.length) {
        const allCharacters = await loadTargetChars();
        for (const actorId of priorExternalIds) {
          if (targetCharacters.some((candidate) => candidate.id === actorId)) continue;
          const existing = allCharacters.find((candidate) => candidate.id === actorId);
          if (!existing || isCharacterReadOnly(existing)) {
            setError(`Нельзя обновить прежнюю цель концентрации ${actorId}`);
            return;
          }
          targetCharacters.push(existing);
        }
      }
      let targetParticipants: SheetCombatParticipantSeed[] = [];
      try {
        if (targetCharacters.length) {
          const cards = new Map([...cardsIndex.entries(), ...equipCards.entries()]);
          targetParticipants = await Promise.all(targetCharacters.map((selected) => (
            loadSheetCombatParticipant({ character: selected, basicActions, cards })
          )));
          for (const participant of targetParticipants) {
            targetActors.push(participant.canonical.world.actors[participant.character.id]);
          }
        }
        validateSheetCanonicalAction({
          canonical,
          state: runtime,
          declaration,
          targetActors,
        });
        ordinaryCanonicalExecution = {
          canonical,
          commandId: newSheetRuntimeCommandId(),
          declaration,
          targetActors,
          targetParticipants,
        };
      } catch (cause) {
        console.error(cause);
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(message);
        showToast({
          type: 'error',
          title: 'Действие не выполнено',
          message,
          duration: 15000,
        });
        return;
      }
    }

    const unarmedTargetAction = legacyUnarmedTargetAction(action);
    if (unarmedTargetAction && !selectedTargetForAction) {
      const declaration = await combatTargetDialog.request({
        title: `${action.name}: цели и факты`,
        action: unarmedTargetAction,
        candidates: [{
          id: TRAINING_DUMMY.id,
          name: TRAINING_DUMMY.name,
          description: TRAINING_DUMMY.description,
          defaultSelected: true,
          defaultFacts: TRAINING_DUMMY.defaultFacts,
          factEntryMode: 'distance_only',
        }],
        requireTarget: true,
      });
      if (!declaration) return;
      sceneTarget = buildSheetSceneTargetContext(TRAINING_DUMMY);
    }
    if (!authoritativePrimitive) {
      if (!selectedTargetForAction && !sceneTarget) {
        const targetFactsIssue = explicitSheetTargetFactsIssue(mech, {
          armorClass: targetAc,
          savingThrowModifier: targetSaveMod,
        });
        if (targetFactsIssue) {
          setError(targetFactsIssue);
          return;
        }
      }
    }

    // Апкаст (D1) + freeuse: если действие тратит spell_slot уровня N — выбрать уровень слота N..9
    // и/или источник оплаты (ячейка/бесплатно). castLevel в mech.cost и в ctx.spell включает
    // апкаст-скейлинг (withScaling) и эмиссию spell_cast. Заговоры/spellRef без слота тоже
    // помечаем ctx.spell (для триггеров каста), castLevel не задаём.
    let spellCtx: { baseLevel: number; castLevel?: number } | undefined;
    const slotIdx = cost.findIndex((c) => String(c.resource ?? '') === 'spell_slot' && c.level != null);
    if (canonicalSpellOption) {
      const baseLevel = action.spellRef?.level ?? action.level ?? 0;
      const paidLevel = canonicalSpellOption.payment.resource?.match(/_(\d+)$/)?.[1];
      spellCtx = {
        baseLevel,
        castLevel: paidLevel === undefined ? baseLevel : Number(paidLevel),
      };
    } else if (!authoritativePrimitive && (slotIdx >= 0 || freeuse)) {
      const slotEntry = slotIdx >= 0 ? cost[slotIdx] : null;
      const baseLevel = slotEntry ? Number(slotEntry.level) || 0 : (action.spellRef?.level ?? action.level ?? 0);
      const need = slotEntry ? Number(slotEntry.amount ?? 1) || 1 : 1;
      const options: number[] = [];
      if (slotEntry) for (let L = baseLevel; L <= 9; L++) if ((runtime.resources[`spell_slot_${L}`] ?? 0) >= need) options.push(L);

      // Выбор источника оплаты: меню при (freeuse И есть ячейки) или (>1 круга ячеек); иначе авто.
      let choice: CastChoice;
      if (freeuse && options.length > 0) {
        const picked = await requestCastChoice(baseLevel, options, freeuse);
        if (!picked) return; // отмена
        choice = picked;
      } else if (freeuse) {
        choice = { via: 'free' };
      } else if (options.length === 0) {
        return; // ни ячейки, ни freeuse (гейт пропустил бы только с freeuse)
      } else if (options.length === 1) {
        choice = { via: 'slot', level: options[0] };
      } else {
        const picked = await requestCastChoice(baseLevel, options, undefined);
        if (!picked) return;
        choice = picked;
      }

      if (choice.via === 'free') {
        // Подменяем оплату ячейкой на трату freeuse-пула; действие (bonus/action) остаётся.
        mech = applyFreeuseCost(mech, freeuse!.key);
        spellCtx = { baseLevel, castLevel: freeuse!.level }; // фикс. круг бесплатного каста
      } else {
        const castLevel = choice.level;
        if (slotEntry && castLevel !== baseLevel) {
          const newCost = cost.map((c, i) => (i === slotIdx ? { ...c, level: castLevel } : c));
          mech = { ...mech, activation: { ...(activation ?? {}), cost: newCost } };
        }
        spellCtx = { baseLevel, castLevel };
      }
    } else if (!authoritativePrimitive && action.spellRef) {
      spellCtx = { baseLevel: action.spellRef.level ?? action.level ?? 0 };
    }

    const target = authoritativePrimitive
      ? undefined
      : selectedTargetForAction
        ? buildTargetFromCharacter(selectedTargetForAction)
        : sceneTarget
          ? sceneTarget
        : explicitSheetTargetContext(mech, {
          armorClass: targetAc,
          savingThrowModifier: targetSaveMod,
        });

    // passives нужны движку и для модификаторов (фаза C), и для триггеров/реакций (фаза A).
    // planning=true у плана кубов: спасброски берут ветку провала (кости урона попадают в план).
    // targetOverride — богатая цель из выбранного персонажа (иначе dummy {ac, saveMods}).
    const execCtx = (rng: () => number, planning = false, choices: Record<string, string[]> = {}, targetOverride?: TargetContext, forceSaveOutcome?: 'success' | 'fail') =>
      ({ character: ctx, selfId: character.id, target: targetOverride ?? target, rng, passives, triggers: triggerSources, planning, choices, grantedEffects: grantedEffectsBySlug, masteryEffects: masteryById, ...(spellCtx ? { spell: spellCtx } : {}), ...(forceSaveOutcome ? { forceSaveOutcome } : {}) }) as ExecuteContext & { passives: typeof passives };

    // В бою действие со спасом цели-ПЕРСОНАЖА: спас бросает САМА цель. Кастер предрассчитывает ОБА
    // исхода (onFail/onSuccess как дельты) и шлёт pending-спас на комбатант цели; применение — у цели.
    const emitPendingSave = async (cb: Combatant, m: Record<string, unknown>, save: { ability: string; dc: number; avoidsConditions?: string[] }, onFail: SaveOutcome, onSuccess: SaveOutcome) => {
      if (!encounterId) return;
      const pending: PendingSave = {
        id: uid(), sourceName: character.name, actionName: String(m.name ?? 'Действие'),
        ability: save.ability, dc: save.dc, onFail, onSuccess,
        ...(save.avoidsConditions?.length ? { avoidsConditions: save.avoidsConditions } : {}),
      };
      const ab = save.ability.toUpperCase();
      await sendEncounter({
        patches: [{ actor_id: cb.actorId, set: { pendingSaves: [...(cb.pendingSaves ?? []), pending] } }],
        log: [{
          message: `${character.name} → ${cb.name}: спасбросок ${ab} СЛ ${save.dc} (${pending.actionName})`,
          ...(cb.characterId ? { targetCharacterId: cb.characterId, type: 'narrative', payload: { type: 'narrative', text: `Требуется спасбросок ${ab} СЛ ${save.dc} — ${pending.actionName} (от ${character.name})` } } : {}),
        }],
      });
      encCombatantsRef.current = encCombatantsRef.current.map((c) =>
        c.actorId === cb.actorId ? { ...c, pendingSaves: [...(c.pendingSaves ?? []), pending] } : c);
    };

    // Монстр (нет листа): кастер сам катит спас и применяет ДЕЛЬТУ выбранного исхода к комбатанту
    // (к его ТЕКУЩЕМУ hp, а не к абсолюту — предрасчёт делался по огромному hp).
    const applyMonsterSaveOutcome = async (cb: Combatant, out: SaveOutcome, sroll: RollLog, ability: string) => {
      if (!encounterId) return;
      const cur = encCombatantsRef.current.find((c) => c.actorId === cb.actorId) ?? cb;
      const newHp = Math.max(0, cur.hp + (out.hpDelta ?? 0));
      const newTemp = Math.max(0, (cur.temp ?? 0) + (out.tempDelta ?? 0));
      const newEff = [...(cur.activeEffects ?? []), ...(out.addEffects ?? [])];
      const hpDmg = Math.max(0, -(out.hpDelta ?? 0));
      const saved = sroll.outcome === 'success';
      await sendEncounter({
        patches: [{ actor_id: cb.actorId, set: { hp: newHp, temp: newTemp, activeEffects: newEff } }],
        log: [{ message: `${cb.name}: спасбросок ${ability.toUpperCase()} — ${saved ? 'успех' : 'провал'}${hpDmg ? `, урон ${hpDmg}` : ''}` }],
      });
      encCombatantsRef.current = encCombatantsRef.current.map((c) =>
        c.actorId === cb.actorId ? { ...c, hp: newHp, temp: newTemp, activeEffects: newEff as unknown as Combatant['activeEffects'] } : c);
    };

    // Превью действия/заклинания для диалога кубов (видно, ради чего бросок).
    const previewFor = (a: SheetAction): ReactNode => {
      if (a.spellRef) {
        return <SpellPreview spell={a.spellRef} disableHover spellcasting={ruleState.spellcasting
          ? { saveDC: ruleState.spellcasting.saveDC, attack: ruleState.spellcasting.attack } : undefined} />;
      }
      if (a.actionRef) {
        return <ActionPreview action={a.actionRef} sourceLabel={a.sourceLabel} disableHover
          weaponAttackPreview={weaponAttackPreview(a.mechanics, ctx, runtime.equipment, runtime, passives) ?? undefined} />;
      }
      return null;
    };

    // Прогон механики через диалог кубов: план кубов → вопрос игроку (+ выбор цели) → реальный бросок.
    const runViaDialog = async (
      baseState: RuntimeState,
      m: Record<string, unknown>,
      title: string,
      preview?: ReactNode,
      confirm = false,
      targetOpts?: { targets?: { id: string; name: string }[]; needsTarget?: boolean },
      presetTargetId?: string,
      canonicalContext?: SheetCanonicalActionContext,
      ordinaryCanonical?: {
        canonical: SheetCanonicalActionContext;
        commandId: string;
        declaration: SheetCanonicalCommandInput;
        targetActors: ActorState[];
        targetParticipants: SheetCombatParticipantSeed[];
      },
    ): Promise<{ state: RuntimeState; events: EngineEvent[]; pending: ReactionOffer[]; targetState?: RuntimeState; commitTarget?: () => Promise<void>; atomicCommit?: PreparedSheetAtomicWorldCommit; targetId?: string; canonicalWorld?: WorldState } | null> => {
      // Ярус 1.2: выборы context:'in_play' ВНУТРИ действия (вариант эффекта при активации) —
      // спрашиваем ДО плана кубов, чтобы и план, и реальный прогон шли по выбранной ветке.
      const inPlay = ordinaryCanonical
        ? []
        : [
            ...collectInPlayActionChoices(m, { kind: 'other', id: 'action', name: title }),
            ...collectSheetPrimitiveChoices(
              canonicalContext,
              encounterId ? 'encounter' : 'exploration',
            ),
          ].map((choice) => choice.source === 'equipped_weapon'
            ? {
                ...choice,
                items: equippedWeaponChoices(
                  ctx,
                  baseState.equipment,
                  Array.isArray(choice.filter) ? choice.filter : [],
                ),
              }
            : choice);
      const choices: Record<string, string[]> = {};
      for (const [id, raw] of Object.entries(ordinaryCanonical?.declaration.choices ?? {})) {
        const selected = (Array.isArray(raw) ? raw : [raw]).filter((value): value is string => (
          typeof value === 'string' && value.length > 0
        ));
        if (selected.length) choices[id] = selected;
      }
      if (inPlay.length) {
        const picked = await choiceDialog.request(inPlay, title);
        if (!picked) return null; // отмена выбора = отмена действия
        for (const [k, v] of Object.entries(picked)) if (v.length) choices[k] = v;
      }
      let canonicalInput;
      if (canonicalContext) {
        const worldForm = sheetWorldInputFormContext(canonicalContext);
        const worldDeclaration = worldForm
          ? await worldInputDialog.request(
            worldForm,
            `${title}: факты сценария`,
            `sheet-object:${uid()}`,
          )
          : null;
        if (worldForm && !worldDeclaration) return null;
        canonicalInput = buildSheetPrimitiveCommandInput({
          runtime: canonicalContext.runtime,
          action: canonicalContext.action,
          selectedChoices: choices,
          sceneMode: encounterId ? 'encounter' : 'exploration',
          targetIds: [],
          ...(worldDeclaration?.worldInput ? { worldInput: worldDeclaration.worldInput } : {}),
          ...(worldDeclaration?.scenarioObjects.length
            ? { scenarioObjects: worldDeclaration.scenarioObjects }
            : {}),
        });
      }
      // В бою + действие форсирует спас цели → спас бросит цель сама; из плана кубов кастера
      // исключаем d20 спасброска (кастер вводит только кости урона).
      const battleTargetSave = !!encounterId && actionForcesTargetSave(m);
      const plan = planSheetActionDice({
        state: baseState,
        mechanics: m,
        context: execCtx(PLANNING_RNG, true, choices),
        canonical: canonicalContext,
        canonicalInput,
        skipTargetSave: battleTargetSave,
      });
      // presetTargetId (реакция-райдер по той же цели, что попадание) — пикер не показываем.
      const decision = await diceDialog.request(plan, title, preview, { confirm, targets: presetTargetId ? undefined : targetOpts?.targets, needsTarget: presetTargetId ? false : targetOpts?.needsTarget });
      if (decision.mode === 'cancel') return null;
      const targetId = presetTargetId ?? decision.targetId;
      // Выбранная цель → богатая цель. В бою цель — комбатант (по actorId), применяем патчем на
      // сервер (синк доски + write-through в лист + журналы); иначе — персонаж (по id) в его запись.
      let richTarget: TargetContext | undefined;
      let targetCb: Combatant | undefined;
      let targetChar: ForgeCharacter | undefined;
      if (targetId) {
        if (encounterId) {
          targetCb = encCombatantsRef.current.find((c) => c.actorId === targetId);
          if (targetCb) richTarget = await buildEncounterTarget(targetCb);
        } else {
          targetChar = (targetCharsRef.current ?? []).find((c) => c.id === targetId);
          if (targetChar) richTarget = buildTargetFromCharacter(targetChar);
        }
      }
      const rng = decision.mode === 'manual' ? plannedValuesRng(plan, decision.values) : () => Math.random();
      if (ordinaryCanonical) {
        const canonicalResult = executeSheetCanonicalAction({
          canonical: ordinaryCanonical.canonical,
          state: baseState,
          declaration: ordinaryCanonical.declaration,
          targetActors: ordinaryCanonical.targetActors,
          rng,
          commandId: ordinaryCanonical.commandId,
          resolveTargetSaves: true,
        });
        if (canonicalResult.pendingResolution) {
          throw new UnsupportedSheetPendingResolutionError(canonicalResult.pendingResolution.type);
        }
        const atomicCommit = prepareSheetAtomicWorldCommit({
          commandId: ordinaryCanonical.commandId,
          participants: [{
            character,
            canonical: ordinaryCanonical.canonical.runtime,
            world: canonicalResult.canonicalWorld,
          }, ...ordinaryCanonical.targetParticipants.map((participant) => ({
            ...participant,
            world: projectSheetAtomicParticipantWorld({
              participant,
              acceptedWorld: canonicalResult.canonicalWorld,
              commandId: ordinaryCanonical.commandId,
            }),
          }))],
          events: canonicalResult.ruleEvents ?? [],
        });
        return {
          state: canonicalResult.state,
          events: canonicalResult.events,
          pending: [],
          atomicCommit,
          targetId: ordinaryCanonical.declaration.targetIds[0],
          canonicalWorld: canonicalResult.canonicalWorld,
        };
      }
      // Спас цели в бою: предрассчитываем ОБА исхода движком с ОДИНАКОВЫМИ костями урона
      // (record/replay rng — иначе успех не был бы «половиной» тех же костей). Персонаж бросит спас
      // сам у себя (pending); монстр без листа — кастер катит его спас и применяет сразу.
      if (battleTargetSave && targetCb && richTarget) {
        const save = readTargetSave(m, execCtx(() => 0.5, false, choices, richTarget));
        if (!save) {
          throw new Error('Скомпилированное действие не содержит явных ability/DC спасброска');
        }
        // Предрасчёт по цели с ОГРОМНЫМ hp — чтобы урон не упёрся в 0 и дельта несла истинный урон
        // (ограничит уже цель по своему текущему hp). temp/сопротивления — реальные.
        const BIGHP = 1e7;
        const baseTemp = richTarget.runtimeState?.hp.temp ?? 0;
        const precTarget: TargetContext = richTarget.runtimeState
          ? { ...richTarget, runtimeState: { ...richTarget.runtimeState, hp: { current: BIGHP, max: BIGHP, temp: baseTemp } } }
          : richTarget;
        // Два прогона с ОДИНАКОВЫМИ костями урона (record/replay rng): провал rf и успех rs.
        const drawn: number[] = [];
        const recRng = () => { const v = rng(); drawn.push(v); return v; };
        const rf = executeSheetAction({
          state: baseState,
          mechanics: m,
          context: execCtx(recRng, false, choices, precTarget, 'fail'),
          canonical: canonicalContext,
          canonicalInput,
        });
        let ri = 0;
        const replayRng = () => (ri < drawn.length ? drawn[ri++] : Math.random());
        const rs = executeSheetAction({
          state: baseState,
          mechanics: m,
          context: execCtx(replayRng, false, choices, precTarget, 'success'),
          canonical: canonicalContext,
          canonicalInput,
        });
        const damageType = (rf.events.find((e) => e.type === 'damage') as { damageType?: string } | undefined)?.damageType;
        const prevEff = targetCb.activeEffects ?? [];
        const onFail: SaveOutcome = { ...outcomeDelta(BIGHP, baseTemp, prevEff, rf.targetState), damageType };
        const onSuccess: SaveOutcome = { ...outcomeDelta(BIGHP, baseTemp, prevEff, rs.targetState), damageType };
        if (save && targetCb.characterId) {
          // Персонаж — цель бросит спас сама. Журнал кастера — как обычный каст (rf.events содержат
          // и его само-эффекты, и бросок урона); цель отдельно залогирует фактически полученный урон.
          await emitPendingSave(targetCb, m, save, onFail, onSuccess);
          const casterEvents: EngineEvent[] = [...rf.events, { type: 'narrative', text: `«${String(m.name ?? action.name)}» → ${targetCb.name}: спасбросок ${save.ability.toUpperCase()} СЛ ${save.dc} (цель бросает у себя)` }];
          return { state: rf.state, events: casterEvents, pending: rf.pendingReactions ?? [], commitTarget: undefined, targetId };
        }
        // Монстр (нет листа): кастер катит спас монстра (мод — из поля «Спас цели») и применяет дельту.
        if (typeof targetSaveMod !== 'number' || !Number.isSafeInteger(targetSaveMod)) {
          throw new Error('Для монстра требуется явно указать модификатор спасброска');
        }
        const sroll = rollD20({ modifiers: [{ value: targetSaveMod, source: 'цель', reason: 'спасбросок' }], target: { type: 'dc', value: save.dc }, rng: () => Math.random() });
        const monOut = sroll.outcome === 'success' ? onSuccess : onFail;
        const saveEvent: EngineEvent = { type: 'roll', label: `Спасбросок ${save.ability.toUpperCase()} цели — ${sroll.outcome === 'success' ? 'успех' : 'провал'}`, roll: sroll };
        const commitTarget = () => applyMonsterSaveOutcome(targetCb!, monOut, sroll, save.ability);
        return { state: rf.state, events: [saveEvent], pending: rf.pendingReactions ?? [], commitTarget, targetId };
      }
      const r = executeSheetAction({
        state: baseState,
        mechanics: m,
        context: execCtx(rng, false, choices, richTarget),
        canonical: canonicalContext,
        canonicalInput,
      });
      if (r.pendingResolution) {
        throw new UnsupportedSheetPendingResolutionError(r.pendingResolution.type);
      }
      const selfTargetState = targetChar?.id === character.id && r.targetState
        ? mergeSelfTargetRuntime(baseState, r.state, r.targetState)
        : null;
      let commitTarget: (() => Promise<void>) | undefined;
      if (r.targetState && !selfTargetState) {
        const tstate = r.targetState;
        if (targetCb) {
          // Реакции на попадание: если АТАКА попала по персонажу-комбатанту и нанесла урон,
          // сохраняем точные каналы урона в pending-«атакован».
          const atkEv = r.events.find((e) => e.type === 'roll' && e.roll?.kind === 'd20' && (e.roll?.outcome === 'hit' || e.roll?.outcome === 'crit')) as Extract<EngineEvent, { type: 'roll' }> | undefined;
          const damage = pendingAttackDamage(
            { hp: targetCb.hp, temp: targetCb.temp ?? 0 },
            { hp: tstate.hp.current, temp: tstate.hp.temp ?? 0 },
          );
          const pendingAtk: PendingAttack | undefined = targetCb.characterId && atkEv && damage.damage > 0
            ? { id: uid(), sourceName: character.name, attackName: String(m.name ?? title), attackTotal: atkEv.roll.total, ...damage, damageType: (r.events.find((e) => e.type === 'damage') as { damageType?: string } | undefined)?.damageType, crit: atkEv.roll.outcome === 'crit' }
            : undefined;
          commitTarget = () => applyToEncounterTarget(targetCb!, tstate, r.events, pendingAtk);
        } else if (targetChar) commitTarget = () => persistTarget(targetChar!, tstate);
      }
      return {
        state: selfTargetState ?? r.state,
        events: r.events,
        pending: r.pendingReactions ?? [],
        targetState: r.targetState,
        commitTarget,
        targetId,
        canonicalWorld: r.canonicalWorld,
      };
    };

    try {
      // Подтверждение «Применить»/«Отмена» для действий, тратящих ЛЮБОЙ ресурс (основное/бонусное
      // действие, реакцию, слот, заряд, …) или заклинаний — даже когда кубов нет (при включённом
      // диалоге кубов). Атаки с кубами и так показывают окно броска.
      const needsConfirm = spendsResource(mech) || !!action.spellRef;
      // Действие взаимодействует с другим персонажем → предложить выбор цели в окне (при включённом
      // диалоге кубов). Список всех персонажей, кроме себя. При выключенном диалоге — dummy, как раньше.
      const interactsWithTarget = requiresActorTarget && !sceneTarget;
      let targetOptions: { id: string; name: string }[] | undefined;
      if (interactsWithTarget && getSettings().diceDialog) {
        if (encounterId) {
          // В бою: цели — комбатанты боя (по actorId, включая монстров), кроме себя.
          const combatants = await loadEncounterCombatants();
          targetOptions = combatants
            .filter((c) => c.characterId !== character.id || allowsSelfTarget)
            .map((c) => ({
            id: c.actorId, name: c.name,
            // E: очаровавшего нельзя выбрать целью (с подсказкой почему).
            ...(c.characterId && charmerIds.has(c.characterId) ? { disabled: true, reason: 'вы очарованы им' } : {}),
          }));
        } else {
          const chars = await loadTargetChars();
          targetOptions = chars
            .filter((c) => c.id !== character.id || allowsSelfTarget)
            .map((c) => characterInteractionTargetOption(c, charmerIds));
        }
      }
      const main = await runViaDialog(runtime, mech, action.name, previewFor(action), needsConfirm,
        { targets: targetOptions, needsTarget: interactsWithTarget },
        canonicalTargetId ?? selectedTargetForAction?.id,
        primitive ? canonical : undefined,
        ordinaryCanonicalExecution);
      if (!main) return;
      let { state, events } = main;
      if (main.atomicCommit) {
        await commitOrdinarySpellInteraction(main.atomicCommit);
        return;
      }
      // Применённое к цели состояние (урон/лечение/эффекты) — на комбатанта боя или в запись персонажа.
      if (main.commitTarget) await main.commitTarget();
      // Заклинание с концентрацией: чип + вытеснение предыдущей концентрации.
      if (action.spellRef?.concentration && !main.canonicalWorld) {
        const previousEffectIds = new Set(runtime.activeEffects.map((effect) => effect.id));
        const concentrationEffectIds = state.activeEffects
          .filter((effect) => {
            if (previousEffectIds.has(effect.id)) return false;
            const duration = (effect.mechanics as Record<string, unknown>).duration as Record<string, unknown> | undefined;
            return duration?.concentration === true;
          })
          .map((effect) => effect.id);
        const conc = startConcentration(state, action.name, concentrationEffectIds);
        state = conc.state;
        events = [...events, ...conc.events];
      }

      // Предложенные реакции/триггеры (фаза A: interrupt): всплывающее окно решения. Для заклинаний
      // на ячейку — опции апкаста (Божественная кара). Свободные optional-триггеры (Голиаф) — тоже спрашиваем.
      for (const offer of main.pending) {
        const slotIdx = offer.cost.findIndex((c) => String(c.resource ?? '') === 'spell_slot' && c.level != null);
        const nonSlot = offer.cost.filter((_, i) => i !== slotIdx);
        if (nonSlot.length && !canPay(state, nonSlot).ok) continue; // нет действия/реакции — не предлагаем
        let options: { id: string; label: string }[] | undefined;
        let baseLevel = 0;
        if (slotIdx >= 0) {
          baseLevel = Number(offer.cost[slotIdx].level) || 1;
          const need = Number(offer.cost[slotIdx].amount ?? 1) || 1;
          const levels: number[] = [];
          for (let L = baseLevel; L <= 9; L += 1) if ((state.resources[`spell_slot_${L}`] ?? 0) >= need) levels.push(L);
          if (!levels.length) continue; // нет ячеек — не предлагаем
          options = levels.map((L) => ({ id: String(L), label: L === baseLevel ? `${L} круг` : `${L} круг (апкаст +${L - baseLevel})` }));
        }
        const res = await reactionPrompt.request(offer, { describe: describeMechanicsLine(offer.mechanics), options });
        if (res.decision !== 'accept') continue;
        let rmech: Record<string, unknown> = { ...offer.mechanics, name: offer.name };
        spellCtx = undefined; // реакция — отдельный каст; не тянем апкаст основного действия
        if (slotIdx >= 0 && res.option) {
          const L = Number(res.option);
          const act = rmech.activation as Record<string, unknown> | undefined;
          const rcost = ((act?.cost as Record<string, unknown>[]) ?? []).map((c, i) => (i === slotIdx ? { ...c, level: L } : c));
          rmech = { ...rmech, activation: { ...(act ?? {}), cost: rcost } };
          spellCtx = { baseLevel, castLevel: L };
        }
        // Райдер по той же цели, что и попадание (Божественная кара/Голиаф бьют по цели атаки).
        const r = await runViaDialog(state, rmech, offer.name, undefined, false, undefined, main.targetId);
        if (!r) continue;
        state = r.state;
        events = [...events, ...r.events];
        if (r.commitTarget) await r.commitTarget();
      }

      const canonicalTargetNames = ordinaryCanonicalExecution?.declaration.targetIds.map((targetId) => (
        targetId === TRAINING_DUMMY_TARGET_ID
          ? TRAINING_DUMMY.name
          : ordinaryCanonicalExecution.targetActors.find((actor) => actor.id === targetId)?.name
      )).filter((name): name is string => Boolean(name)) ?? [];
      const selectedJournalTarget = main.targetId
        ? (main.targetId === TRAINING_DUMMY_TARGET_ID
            ? TRAINING_DUMMY.name
            : targetOptions?.find((option) => option.id === main.targetId)?.name
              ?? (selectedTargetForAction?.id === main.targetId ? selectedTargetForAction.name : undefined))
        : undefined;
      apply(
        state,
        contextualizeSheetJournalEvents({
          actionName: action.name,
          targetNames: canonicalTargetNames.length
            ? canonicalTargetNames
            : selectedJournalTarget ? [selectedJournalTarget] : [],
          events,
        }),
        main.canonicalWorld,
      );
    } catch (e) {
      if (e instanceof InsufficientResourcesError) {
        setError('Недостаточно ресурсов');
        return;
      }
      console.error(e);
      setError(playerFacingSheetActionError(e));
    }
  };

  // Доступность + причина недоступности: сперва экипировка (оружие в руке), затем ресурсы.
  const disabledInfo = (action: SheetAction): { disabled: boolean; reason?: string } => {
    if (pendingAtomicRetry) {
      return {
        disabled: true,
        reason: `Ожидается безопасный повтор ${sheetAtomicRetryLabel(pendingAtomicRetry)}`,
      };
    }
    const contextualCostIssue = contextualCostProjection.issues.get(action.id);
    if (contextualCostIssue) return { disabled: true, reason: contextualCostIssue };
    const primitive = mechanicsPrimitiveType(action.mechanics);
    const pendingCombat = primitive ? isSheetPendingCombatPrimitive(primitive) : false;
    if (action.spellRef && !primitive) {
      if (canonicalBuild.error) return { disabled: true, reason: canonicalBuild.error.message };
      try {
        canonicalFor(action);
      } catch (cause) {
        return {
          disabled: true,
          reason: cause instanceof Error ? cause.message : String(cause),
        };
      }
    }
    if (primitive) {
      const primitiveReason = sheetPrimitiveDisabledReason(primitive);
      if (primitiveReason) return { disabled: true, reason: primitiveReason };
      if (canonicalBuild.error) return { disabled: true, reason: canonicalBuild.error.message };
      try {
        const canonical = canonicalFor(action);
        const definitionIssue = canonical ? sheetPrimitiveDefinitionIssue(canonical.action) : null;
        if (definitionIssue) return { disabled: true, reason: definitionIssue };
        if (canonical && !canonical.action.targeting) {
          return { disabled: true, reason: 'У канонического действия нет явного targeting-контракта' };
        }
        if (canonical && sheetActionRequiresActorTargets(canonical.action) && !pendingCombat) {
          return {
            disabled: true,
            reason: 'Этот канонический примитив требует выбора персонажа и явных фактов цели; продолжение ещё не подключено',
          };
        }
        if (pendingCombat && encounterId) {
          return { disabled: true, reason: 'Двухлистовая атомарная команда пока недоступна внутри онлайн-боя' };
        }
        if (pendingCombat && certifiedCombat.loading) {
          return { disabled: true, reason: 'Проверяется сертифицированный combat release' };
        }
        if (pendingCombat && certifiedCombat.error) {
          return { disabled: true, reason: certifiedCombat.error.message };
        }
        if (pendingCombat && canonical && certifiedCombat.catalog) {
          assertCertifiedSheetCombatActorAction(
            canonical.action,
            canonical.runtime.world.actors[character.id],
            certifiedCombat.catalog,
          );
        }
        if (pendingCombat && !Number.isSafeInteger(character.runtime_revision)) {
          return { disabled: true, reason: 'Сервер не вернул runtime_revision персонажа' };
        }
        if (pendingCombat && combatContinuation.error) {
          return { disabled: true, reason: combatContinuation.error.message };
        }
        if (pendingCombat && combatContinuation.session?.world.pendingResolution) {
          return { disabled: true, reason: 'Сначала завершите ожидающее решение' };
        }
        if (canonical) {
          const timingIssue = sheetPrimitiveCastTimingIssue(
            canonical,
            encounterId ? 'encounter' : 'exploration',
          );
          if (timingIssue) return { disabled: true, reason: timingIssue };
        }
        collectSheetPrimitiveChoices(canonical, encounterId ? 'encounter' : 'exploration');
      } catch (cause) {
        return {
          disabled: true,
          reason: cause instanceof Error ? cause.message : String(cause),
        };
      }
    }
    const avail = weaponActionAvailability(action.mechanics, runtime.equipment, equipCards);
    if (!avail.available) return { disabled: true, reason: avail.reason };
    if (!primitive
      && !legacyUnarmedTargetAction(action)
      && !(selectedSheetTarget && actionInteractsWithTarget(action.mechanics))) {
      const targetFactsIssue = explicitSheetTargetFactsIssue(action.mechanics, {
        armorClass: targetAc,
        savingThrowModifier: targetSaveMod,
      });
      if (targetFactsIssue) return { disabled: true, reason: targetFactsIssue };
    }
    const activation = action.mechanics.activation as Record<string, unknown> | undefined;
    const baseCost = (activation?.cost as Record<string, unknown>[]) ?? [];
    // D: Недееспособность запрещает экономику хода — гейтим действие, если его стоимость включает
    // запрещённый тип (действие/бонусное/реакция) или оно требует концентрации при её запрете.
    const capReason = deniedActionReason(action, baseCost);
    if (capReason) return { disabled: true, reason: capReason };
    if (primitive) {
      const nonSlotCost = baseCost.filter((entry) => (
        String(entry.resource ?? '') !== 'spell_slot'
      ));
      if (nonSlotCost.length && !canPay(runtime, nonSlotCost).ok) {
        return { disabled: true, reason: 'Недостаточно ресурсов' };
      }
      return { disabled: busy };
    }
    const cost = baseCost;
    // Апкаст: спелл доступен при любом слоте ≥ базового круга; freeuse снимает требование
    // ячейки (не действия) — заклинание всё равно требует свободного действия/бонуса.
    const payable = !cost.length || payableWithUpcast(runtime, cost, !!freeuseFor(action));
    if (!payable) {
      // Внятная причина для нехватки предмета-стоимости (боеприпас/зелье): показываем имя.
      const miss = cost.find((c) => String(c.resource ?? '') === 'item'
        && inventoryQty(runtime, String(c.card_id ?? '')) < costAmount(c));
      if (miss) {
        const name = (typeof miss.name === 'string' && miss.name)
          || equipCards.get(String(miss.card_id ?? ''))?.name || 'боеприпас';
        return { disabled: true, reason: `Нет: ${name}` };
      }
      return { disabled: true, reason: 'Недостаточно ресурсов' };
    }
    return { disabled: busy };
  };

  const activeEffectGroups = groupActiveEffectsForDisplay(runtime.activeEffects);

  const handleDismissEffect = (effectIds: readonly string[]) => {
    const { state, events } = removeActiveEffectGroup(runtime, effectIds);
    apply(state, events);
  };

  const handleRemoteManipulator = async (
    command: Parameters<typeof executeRemoteManipulator>[1],
  ) => {
    const result = executeRemoteManipulator(runtime, command);
    await apply(result.state, result.events);
  };

  const spellIsPrepared = (action: SheetAction): boolean => {
    if (!action.spellRef) return true;
    const canonical = canonicalBuild.runtime;
    if (!canonical) return false;
    const access = canonical.world.actors[canonical.actorId]?.spellcastingAccess;
    if (!access) return false;
    const sourceActions = canonical.actionsFor?.(action) ?? [];
    return sourceActions.some((candidate) => isSpellActionPrepared(access, candidate.id));
  };

  const actionBlockActions = actions.filter((action) => {
    const activation = action.mechanics.activation as Record<string, unknown> | undefined;
    // Reactions remain actor capabilities for canonical combat, but are never
    // manually activatable entries in the ordinary Action block.
    if (activation?.mode === 'reaction') return false;
    return action.group !== 'spell' || spellIsPrepared(action);
  });

  const allGroups: { key: string; label: string; items: SheetAction[] }[] = [
    { key: 'basic', label: 'Базовые', items: actionBlockActions.filter((a) => a.group === 'basic') },
    { key: 'race', label: 'Вид', items: actionBlockActions.filter((a) => a.group === 'race') },
    { key: 'class', label: 'Класс', items: actionBlockActions.filter((a) => a.group === 'class') },
    { key: 'item', label: 'Предметы', items: actionBlockActions.filter((a) => a.group === 'item') },
    { key: 'spell', label: 'Заклинания', items: actionBlockActions.filter((a) => a.group === 'spell') },
  ];
  // Режим «только заклинания»: группировка по кругам (тот же SheetActionLine и то же
  // поведение по клику/наведению, что и в блоке «Действия»).
  const spellLevelGroups: { key: string; label: string; items: SheetAction[] }[] = (() => {
    const m = new Map<number, SheetAction[]>();
    for (const a of actions) {
      if (a.group !== 'spell') continue;
      const lvl = a.spellRef?.level ?? a.level ?? 0;
      if (!m.has(lvl)) m.set(lvl, []);
      m.get(lvl)!.push(a);
    }
    return [...m.entries()].sort((x, y) => x[0] - y[0]).map(([lvl, items]) => ({ key: `lvl-${lvl}`, label: getSpellLevelLabel(lvl), items }));
  })();
  const groups = spellsOnly ? spellLevelGroups : allGroups;

  const combatSession = combatContinuation.session;
  const combatActorNames = combatSession
    ? Object.fromEntries(Object.values(combatSession.world.actors).map((actor) => [actor.id, actor.name]))
    : {};
  const combatScene = combatSession?.world.scene.mode === 'encounter'
    ? combatSession.world.scene
    : null;
  const activeCombatActorId = combatScene
    ? combatScene.initiative[combatScene.activeIndex]
    : null;
  let combatSessionCertificationError: Error | null = null;
  if (combatSession) {
    try {
      requireCertifiedCombatSession(combatSession);
    } catch (cause) {
      combatSessionCertificationError = cause instanceof Error
        ? cause
        : new Error(String(cause));
    }
  }

  const body = (
    <>
      {worldInputDialog.dialog}
      {combatTargetDialog.dialog}
      {error && <p className="issues" role="alert" data-testid="sheet-action-error">{error}</p>}
      {busy && (
        <p className="forge-note" role="status" data-testid="sheet-action-progress">
          Сохраняем результат действия…
        </p>
      )}
      {showAtomicRetryControl && pendingAtomicRetry && (
        <section className="sheet-group" role="alert" data-testid="sheet-atomic-retry">
          <h3 className="sheet-h3">Ответ {sheetAtomicRetryLabel(pendingAtomicRetry)} не подтверждён</h3>
          <p>Повтор использует тот же command_id и те же CAS-снимки всех участников.</p>
          <button
            type="button"
            className="forge-btn"
            disabled={busy}
            onClick={() => {
              if (pendingAtomicRetry.kind === 'combat') {
                void commitCombat(pendingAtomicRetry.prepared);
              } else if (pendingAtomicRetry.kind === 'companion') {
                void commitCompanionInteraction(pendingAtomicRetry.prepared);
              } else {
                void commitOrdinarySpellInteraction(pendingAtomicRetry.prepared);
              }
            }}
          >
            Безопасно повторить
          </button>
        </section>
      )}
      {!spellsOnly && hasSheetCombatSession(character.turn_state) && (combatContinuation.error || combatScene) && (
        <section className="sheet-group" role={combatContinuation.error ? 'alert' : 'status'} data-testid="sheet-combat-reset">
          <h3 className="sheet-h3">
            {combatContinuation.error ? 'Сохранённое решение устарело' : 'Одиночный бой активен'}
          </h3>
          {combatContinuation.error && <p>{combatContinuation.error.message}</p>}
          <button
            type="button"
            className="forge-btn ghost"
            disabled={busy || !!pendingAtomicRetry}
            onClick={() => { void resetCombatContinuation(); }}
          >
            {combatContinuation.error ? 'Сбросить устаревшее решение' : 'Завершить одиночный бой'}
          </button>
        </section>
      )}
      {!spellsOnly && combatSession && combatSessionCertificationError && (
        <section className="sheet-group" role="alert" data-testid="sheet-combat-certification-error">
          <h3 className="sheet-h3">Продолжение боя заблокировано</h3>
          <p>{combatSessionCertificationError.message}</p>
        </section>
      )}
      {!spellsOnly && combatSession?.world.pendingResolution && !combatSessionCertificationError && (
        <SheetPendingCombatPanel
          pending={combatSession.world.pendingResolution}
          viewingCharacterId={character.id}
          decisionProxyCharacterId={
            combatSession.world.pendingResolution.request.actorId
              in combatSession.participantRevisions
              ? undefined
              : combatSession.sourceCharacterId
          }
          actorNames={combatActorNames}
          busy={busy || !!pendingAtomicRetry}
          onResolve={resolveCombatDecision}
        />
      )}
      {!spellsOnly && combatScene && !combatSession?.world.pendingResolution && !combatSessionCertificationError && (
        <section className="sheet-group" role="status" data-testid="sheet-combat-turn-state">
          <h3 className="sheet-h3">Последовательность ходов · раунд {combatScene.round}</h3>
          <p>
            Активен: {activeCombatActorId ? combatActorNames[activeCombatActorId] ?? activeCombatActorId : '—'}.
            {' '}{combatScene.turnStarted ? 'Ход начат.' : 'Ожидается начало хода.'}
          </p>
          {activeCombatActorId === character.id && (
            <button
              type="button"
              className="forge-btn ghost"
              disabled={busy || !!pendingAtomicRetry}
              onClick={() => { void moveCombatTurn(); }}
            >
              {combatScene.turnStarted ? 'Завершить ход' : 'Начать ход'}
            </button>
          )}
        </section>
      )}

      {!spellsOnly && companionModel && (
        <SheetCompanionControls
          model={companionModel}
          targets={companionTargets.map((candidate) => ({
            id: candidate.id,
            name: candidate.name,
            ...(isCharacterReadOnly(candidate)
              ? { disabledReason: 'лист доступен только для чтения' }
              : candidate.current_encounter_id
                ? { disabledReason: 'персонаж находится в онлайн-бою' }
                : !Number.isSafeInteger(candidate.runtime_revision)
                  ? { disabledReason: 'нет server runtime_revision' }
                  : candidate.system_id !== character.system_id
                    ? { disabledReason: 'другая система правил' }
                    : {}),
          }))}
          busy={busy || !!pendingAtomicRetry}
          onDismiss={handleCompanionDismiss}
          onReappear={handleCompanionReappear}
          onReplaceTome={handlePactTomeReplace}
          onTouchPactBlade={handlePactBladeTouch}
          onDeliverTouch={(declaration) => { void handleFamiliarTouch(declaration); }}
        />
      )}

      {showResources && !spellsOnly && resourceKeys.length > 0 && (
        <div className="res-tile-row">
          {resourceKeys.map((key) => {
            const cur = runtime.resources[key] ?? 0;
            const max = runtime.maxResources[key];
            const def = findResource(resourceOptions, key);
            return (
              <SheetResourceTile key={key} resourceId={key} option={def} current={cur} maximum={max} />
            );
          })}
          <FreeuseSpellsTile
            runtime={runtime}
            freeuseSpells={ruleState.freeuseSpells}
            spells={assembled.spells}
            resourceOptions={resourceOptions}
          />
        </div>
      )}

      {/* «КЗ/Спас цели» — только в основной панели действий; блок «Заклинания»
          (spellsOnly) переиспользует общий таргет родителя, поле не дублирует. */}
      {!spellsOnly && (
        <div className="sheet-target-inputs">
          <label className="sheet-target-field">
            <span>Персонаж-цель</span>
            <select
              className="forge-input"
              aria-label="Персонаж-цель"
              value={selectedSheetTargetId}
              onChange={(event) => setSelectedSheetTargetId(event.target.value)}
            >
              <option value="">Ручные параметры цели</option>
              {availableSheetTargets.map((candidate) => {
                const option = characterInteractionTargetOption(candidate, charmerIds);
                return (
                  <option key={option.id} value={option.id} disabled={option.disabled}>
                    {option.name}{option.disabled ? ` — ${option.reason}` : ''}
                  </option>
                );
              })}
            </select>
          </label>
          <label className="sheet-target-field">
            <span>КЗ цели</span>
            <input
              type="number"
              className="forge-input sheet-target-num"
              value={targetAc ?? ''}
              min={1}
              max={30}
              placeholder="—"
              disabled={Boolean(selectedSheetTarget)}
              onChange={(e) => setTargetAc(e.target.value === '' ? null : Number(e.target.value))}
            />
          </label>
          <label className="sheet-target-field">
            <span>Спас цели</span>
            <input
              type="number"
              className="forge-input sheet-target-num"
              value={targetSaveMod ?? ''}
              min={-5}
              max={20}
              placeholder="—"
              disabled={Boolean(selectedSheetTarget)}
              onChange={(e) => setTargetSaveMod(e.target.value === '' ? null : Number(e.target.value))}
            />
          </label>
          {selectedSheetTarget && (
            <p className="forge-note" role="status">
              Используются рассчитанные параметры «{selectedSheetTarget.name}»; результат применится к его листу.
            </p>
          )}
        </div>
      )}

      {groups.map(({ key, label, items }) => items.length > 0 && (
        <div key={key} className="sheet-group">
          <h3 className="sheet-h3">{label}</h3>
          <div className={actionsAsIcons ? 'cs-action-tiles' : 'sheet-item-cols'}>
            {items.map((action) => {
              // Loading/build failures are not preparation failures. Preserve
              // their real reason in the hover card until canonical access is
              // available; only then can an actor-owned grant be called
              // unprepared.
              const preparationBlocked = Boolean(
                action.spellRef
                && canonicalBuild.runtime
                && !canonicalBuild.error
                && !spellIsPrepared(action),
              );
              const { disabled, reason } = preparationBlocked
                ? { disabled: true, reason: 'Заклинание не подготовлено' }
                : disabledInfo(action);
              const weaponPreview = weaponAttackPreview(action.mechanics, ctx, runtime.equipment, runtime, passives) ?? undefined;
              return (
                <div key={action.id} data-action-id={action.id} style={actionsAsIcons ? { display: 'contents' } : undefined}>
                <SheetActionLine
                  name={sheetActionDisplayName(action)}
                  imageUrl={action.imageUrl}
                  sourceLabel={action.sourceLabel ?? (action.group === 'basic' ? 'Базовое действие' : undefined)}
                  description={action.group === 'basic' ? action.description ?? action.name : undefined}
                  detail={actionDetail(action)}
                  level={action.level}
                  variant={actionsAsIcons ? 'icon' : 'row'}
                  actionRef={action.actionRef}
                  effectRef={action.effectRef}
                  spellRef={action.spellRef}
                  spellcasting={ruleState.spellcasting
                    ? { saveDC: ruleState.spellcasting.saveDC, attack: ruleState.spellcasting.attack }
                    : undefined}
                  weaponAttackPreview={weaponPreview}
                  disabled={disabled}
                  disabledTitle={reason ?? 'Недостаточно ресурсов'}
                  disableHover={disableHoverPreviews}
                  inspectMode={!!onInspectAction}
                  onActivate={() => onInspectAction
                    ? onInspectAction(action, () => { void runAction(action); }, disabled ? (reason ?? 'Недостаточно ресурсов') : undefined)
                    : runAction(action)}
                />
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {slotPick && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-label="Выбор источника оплаты заклинания">
          <div className="absolute inset-0 bg-black/50" onClick={() => resolveCast(null)} />
          <div className="relative rounded-lg border border-[#8a7320] bg-[#1c1813] text-[#e8e0d0] shadow-xl p-4 w-72 max-w-[90vw]">
            <div className="text-sm mb-3" style={{ color: '#d8b978' }}>Как сотворить?</div>
            <div className="flex flex-col gap-1">
              {slotPick.freeuse && (
                <button
                  type="button"
                  onClick={() => resolveCast({ via: 'free' })}
                  className="flex items-center justify-between px-3 py-2 rounded border border-[#8a7320] bg-[#241f16] hover:bg-[#2b2520] text-sm text-left"
                >
                  <span>Бесплатно{slotPick.freeuse.level > slotPick.baseLevel ? ` · ${getSpellLevelLabel(slotPick.freeuse.level)}` : ''}</span>
                  <span className="text-[#d8b978] text-xs">{slotPick.freeuse.current}/{slotPick.freeuse.max}</span>
                </button>
              )}
              {slotPick.options.map((L) => (
                <button
                  key={L}
                  type="button"
                  onClick={() => resolveCast({ via: 'slot', level: L })}
                  className="flex items-center justify-between px-3 py-2 rounded border border-[#6b5836] hover:bg-[#2b2520] text-sm text-left"
                >
                  <span>{getSpellLevelLabel(L)}{L > slotPick.baseLevel ? ' · апкаст' : ''}</span>
                  <span className="text-[#a99f8b] text-xs">слотов: {runtime.resources[`spell_slot_${L}`] ?? 0}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => resolveCast(null)}
              className="mt-3 w-full px-3 py-1.5 rounded border border-[#6b5836] text-xs text-[#a99f8b] hover:bg-[#2b2520]"
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      {showEffects && !spellsOnly && activeEffectGroups.length > 0 && (
        <div className="sheet-group" style={{ marginTop: 8 }}>
          <h3 className="sheet-h3">Активные эффекты</h3>
          <ul className="sheet-active-effects">
            {activeEffectGroups.map((group) => {
              const fx = group.effects[0];
              const remoteManipulator = group.effects.find((effect) => remoteManipulatorSpec(effect));
              return (
              <li key={group.key} className="sheet-active-effect">
                <span className="sheet-active-effect-summary">
                  <span className="sheet-active-effect-name">{group.name}</span>
                  {group.instructions.length > 0 && (
                    <span className="sheet-active-effect-detail">{group.instructions.join(' ')}</span>
                  )}
                </span>
                <span className="sheet-active-effect-meta">{expiryLabel(fx.expiry, fx.roundsLeft)}</span>
                {remoteManipulator && (
                  <RemoteManipulatorControl
                    effect={remoteManipulator}
                    disabled={busy || (runtime.resources.action ?? 0) < 1}
                    onExecute={handleRemoteManipulator}
                  />
                )}
                <button
                  type="button"
                  className="sheet-active-effect-dismiss"
                  disabled={busy}
                  title="Снять вручную"
                  onClick={() => handleDismissEffect(group.effects.map((effect) => effect.id))}
                >
                  <X size={14} />
                </button>
              </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );

  if (embedded) return body;

  return (
    <section className="sheet-panel sheet-panel-wide">
      <h2 className="sheet-h2">Действия</h2>
      {body}
      <p className="forge-note" style={{ marginTop: 8 }}>
        Атаки используют КЗ цели выше. Результаты — в журнале с анимацией броска.
      </p>
    </section>
  );
}
