import type {SheetAction} from '../../character/actionSheet';
import {actionInteractsWithTarget} from '../../character/actionSheet';
import type {ForgeCharacter} from '../../character/types';
import type {Card} from '../../types';
import type {CharacterContext, RuntimeState} from '../../mvp/contracts';
import {bindWorldItemAction} from '../../rules-core/worldItemActions';
import {bindItemLightFuel} from '../../rules-core/itemLight';
import {runCampTargetIssue} from '../../character/sheetInteractionScope';
import {activeEffectRequirementIssue} from '../../engine/actionRequirements';
import {UNTRAINED_ARMOR_SPELL_REASON} from '../../character/untrainedArmor';
import {sheetPrimitiveDisabledReason, sheetPrimitiveDefinitionIssue, isSheetPendingCombatPrimitive, sheetActionRequiresActorTargets} from '../../character/sheetPrimitiveUi';
import {sheetPrimitiveCastTimingIssue, collectSheetPrimitiveChoices, type SheetCanonicalActionContext} from '../../character/sheetActionOrchestrator';
import {playerFacingSheetActionError} from '../../character/sheetActionError';
import {assertLiveSheetCombatActorAction, type SheetCombatSession} from '../../character/sheetCombatSession';
import {assertCertifiedSheetCombatActorAction, type CertifiedSheetCombatCatalog} from '../../character/sheetCombatCertifiedCatalog';
import {weaponActionAvailability} from '../../engine/weapon';
import {projectActionSurgeCost, projectQuickenedSpellCost} from '../../engine/actionSurge';
import {canPay, costAmount} from '../../engine/cost';
import {inventoryQty} from '../../character/inventory';
import {sheetAtomicRetryLabel, type SheetAtomicRetryEnvelope} from '../../character/sheetAtomicRetry';
import type {SheetCanonicalRuntime} from '../../character/sheetCanonicalWorld';
import {sheetActionPanelLockIssue, mechanicsPrimitiveType, legacyUnarmedTargetAction, explicitSheetTargetFactsIssue, payableWithUpcast, sheetMechanicsAllowsSelfTarget} from './actionModel';

export interface SheetActionAvailabilityInput {
  canonicalBuild: {runtime: SheetCanonicalRuntime | null; error: Error | null};
  campActionAllowsAlly: (action: SheetAction) => boolean;
  character: Pick<ForgeCharacter, 'id' | 'character_type' | 'runtime_revision'>;
  panelDisabledReason?: string;
  pendingAtomicRetry?: SheetAtomicRetryEnvelope | null;
  runtime: RuntimeState;
  ctx: CharacterContext;
  contextualCostProjection: {issues: ReadonlyMap<string, string>};
  canonicalFor: (action: SheetAction) => SheetCanonicalActionContext | undefined;
  encounterId?: string;
  combatContinuation: {session: SheetCombatSession | null; error: Error | null};
  certifiedCombat: {loading: boolean; error: Error | null; catalog: CertifiedSheetCombatCatalog | null};
  requireCombatSessionAuthority: (session: SheetCombatSession) => void;
  equipCards: Map<string, Card>;
  passives: Record<string, unknown>[];
  selectedSheetTarget: ForgeCharacter | null;
  targetAc: number | null | undefined;
  targetSaveMod: number | null | undefined;
  deniedActionReason: (action: SheetAction, cost: Record<string, unknown>[]) => string | null;
  busy: boolean;
  freeuseFor: (action: SheetAction) => unknown;
}

/** Read-only availability for the existing sheet surfaces (desktop, mobile,
 * encounter inspector). Command execution still revalidates every cost and
 * canonical declaration; rendering never consumes resources or rolls dice. */
