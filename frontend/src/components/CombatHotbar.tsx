import { Footprints, MoreHorizontal, Swords } from 'lucide-react';
import type { RuleActionDefinition } from '../rules-core/domain';
import type { SoloCombatState } from '../solo-combat/types';

function actionCost(action: RuleActionDefinition): string {
  const activation = action.mechanics.activation as Record<string, unknown> | undefined;
  const costs = Array.isArray(activation?.cost) ? activation.cost as Array<Record<string, unknown>> : [];
  return costs.map((cost) => String(cost.resource ?? '')).filter(Boolean).join(' + ');
}

function actionLabel(action: RuleActionDefinition): string {
  const primitive = action.mechanics.primitive as Record<string, unknown> | undefined;
  return primitive?.type === 'weapon_attack' ? 'Атака' : action.name;
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
  const actor = state.world.actors[state.characterId];
  const actions = state.playerActionIds.flatMap((id) => {
    const action = state.catalogActions.find((candidate) => candidate.id === id);
    return action ? [action] : [];
  });
  const resources = Object.entries(actor.runtime.resources).filter(([key, value]) => (
    value > 0 && (['action', 'bonus_action', 'reaction'].includes(key) || key.startsWith('spell_slot_'))
  ));
  return (
    <section className="combat-hotbar" aria-label="Панель действий">
      <div className="combat-hotbar__resources">
        <span className="combat-hotbar__portrait">{actor.name.slice(0, 1)}</span>
        <div><b>{actor.name}</b><span>HP {actor.runtime.hp.current}/{actor.runtime.hp.max}</span></div>
        {resources.map(([key, value]) => <span key={key} className={`combat-resource combat-resource--${key}`}>{key.replace('spell_slot_', 'Яч. ')}: {value}</span>)}
      </div>
      <div className="combat-hotbar__actions">
        <button type="button" className={`combat-action combat-action--move${movementMode ? ' is-selected' : ''}`} disabled={disabled} onClick={onMove} title="Перемещение"><Footprints /><span>Движение</span><small>{state.movementRemainingFt[state.characterId] ?? 0} фт.</small></button>
        {actions.map((action) => (
          <button type="button" key={action.id} className={`combat-action${selectedActionId === action.id ? ' is-selected' : ''}`} disabled={disabled} onClick={() => onAction(action)} title={`${action.name} · ${actionCost(action)}`} data-action-id={action.id}>
            <span className="combat-action__icon">{action.mechanics.primitive ? <Swords /> : action.kind === 'spell' ? '✦' : action.name.slice(0, 1)}</span>
            <span>{actionLabel(action)}</span><small>{actionCost(action) || 'свободно'}</small>
          </button>
        ))}
        <button type="button" className="combat-action combat-action--more" onClick={onSheet}><MoreHorizontal /><span>Лист</span></button>
      </div>
      <button type="button" className="combat-end-turn" disabled={disabled} onClick={onEndTurn}>Завершить ход</button>
    </section>
  );
}
