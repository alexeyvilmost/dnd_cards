import { useEffect, useState } from 'react';
import { Footprints, MoreHorizontal } from 'lucide-react';
import { canPay, costKey } from '../engine/cost';
import { FREEUSE_SHOWCASE_KEY, isFreeusePoolKey } from '../engine/freeuse';
import { bindEquippedWeaponActionContext } from '../engine/weapon';
import type { RuleActionDefinition } from '../rules-core/domain';
import { resolveSpellAccess } from '../rules-core/spellcastingAccess';
import { parseActivationLevelRequirement } from '../rules-core/activationRequirements';
import { applyUnarmedDamageProfileToAction } from '../rules-core/fightingStyleComplexPrimitives';
import { playerActionIdsFor, type SoloCombatState } from '../solo-combat/types';
import { isTriggeredCombatAction } from '../solo-combat/engine';
import { actionCostResourceIds, findResource, useResourceOptions } from '../utils/resources';
import SheetActionLine from './SheetActionLine';
import FreeuseSpellsTile from './FreeuseSpellsTile';
import SheetResourceTile, { sheetResourceTileOrder } from './SheetResourceTile';

const RESOURCE_LABELS: Record<string, string> = {
  action: 'Действие',
  bonus_action: 'Бонусное действие',
  reaction: 'Реакция',
  spell_slot: 'Ячейка',
  equipped_weapon_ammo: 'Боеприпас',
};

function resourceLabel(resource: string): string {
  if (resource.startsWith('spell_slot_')) return `Яч. ${resource.slice('spell_slot_'.length)}`;
  if (resource.startsWith('freeuse-')) return 'Бесплатный каст';
  return RESOURCE_LABELS[resource] ?? resource;
}

export function actionCost(action: RuleActionDefinition): string {
  const activation = action.mechanics.activation as Record<string, unknown> | undefined;
  const costs = Array.isArray(activation?.cost) ? activation.cost as Array<Record<string, unknown>> : [];
  return costs.map((cost) => resourceLabel(String(cost.resource ?? ''))).filter(Boolean).join(' + ');
}

function actionLabel(action: RuleActionDefinition): string {
  const primitive = action.mechanics.primitive as Record<string, unknown> | undefined;
  return primitive?.type === 'weapon_attack' ? 'Атака' : action.name;
}

export function filterCombatActionsByResource(
  actions: RuleActionDefinition[],
  selectedResourceId: string | null,
  freeuseActionIds: ReadonlySet<string>,
): RuleActionDefinition[] {
  if (!selectedResourceId) return actions;
  if (selectedResourceId === FREEUSE_SHOWCASE_KEY) {
    return actions.filter((action) => freeuseActionIds.has(action.id));
  }
  return actions.filter((action) => actionCostResourceIds(action).includes(selectedResourceId));
}

