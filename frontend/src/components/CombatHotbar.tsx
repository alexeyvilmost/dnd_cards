import { Footprints, MoreHorizontal } from 'lucide-react';
import { canPay, costKey } from '../engine/cost';
import { isFreeusePoolKey } from '../engine/freeuse';
import type { RuleActionDefinition } from '../rules-core/domain';
import { resolveSpellAccess } from '../rules-core/spellcastingAccess';
import type { SoloCombatState } from '../solo-combat/types';
import { findResource, useResourceOptions } from '../utils/resources';
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

export function combatActionAvailability(
  state: SoloCombatState,
  action: RuleActionDefinition,
): { enabled: boolean; reason?: string } {
  const actor = state.world.actors[state.characterId];
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

  const activation = action.mechanics.activation as Record<string, unknown> | undefined;
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
  state, selectedActionId, movementMode, disabled,
  onAction, onMove, onEndTurn, onSheet,
}: {
  state: SoloCombatState;
  selectedActionId: string | null;
  movementMode: boolean;
  disabled: boolean;
  onAction: (action: RuleActionDefinition) => void;
  onMove: () => void;
  onEndTurn: () => void;
  onSheet: () => void;
}) {
  const resourceOptions = useResourceOptions();
  const actor = state.world.actors[state.characterId];
  const spellcasting = actor.character.spellcastingMod == null
    ? undefined
    : {
      saveDC: 8 + actor.character.profBonus + actor.character.spellcastingMod,
      attack: actor.character.profBonus + actor.character.spellcastingMod,
    };
  const actions = state.playerActionIds.flatMap((id) => {
    const action = state.catalogActions.find((candidate) => candidate.id === id);
    return action ? [action] : [];
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
  const resources = Object.entries(actor.runtime.maxResources)
    .filter(([key, maximum]) => maximum > 0 && (
      ['action', 'bonus_action', 'reaction'].includes(key)
      || key.startsWith('spell_slot_')
    ) && !isFreeusePoolKey(key))
    .sort(([left], [right]) => sheetResourceTileOrder(left, resourceOptions)
      - sheetResourceTileOrder(right, resourceOptions) || left.localeCompare(right));

  return (
    <section className="combat-hotbar" aria-label="Панель действий">
      <div className="combat-hotbar__resources">
        <span className="combat-hotbar__portrait">
          {state.tokens[state.characterId]?.tokenUrl
            ? <img src={state.tokens[state.characterId].tokenUrl} alt="" />
            : actor.name.slice(0, 1)}
        </span>
        <div className="combat-hotbar__identity"><b>{actor.name}</b><span>HP {actor.runtime.hp.current}/{actor.runtime.hp.max}</span></div>
        <div className="res-tile-row combat-hotbar__resource-tiles">
          <FreeuseSpellsTile
            runtime={actor.runtime}
            freeuseSpells={freeuseSpells}
            spells={freeuseSpellRefs}
            resourceOptions={resourceOptions}
          />
          {resources.map(([key, maximum]) => (
            <SheetResourceTile
              key={key}
              resourceId={key}
              option={findResource(resourceOptions, key)}
              current={actor.runtime.resources[key] ?? 0}
              maximum={maximum}
            />
          ))}
        </div>
      </div>

      <div className="combat-hotbar__utility" role="group" aria-label="Управление полем">
        <button type="button" className={`combat-utility-button${movementMode ? ' is-selected' : ''}`} disabled={disabled} onClick={onMove} title="Перемещение">
          <Footprints /><span>Движение</span><small>{state.movementRemainingFt[state.characterId] ?? 0} фт.</small>
        </button>
        <button type="button" className="combat-utility-button" onClick={onSheet} title="Открыть сокращённый лист">
          <MoreHorizontal /><span>Лист</span>
        </button>
      </div>

      <div className="combat-hotbar__actions cs-action-tiles site-scrollbar" aria-label="Действия персонажа">
        {actions.map((action) => {
          const availability = combatActionAvailability(state, action);
          const presentation = state.actionPresentation?.[action.id];
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
                actionRef={presentation?.actionRef}
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
      </div>

      <button type="button" className="combat-end-turn" disabled={disabled} onClick={onEndTurn}>Завершить ход</button>
    </section>
  );
}
