import {emptyDeathSaves} from '../engine/deathSaves';
import {combatRollInfluences} from '../solo-combat/engine';
import {decisionOfferVisible, decisionPolicyToggles, offeredRollInfluences} from '../solo-combat/decisionPolicies';
import {useAutomaticCombatDecision} from '../solo-combat/useAutomaticCombatDecision';
import type {SoloCombatState} from '../solo-combat/types';
import {combatActorDisplayName} from '../character/familiarLabels';
import CombatPresentationDialog from './CombatPresentationDialog';

/** A held death save uses the same offer policies and authoritative continuation
 * as other rolls. The confirmed dialog is shown only after the saved command
 * returns; neither its counters nor its die are guessed by this component. */
export default function CombatDeathSaveDialog({state, busy, blocked, error, preferences, onResolve}: {
  state: SoloCombatState;
  busy: boolean;
  blocked: boolean;
  error: boolean;
  preferences: Readonly<Record<string, boolean>>;
  onResolve: (effectId?: string) => void;
}) {
  const death = state.pendingDeathSave;
  const actor = death && state.world.actors[death.actorId];
  const policies = decisionPolicyToggles('roll_influence');
  const influences = death?.phase === 'rolled' && actor
    ? offeredRollInfluences(combatRollInfluences(state, actor.id, 'save', death.roll),
      policies, preferences, 'save') : [];
  const offerVisible = decisionOfferVisible(policies, preferences, {roll: death?.roll});
  const autoConfirm = death?.phase === 'rolled' && (!offerVisible || influences.length === 0);
  useAutomaticCombatDecision(state, autoConfirm ? 'death_save' : null,
    busy || blocked || error, () => onResolve());
  if (!death || !actor || blocked || (autoConfirm && !error)) return null;
  const provisional = death.phase === 'rolled';
  return <CombatPresentationDialog modeOverride="standard" busy={busy} provisional={provisional}
    beat={{id: `death:${actor.id}:${death.round}`, sourceId: actor.id,
      sourceName: combatActorDisplayName(actor), audience: 'own', actionName: 'Спасбросок от смерти',
      rollKind: 'save', roll: death.roll, cues: [],
      deathSave: provisional ? death.before : actor.runtime.deathSaves ?? emptyDeathSaves()}}
    influences={offerVisible ? influences : []}
    onInfluence={provisional ? onResolve : undefined} onClose={() => onResolve()}/>;
}