export function combatActionAvailability(
  state: SoloCombatState,
  action: RuleActionDefinition,
  actorId = state.characterId,
): { enabled: boolean; reason?: string } {
  const actor = state.world.actors[actorId];
  const levelRequirement = parseActivationLevelRequirement(action.mechanics);
  if (levelRequirement.status === 'invalid') {
    return { enabled: false, reason: 'Некорректное требование уровня' };
  }
  if (levelRequirement.status === 'required'
    && actor.character.level < levelRequirement.minLevel) {
    return { enabled: false, reason: `Доступно с уровня ${levelRequirement.minLevel}` };
  }
  let spellSlotResource: string | undefined;
  if (action.kind === 'spell') {
    if (!actor.spellcastingAccess) {
      return { enabled: false, reason: 'У персонажа нет источника этого заклинания' };
    }
    const access = resolveSpellAccess({
      state: actor.spellcastingAccess,
      actionId: action.id,
      resources: actor.runtime.resources,
    });
    if (access.status === 'rejected') {
      const reason = access.code === 'SpellResourceUnavailable'
        ? 'Нет бесплатного применения или подходящей ячейки'
        : access.code === 'SpellNotPrepared'
          ? 'Заклинание не подготовлено'
          : 'Заклинание недоступно из выбранного источника';
      return { enabled: false, reason };
    }
    // SpellcastingAccess owns selection between a grant's free-use and slot
    // payment. The shared generic cost engine still validates every remaining
    // declared cost (action economy, items, charges, and custom resources).
    spellSlotResource = access.grant.slotResource;
  }

  let mechanics = action.mechanics;
  const templateActivation = mechanics.activation as Record<string, unknown> | undefined;
  const templateCosts = Array.isArray(templateActivation?.cost)
    ? templateActivation.cost as Array<Record<string, unknown>>
    : [];
  if (templateCosts.some((cost) => cost.resource === 'equipped_weapon_ammo')) {
    try {
      const cards = [
        ...(actor.character.knownCards ?? []),
        ...(actor.character.equippedCards ?? []),
      ];
      mechanics = bindEquippedWeaponActionContext(
        mechanics,
        actor.runtime.equipment,
        new Map(cards.map((card) => [card.id, card])),
      );
    } catch (error) {
      return {
        enabled: false,
        reason: error instanceof Error ? error.message : 'Не удалось определить боеприпас оружия',
      };
    }
  }
  const activation = mechanics.activation as Record<string, unknown> | undefined;
  const costs = Array.isArray(activation?.cost) ? activation.cost as Array<Record<string, unknown>> : [];
  const genericCosts = costs.filter((cost) => {
    if (action.kind !== 'spell') return true;
    const resource = String(cost.resource ?? '');
    return resource !== 'spell_slot' && costKey(cost) !== spellSlotResource;
  });
  const payable = canPay(actor.runtime, genericCosts);
  if (!payable.ok) {
    const missing = payable.missing.map((key) => (
      key.startsWith('item:') ? `предмет ${key.slice('item:'.length)}` : resourceLabel(key)
    ));
    return {
      enabled: false,
      reason: missing.length === 1
        ? `Не хватает ресурса «${missing[0]}»`
        : `Не хватает: ${missing.join(', ')}`,
    };
  }
  return { enabled: true };
}