export function sheetActionAvailability(action: SheetAction, input: SheetActionAvailabilityInput): {disabled: boolean; reason?: string} {
  const {
    canonicalBuild,
    campActionAllowsAlly,
    character,
    panelDisabledReason,
    pendingAtomicRetry,
    runtime,
    ctx,
    contextualCostProjection,
    canonicalFor,
    encounterId,
    combatContinuation,
    certifiedCombat,
    requireCombatSessionAuthority,
    equipCards,
    passives,
    selectedSheetTarget,
    targetAc,
    targetSaveMod,
    deniedActionReason,
    busy,
    freeuseFor,
  } = input;

  const canonical=canonicalBuild.runtime;
  if(canonical)action=bindItemLightFuel(canonical.world,canonical.actorId,bindWorldItemAction(canonical.world,canonical.actorId,{
    ...action,sourceEntityIds:[action.actionRef?.id??action.id],
  }));
  const campIssue = campActionAllowsAlly(action)?null:runCampTargetIssue(character.character_type,
    actionInteractsWithTarget(action.mechanics), sheetMechanicsAllowsSelfTarget(action.mechanics));
  if (campIssue) return { disabled: true, reason: campIssue };
  const panelLock = sheetActionPanelLockIssue(panelDisabledReason);
  if (panelLock) return panelLock;
  if (pendingAtomicRetry) {
    return {
      disabled: true,
      reason: `Ожидается безопасный повтор ${sheetAtomicRetryLabel(pendingAtomicRetry)}`,
    };
  }
  if ((action.mechanics.activation as Record<string, unknown> | undefined)?.counts_as === 'hide') {
    return {disabled: true, reason: 'Засада требует данных карты: используйте панель боя'};
  }
  const activeEffectIssue = activeEffectRequirementIssue(action.mechanics, runtime, ctx);
  if (activeEffectIssue) return { disabled: true, reason: activeEffectIssue };
  if (action.spellRef && ctx.untrainedArmorCategories?.length) {
    return { disabled: true, reason: UNTRAINED_ARMOR_SPELL_REASON };
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
        reason: playerFacingSheetActionError(cause),
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
      const legacyCombat = pendingCombat && combatContinuation.session?.catalogAuthority !== 'live'
        && !!combatContinuation.session;
      if (legacyCombat && certifiedCombat.loading) {
        return { disabled: true, reason: 'Проверяется сертифицированный combat release' };
      }
      if (legacyCombat && certifiedCombat.error) {
        return { disabled: true, reason: certifiedCombat.error.message };
      }
      if (pendingCombat && canonical) {
        const existing = combatContinuation.session;
        if (existing) requireCombatSessionAuthority(existing);
        if (!existing || existing.catalogAuthority === 'live') {
          assertLiveSheetCombatActorAction(canonical.action, canonical.runtime.world.actors[character.id]);
        } else {
          assertCertifiedSheetCombatActorAction(
            canonical.action,
            canonical.runtime.world.actors[character.id],
            certifiedCombat.catalog!,
          );
        }
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
        reason: playerFacingSheetActionError(cause),
      };
    }
  }
  const avail = weaponActionAvailability(action.mechanics, runtime.equipment, equipCards,passives);
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
  const payableMechanics = projectQuickenedSpellCost(
    projectActionSurgeCost(
      action.mechanics,
      runtime,
      action.spellRef ? 'spell' : 'nonspell',
    ),
    runtime,
    action.spellRef ? 'spell' : 'nonspell',
  );
  const activation = payableMechanics.activation as Record<string, unknown> | undefined;
  const baseCost = (activation?.cost as Record<string, unknown>[]) ?? [];
  // D: Недееспособность запрещает экономику хода — гейтим действие, если его стоимость включает
  // запрещённый тип (действие/бонусное/реакция) или оно требует концентрации при её запрете.
  const capReason = deniedActionReason(action, baseCost);
  if (capReason) return { disabled: true, reason: capReason };
  if (primitive) {
    const nonSlotCost = baseCost.filter((entry) => (
      String(entry.resource ?? '') !== 'spell_slot'
    ));
    const payableRuntime = canonicalBuild.runtime?.world.actors[character.id]?.runtime ?? runtime;
    if (nonSlotCost.length && !canPay(payableRuntime, nonSlotCost).ok) {
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
}
