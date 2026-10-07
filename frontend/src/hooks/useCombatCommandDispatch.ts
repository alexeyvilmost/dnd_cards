import {useCallback, useEffect, useRef, type RefObject} from 'react';
import {playerFacingSheetActionError} from '../character/sheetActionError';
import {roguelikeApi, type RoguelikeRun} from '../roguelike/api';
import {commandCombatInteraction} from '../roguelike/combatInteraction';
import {commandCombatRulesUpgrade} from '../roguelike/combatRulesUpgrade';
import type {RoguelikeCombatIntent} from '../roguelike/combatWorker';
import {resumePendingMovement} from '../solo-combat/engine';
import type {SoloCombatState} from '../solo-combat/types';

interface CombatCommandDispatchOptions {
  sessionKey: string;
  runRef: RefObject<RoguelikeRun | null>;
  presentationBlockedRef: RefObject<boolean>;
  applyLocal: (state: SoloCombatState) => void;
  onAccepted: (run: RoguelikeRun) => void;
  setBusy: (busy: boolean) => void;
  setError: (message: string | null) => void;
}

/** Owns request lifecycle only. Intent execution, durable command IDs and
 * compatibility with pinned artifacts remain in the canonical engine/transport. */
export function useCombatCommandDispatch({sessionKey, runRef, presentationBlockedRef, applyLocal, onAccepted, setBusy, setError}: CombatCommandDispatchOptions) {
  const sessionRef = useRef({key: sessionKey, active: true, inFlight: false});
  if (sessionRef.current.key !== sessionKey) sessionRef.current = {key: sessionKey, active: true, inFlight: false};
  const session = sessionRef.current;
  useEffect(() => {
    session.active = true;
    return () => { session.active = false; };
  }, [session]);
  const dispatch = useCallback((intent: RoguelikeCombatIntent, local: () => SoloCombatState) => {
    if (!session.active || sessionRef.current !== session) return;
    // Held-roll dialogs own their continuation even while cosmetic feedback is
    // playing. The authoritative engine still validates the pending decision.
    if (presentationBlockedRef.current && intent.type !== 'd20_interrupt' && intent.type !== 'death_save') return;
    const run = runRef.current;
    if (!run) {
      try { applyLocal(resumePendingMovement(local())); }
      catch (reason) { setError(playerFacingSheetActionError(reason)); }
      return;
    }
    if (session.inFlight) return;
    session.inFlight = true;
    const isCurrent = () => session.active && sessionRef.current === session && runRef.current?.id === run.id;
    setBusy(true); setError(null);
    void commandCombatInteraction(run, intent, (current, command) =>
      roguelikeApi.command(current.id, current.revision, 'combat_intent', {intent: command})).then(accepted => {
      if (isCurrent()) onAccepted(accepted);
    }).catch(async reason => {
      if (!isCurrent()) return;
      // A response may be lost after commit. Reconcile before unlocking another
      // click; never invent a retry or advance a partially accepted interaction.
      try {
        const current = await roguelikeApi.get(run.id);
        if (isCurrent() && current.combat_state && current.character) onAccepted(current);
      } catch { /* Keep confirmed state; revision checks prevent overwrite. */ }
      if (isCurrent()) setError(playerFacingSheetActionError(reason));
    }).finally(() => {
      session.inFlight = false;
      if (isCurrent()) setBusy(false);
    });
  }, [session, runRef, presentationBlockedRef, applyLocal, onAccepted, setBusy, setError]);
  const upgrade = useCallback(async () => {
    const run = runRef.current;
    if (!run || !session.active || sessionRef.current !== session || session.inFlight) return;
    session.inFlight = true;
    const isCurrent = () => session.active && sessionRef.current === session && runRef.current?.id === run.id;
    setBusy(true);
    try {
      const accepted = await commandCombatRulesUpgrade(run);
      if (isCurrent()) { onAccepted(accepted); setError(null); }
    } catch (reason) {
      if (!isCurrent()) return;
      try {
        const current = await roguelikeApi.get(run.id);
        if (isCurrent() && current.combat_state && current.character) onAccepted(current);
      } catch { /* Retain confirmed state and the durable command ID. */ }
      if (isCurrent()) setError(playerFacingSheetActionError(reason));
    } finally {
      session.inFlight = false;
      if (isCurrent()) setBusy(false);
    }
  }, [session, runRef, onAccepted, setBusy, setError]);
  return Object.assign(dispatch, {upgrade});
}