export default function CombatHotbar({
  state, actorId, selectedActionId, movementMode, disabled,
  onAction, onMove, onEndTurn, onSheet,
}: {
  state: SoloCombatState;
  actorId: string;
  selectedActionId: string | null;
  movementMode: boolean;
  disabled: boolean;
  onAction: (action: RuleActionDefinition) => void;
  onMove: () => void;
  onEndTurn: () => void;
  onSheet: () => void;
}) {
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(null);
  useEffect(() => setSelectedResourceId(null), [actorId]);
  const resourceOptions = useResourceOptions();
  const actor = state.world.actors[actorId];
  const spellcasting = actor.character.spellcastingMod == null
    ? undefined
    : {
      saveDC: 8 + actor.character.profBonus + actor.character.spellcastingMod,
      attack: actor.character.profBonus + actor.character.spellcastingMod,
    };
  const actions = playerActionIdsFor(state, actorId).flatMap((id) => {
    const action = state.catalogActions.find((candidate) => candidate.id === id);
    return action && !isTriggeredCombatAction(action) ? [action] : [];
  });
  const freeuseResources = Object.entries(actor.runtime.maxResources)
    .filter(([key, maximum]) => maximum > 0 && isFreeusePoolKey(key));
  const freeuseSpells = freeuseResources.map(([key, maximum]) => ({
    spell: key.slice('freeuse-'.length),
    count: maximum,
    recharge: 'long_rest',
  }));
  const freeuseSpellRefs = freeuseResources.flatMap(([key]) => {
    const grant = actor.spellcastingAccess?.grants.find((candidate) => candidate.freeUseResource === key);
    const spell = grant ? state.actionPresentation?.[grant.actionId]?.spellRef : undefined;
    return spell ? [{ ...spell, card_number: key.slice('freeuse-'.length) }] : [];
  });
  const freeuseActionIds = new Set(actor.spellcastingAccess?.grants
    .filter((grant) => grant.freeUseResource && freeuseResources.some(([key]) => key === grant.freeUseResource))
    .map((grant) => grant.actionId) ?? []);
  const visibleActions = filterCombatActionsByResource(actions, selectedResourceId, freeuseActionIds);
  const resources = Object.entries(actor.runtime.maxResources)
    .filter(([key, maximum]) => maximum > 0 && (
      ['action', 'bonus_action', 'reaction'].includes(key)
      || key.startsWith('spell_slot_')
    ) && !isFreeusePoolKey(key))
    .sort(([left], [right]) => sheetResourceTileOrder(left, resourceOptions)
      - sheetResourceTileOrder(right, resourceOptions) || left.localeCompare(right));

  return (
    <section className="combat-hotbar" aria-label="Панель действий">
      <div className="combat-hotbar__resource-filter" role="group" aria-label="Фильтр действий по ресурсу">
        <FreeuseSpellsTile
          runtime={actor.runtime}
          freeuseSpells={freeuseSpells}
          spells={freeuseSpellRefs}
          resourceOptions={resourceOptions}
          selected={selectedResourceId === FREEUSE_SHOWCASE_KEY}
          onSelect={() => setSelectedResourceId((current) => current === FREEUSE_SHOWCASE_KEY ? null : FREEUSE_SHOWCASE_KEY)}
        />
        {resources.map(([key, maximum]) => (
          <SheetResourceTile
            key={key}
            resourceId={key}
            option={findResource(resourceOptions, key)}
            current={actor.runtime.resources[key] ?? 0}
            maximum={maximum}
            selected={selectedResourceId === key}
            onSelect={() => setSelectedResourceId((current) => current === key ? null : key)}
          />
        ))}
      </div>
      <div className="combat-hotbar__resources">
        <div className="combat-hotbar__character-summary">
          <span className="combat-hotbar__portrait">
            {state.tokens[actorId]?.tokenUrl
              ? <img src={state.tokens[actorId].tokenUrl} alt="" />
              : actor.name.slice(0, 1)}
          </span>
          <div className="combat-hotbar__identity"><b>{actor.name}</b><span>HP {actor.runtime.hp.current}/{actor.runtime.hp.max}</span></div>
        </div>
        <div className="combat-hotbar__utility" role="group" aria-label="Управление полем">
          <button type="button" className={`combat-utility-button${movementMode ? ' is-selected' : ''}`} disabled={disabled} onClick={onMove} title="Перемещение">
            <Footprints /><span>Движение</span><small>{state.movementRemainingFt[actorId] ?? 0} фт.</small>
          </button>
          <button type="button" className="combat-utility-button" onClick={onSheet} title="Открыть сокращённый лист">
            <MoreHorizontal /><span>Лист</span>
          </button>
        </div>
      </div>

      <div className="combat-hotbar__actions cs-action-tiles site-scrollbar" aria-label="Действия персонажа">
        {visibleActions.map((action) => {
          const availability = combatActionAvailability(state, action, actorId);
          const presentation = state.actionPresentation?.[action.id];
          const heldCards = (['main_hand', 'off_hand'] as const)
            .flatMap((slot) => {
              const cardId = actor.runtime.equipment[slot];
              const cards = [
                ...(actor.character.knownCards ?? []),
                ...(actor.character.equippedCards ?? []),
              ];
              return cardId ? cards.filter((card) => card.id === cardId) : [];
            });
          const actionRef = presentation?.actionRef
            ? applyUnarmedDamageProfileToAction(
              presentation.actionRef,
              actor.passives ?? [],
              {
                holdingWeaponOrShield: heldCards.some((card) => (
                  card.type === 'weapon' || card.type === 'shield' || card.defense_type === 'shield'
                )),
              },
            )
            : undefined;
          const actionDisabled = disabled || !availability.enabled;
          return (
            <div
              key={action.id}
              className={`combat-sheet-action${selectedActionId === action.id ? ' is-selected' : ''}`}
              data-action-id={action.id}
            >
              <SheetActionLine
                name={actionLabel(action)}
                imageUrl={presentation?.imageUrl}
                sourceLabel={presentation?.sourceLabel ?? (action.kind === 'spell' ? 'Заклинание' : 'Действие')}
                description={presentation?.description}
                level={presentation?.spellRef?.level}
                actionRef={actionRef}
                spellRef={presentation?.spellRef}
                spellcasting={spellcasting}
                variant="icon"
                disabled={actionDisabled}
                disabledTitle={availability.reason ?? (disabled ? 'Сейчас действие недоступно' : 'Недостаточно ресурсов')}
                onActivate={() => onAction(action)}
              />
            </div>
          );
        })}
        {visibleActions.length === 0 && (
          <p className="combat-hotbar__empty-filter">Нет доступных действий для этого ресурса</p>
        )}
      </div>

      <button type="button" className="combat-end-turn" disabled={disabled} onClick={onEndTurn}>Завершить ход</button>
    </section>
  );
}
