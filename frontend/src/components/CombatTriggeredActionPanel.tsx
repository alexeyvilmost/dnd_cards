import type {SoloCombatState} from '../solo-combat/types';
import SheetActionLine from './SheetActionLine';

/** The combat choice uses the same visual action rows as the character sheet. */
export default function CombatTriggeredActionPanel({state, busy, onChoose}: {
  state: SoloCombatState; busy: boolean; onChoose: (actionId: string | null) => void;
}) {
  const pending = state.pendingTriggeredAction;
  if (!pending) return null;
  const actor = state.world.actors[pending.sourceActorId];
  const entry = pending.event === 'reach_entry'
    || (pending.event === 'opportunity_attack' && Boolean(state.pendingReachEntry));
  const title = pending.event === 'commanded_attack' ? 'Совершить атаку по команде союзника?' : pending.event === 'enemy_melee_miss' ? 'Противник промахнулся — совершить Ответный удар?' : entry ? 'Выполнить Превентивный удар?'
    : pending.event === 'opportunity_attack' ? 'Совершить провоцированную атаку?'
      : pending.event === 'sneak_attack_hit' ? 'Применить Хитрый удар и отказаться от 1к6 урона?'
        : 'Применить дополнительную способность?';
  return <div className="combat-reaction-backdrop"><section aria-label={`${actor.name}: ${title}`}>
    <p>{actor.name}</p>
    <h2>{title}</h2>
    {pending.sneakAttackTradeoff && <p>
      Из броска урона исключается: {pending.sneakAttackTradeoff.dieResults.join(' + ')}
      {pending.sneakAttackTradeoff.dieResults.length > 1 ? ' (критическое удвоение)' : ''}.
      {' '}Фактический урон уменьшится на {pending.sneakAttackTradeoff.effectiveDamage}.
    </p>}
    <div className="combat-reaction-actions">
      {pending.optionActionIds.map(actionId => {
        const action = state.catalogActions.find(row => row.id === actionId);
        if (!action) return null;
        const presentation = state.actionPresentation?.[actionId];
        const card = [...(actor.character.equippedCards ?? []), ...(actor.character.knownCards ?? [])]
          .find(row => action.sourceEntityIds.includes(row.id));
        const unarmed = actionId.includes(':melee-reaction:unarmed:')
          ? Object.values(state.actionPresentation ?? {}).find(row => row.actionRef?.card_number === 'action_basic_unarmed')
          : undefined;
        const name = action.name.replace(/ — провоцированная атака/gu, '').replace(/ — Превентивный удар$/u, '');
        return <SheetActionLine key={actionId} name={name}
          imageUrl={presentation?.imageUrl ?? card?.image_url ?? unarmed?.imageUrl}
          description={presentation?.description ?? card?.description ?? unarmed?.description}
          sourceLabel={actor.name}
          actionRef={presentation?.actionRef ?? unarmed?.actionRef}
          spellRef={presentation?.spellRef}
          level={action.kind === 'spell' ? action.spell.level : undefined}
          disabled={busy} onActivate={() => onChoose(actionId)} />;
      })}
    </div>
    <button type="button" disabled={busy} onClick={() => onChoose(null)}>Пропустить</button>
  </section></div>;
}
