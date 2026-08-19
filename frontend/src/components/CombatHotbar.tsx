import { Footprints, MoreHorizontal, Swords } from 'lucide-react';
import type { RuleActionDefinition } from '../rules-core/domain';
import { resolveSpellAccess } from '../rules-core/spellcastingAccess';
import type { SoloCombatState } from '../solo-combat/types';
import { findResource, useResourceOptions } from '../utils/resources';
import HoverCard from './HoverCard';
import ResourceHoverPreview from './ResourceHoverPreview';

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

function rangeLabel(action: RuleActionDefinition): string {
  const targeting = action.mechanics.targeting as Record<string, unknown> | undefined;
  if (targeting?.shape === 'self') return 'На себя';
  const range = Number(targeting?.range_ft ?? action.targeting?.rangeFt);
  return Number.isFinite(range) && range > 0 ? `${range} фт.` : 'По ситуации';
}

export function combatActionAvailability(
  state: SoloCombatState,
  action: RuleActionDefinition,
): { enabled: boolean; reason?: string } {
  const actor = state.world.actors[state.characterId];
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
  }

  const activation = action.mechanics.activation as Record<string, unknown> | undefined;
  const costs = Array.isArray(activation?.cost) ? activation.cost as Array<Record<string, unknown>> : [];
  for (const cost of costs) {
    const resource = String(cost.resource ?? '');
    if (!['action', 'bonus_action', 'reaction'].includes(resource)) continue;
    const amount = typeof cost.amount === 'number' ? cost.amount : 1;
    if ((actor.runtime.resources[resource] ?? 0) < amount) {
      return { enabled: false, reason: `Не хватает ресурса «${resourceLabel(resource)}»` };
    }
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
  const actions = state.playerActionIds.flatMap((id) => {
    const action = state.catalogActions.find((candidate) => candidate.id === id);
    return action ? [action] : [];
  });
  const resources = Object.entries(actor.runtime.maxResources).filter(([key, maximum]) => (
    maximum > 0 && (['action', 'bonus_action', 'reaction'].includes(key)
      || key.startsWith('spell_slot_') || key.startsWith('freeuse-'))
  ));
  return (
    <section className="combat-hotbar" aria-label="Панель действий">
      <div className="combat-hotbar__resources">
        <span className="combat-hotbar__portrait">
          {state.tokens[state.characterId]?.tokenUrl
            ? <img src={state.tokens[state.characterId].tokenUrl} alt="" />
            : actor.name.slice(0, 1)}
        </span>
        <div><b>{actor.name}</b><span>HP {actor.runtime.hp.current}/{actor.runtime.hp.max}</span></div>
        {resources.map(([key, maximum]) => (
          <ResourceHoverPreview key={key} resourceId={key} option={findResource(resourceOptions, key)}>
            <span className={`combat-resource combat-resource--${key}`}>
              {resourceLabel(key)}: {actor.runtime.resources[key] ?? 0}/{maximum}
            </span>
          </ResourceHoverPreview>
        ))}
      </div>
      <div className="combat-hotbar__actions">
        <button type="button" className={`combat-action combat-action--move${movementMode ? ' is-selected' : ''}`} disabled={disabled} onClick={onMove} title="Перемещение"><Footprints /><span>Движение</span><small>{state.movementRemainingFt[state.characterId] ?? 0} фт.</small></button>
        {actions.map((action) => {
          const availability = combatActionAvailability(state, action);
          const presentation = state.actionPresentation?.[action.id];
          const title = availability.enabled
            ? `${action.name} · ${actionCost(action)}`
            : `${action.name} · ${availability.reason}`;
          return (
            <HoverCard
              key={action.id}
              content={(
                <article className="combat-hover-card" role="tooltip">
                  <div className="combat-hover-card__head">
                    {presentation?.imageUrl && <img src={presentation.imageUrl} alt="" />}
                    <div><small>{action.kind === 'spell' ? 'Заклинание' : presentation?.sourceLabel ?? 'Действие'}</small><h3>{action.name}</h3></div>
                  </div>
                  {presentation?.description && <p>{presentation.description}</p>}
                  <dl><div><dt>Цена</dt><dd>{actionCost(action) || 'Свободно'}</dd></div><div><dt>Дальность</dt><dd>{rangeLabel(action)}</dd></div></dl>
                  {!availability.enabled && <strong>{availability.reason}</strong>}
                </article>
              )}
            >
              <button type="button" className={`combat-action${selectedActionId === action.id ? ' is-selected' : ''}`} disabled={disabled || !availability.enabled} onClick={() => onAction(action)} title={title} data-action-id={action.id}>
                <span className="combat-action__icon">
                  {presentation?.imageUrl
                    ? <img src={presentation.imageUrl} alt="" />
                    : action.mechanics.primitive ? <Swords /> : action.kind === 'spell' ? '✦' : action.name.slice(0, 1)}
                </span>
                <span>{actionLabel(action)}</span><small>{availability.enabled ? actionCost(action) || 'свободно' : 'Нет ресурса'}</small>
              </button>
            </HoverCard>
          );
        })}
        <button type="button" className="combat-action combat-action--more" onClick={onSheet}><MoreHorizontal /><span>Лист</span></button>
      </div>
      <button type="button" className="combat-end-turn" disabled={disabled} onClick={onEndTurn}>Завершить ход</button>
    </section>
  );
}
