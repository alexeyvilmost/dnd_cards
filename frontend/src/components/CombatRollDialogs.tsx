import CombatDeathSaveDialog from '../components/CombatDeathSaveDialog';
import CombatPresentationDialog from '../components/CombatPresentationDialog';
import { useCombatCommandDispatch } from '../hooks/useCombatCommandDispatch';
import { offeredRollInfluences } from '../solo-combat/decisionPolicies';
import { resolveCombatDeathSave, resolveD20Interrupt } from '../solo-combat/engine';
import { persistedRollPresentation } from '../solo-combat/persistedRollPresentation';
import {
  type SoloCombatState
} from '../solo-combat/types';
import { useCombatPresentation } from '../solo-combat/useCombatPresentation';

interface CombatRollDialogsProps {
  state: SoloCombatState;
  busy: boolean;
  error: string | null;
  presentation: ReturnType<typeof useCombatPresentation>;
  heldDecision: ReturnType<typeof persistedRollPresentation>;
  influenceOfferVisible: boolean;
  offeredHeldInfluences: ReturnType<typeof offeredRollInfluences>;
  combatPassiveEnabled: Record<string, boolean>;
  applyIntent: ReturnType<typeof useCombatCommandDispatch>;
}

/** Presents the saved provisional/confirmed roll through canonical dialog components. */
export default function CombatRollDialogs({state, busy, error, presentation, heldDecision, influenceOfferVisible, offeredHeldInfluences, combatPassiveEnabled, applyIntent}: CombatRollDialogsProps) {
  const heldForDisplay = (influenceOfferVisible && offeredHeldInfluences.length>0) || error
    ? heldDecision : undefined;
  return <>
      {presentation.initiative && <CombatPresentationDialog initiative={presentation.initiative} onClose={presentation.closeInitiative} />}
      <CombatDeathSaveDialog state={state} busy={busy} blocked={presentation.blocked} error={Boolean(error)}
        preferences={combatPassiveEnabled}
        onResolve={effectId => {
          const death = state.pendingDeathSave;
          if (death) applyIntent({type:'death_save',actorId:death.actorId,phase:death.phase,effectId},
            () => resolveCombatDeathSave(state,effectId));
        }}/>
      {(heldForDisplay?.held || presentation.beat) && <CombatPresentationDialog
        modeOverride={heldForDisplay?.held ? 'standard' : undefined}
        beat={heldForDisplay?.held ? {id: 'roll-influence-pending', sourceId: heldForDisplay.command.actorId,
          sourceName: state.world.actors[heldForDisplay.command.actorId]?.name ?? '',
          targetName: heldForDisplay.held.targetId
            ? state.world.actors[heldForDisplay.held.targetId]?.name
            : heldForDisplay.command.targetIds.map(id => state.world.actors[id]?.name).filter(Boolean).join(', '),
          actionName: `${state.catalogActions.find(action => action.id === heldForDisplay.command.actionId)?.name ?? 'Бросок к20'}${heldForDisplay.held.targetSlotIndex!==undefined?` · атака ${heldForDisplay.held.targetSlotIndex} из ${heldForDisplay.held.targetSlotCount}`:''}`,
          rollKind: heldForDisplay.held.kind, roll: heldForDisplay.held.roll, cues: []} : presentation.beat}
        onClose={heldForDisplay?.held ? () => applyIntent({type: 'd20_interrupt', actorId: null}, () => resolveD20Interrupt(state, null)) : presentation.closeAttack}
        busy={busy} provisional={Boolean(heldForDisplay?.held)}
        influences={heldForDisplay?.held ? offeredHeldInfluences : []}
        onInfluence={heldForDisplay?.held ? effectId => {const owner=heldForDisplay.responders.find(row=>row.effectId===effectId)?.actorId; if(owner) applyIntent({type: 'd20_interrupt', actorId: owner, effectId}, () => resolveD20Interrupt(state, owner, Math.random, effectId));} : undefined}
      />}
  </>;
}
