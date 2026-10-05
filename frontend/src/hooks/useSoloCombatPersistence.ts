import type { MutableRefObject } from 'react';
import { useCallback, useEffect, useRef } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { charactersV3Api } from '../character/api';
import { runtimeInventoryPayload, writeRulesEngineRuntimeTurnState } from '../character/runtime';
import { newSheetRuntimeCommandId } from '../character/sheetCombatSession';
import type { ForgeCharacter } from '../character/types';
import { finalizeCombatOutcome } from '../solo-combat/engine';
import { clearIncompatibleCombatSnapshot } from '../solo-combat/rulesUpgrade';
import { writeDedicatedCombatTurnState } from '../solo-combat/turnState';
import { controlledCharacterIds, type SoloCombatState } from '../solo-combat/types';

interface SoloCombatPersistenceOptions {
  id: string | undefined;
  roguelikeRunId: string | null;
  characterRef: MutableRefObject<ForgeCharacter | null>;
  participantCharactersRef: MutableRefObject<Record<string, ForgeCharacter>>;
  setCharacter: (character: ForgeCharacter | null) => void;
  setParticipantCharacters: (characters: Record<string, ForgeCharacter>) => void;
  setState: (state: SoloCombatState | null) => void;
  setBusy: (busy: boolean) => void;
  setError: (message: string | null) => void;
  navigate: NavigateFunction;
}

/** Owns legacy local saves; canonical serialization, revisions and command IDs stay unchanged. */
export function useSoloCombatPersistence({id, roguelikeRunId, characterRef, participantCharactersRef, setCharacter, setParticipantCharacters, setState, setBusy, setError, navigate}: SoloCombatPersistenceOptions) {
  const sessionKey = `${id ?? ''}:${roguelikeRunId ?? ''}`;
  const sessionRef = useRef({key: sessionKey, active: true});
  if (sessionRef.current.key !== sessionKey) sessionRef.current = {key: sessionKey, active: true};
  const session = sessionRef.current;
  const ownsSession = useCallback(() => sessionRef.current === session && session.active, [session]);
  useEffect(() => {
    session.active = true;
    return () => { session.active = false; };
  }, [session]);
  const persist = useCallback(async (next: SoloCombatState) => {
    if (!ownsSession()) return;
    next = finalizeCombatOutcome(next);
    const currentCharacter = characterRef.current;
    if (!currentCharacter || !id) throw new Error('Лист персонажа не загружен');
    setBusy(true);
    const actor = next.world.actors[id];
    const participantIds = controlledCharacterIds(next).sort();
    if (participantIds.length > 1) {
      const rows = participantCharactersRef.current;
      const expectedRevisions = Object.fromEntries(participantIds.map((actorId) => {
        const row = rows[actorId];
        if (!row) throw new Error(`Лист участника ${actorId} не загружен`);
        return [actorId, Number(next.participantRuntimeRevisions?.[actorId] ?? row.runtime_revision ?? 0)];
      }));
      const nextRevisions = Object.fromEntries(participantIds.map((actorId) => [
        actorId,
        expectedRevisions[actorId] + 1,
      ]));
      const predicted = {
        ...next,
        runtimeRevision: nextRevisions[id],
        participantRuntimeRevisions: nextRevisions,
      };
      try {
        const ruleset = next.world.ruleset;
        const response = await charactersV3Api.postRuntimeCommand({
          command_id: newSheetRuntimeCommandId(),
			roguelike_run_id: roguelikeRunId ?? undefined,
          ruleset_ref: {
            system_id: ruleset.systemId,
            release_id: ruleset.releaseId,
            content_hash: ruleset.contentHash,
            errata_version: ruleset.errataVersion,
          },
          participants: participantIds.map((actorId) => {
            const row = rows[actorId];
            const participantActor = next.world.actors[actorId];
            return {
              character_id: actorId,
              expected_runtime_revision: expectedRevisions[actorId],
              patch: {
                current_hp: participantActor.runtime.hp.current,
                resources: participantActor.runtime.resources,
                max_resources: participantActor.runtime.maxResources,
                active_effects: participantActor.runtime.activeEffects,
                inventory_items: runtimeInventoryPayload(participantActor.runtime),
                turn_state: actorId === id
                  ? writeDedicatedCombatTurnState(row.turn_state, participantActor.runtime, predicted)
                  : writeRulesEngineRuntimeTurnState(row.turn_state, participantActor.runtime),
              },
            };
          }),
          events: [],
        });
        if (!ownsSession()) return;
        const acceptedRows = Object.fromEntries(response.participants.map((entry) => [
          entry.character_id,
          entry.character,
        ]));
        const acceptedRevisions = Object.fromEntries(response.participants.map((entry) => [
          entry.character_id,
          Number(entry.runtime_revision),
        ]));
        const accepted = {
          ...predicted,
          runtimeRevision: acceptedRevisions[id] ?? predicted.runtimeRevision,
          participantRuntimeRevisions: { ...nextRevisions, ...acceptedRevisions },
        };
        const mergedRows = { ...rows, ...acceptedRows };
        participantCharactersRef.current = mergedRows;
        setParticipantCharacters(mergedRows);
        characterRef.current = mergedRows[id];
        setCharacter(mergedRows[id]);
        setState(accepted);
      } finally {
        if (ownsSession()) setBusy(false);
      }
      return;
    }
    const nextRevision = next.runtimeRevision + 1;
    const predicted = {
      ...next,
      runtimeRevision: nextRevision,
      participantRuntimeRevisions: {
        ...(next.participantRuntimeRevisions ?? {}),
        [id]: nextRevision,
      },
    };
    const turnState = writeDedicatedCombatTurnState(
      currentCharacter.turn_state,
      actor.runtime,
      predicted,
    );
    try {
		const saved = await charactersV3Api.patchRuntime(id, {
        expected_runtime_revision: next.runtimeRevision,
        current_hp: actor.runtime.hp.current,
        resources: actor.runtime.resources,
        max_resources: actor.runtime.maxResources,
        active_effects: actor.runtime.activeEffects,
        inventory_items: runtimeInventoryPayload(actor.runtime),
        turn_state: turnState,
		}, roguelikeRunId ? { runId: roguelikeRunId, intent: 'combat' } : undefined);
      if (!ownsSession()) return;
      const acceptedRevision = Number(saved.runtime_revision ?? predicted.runtimeRevision);
      const accepted = {
        ...predicted,
        runtimeRevision: acceptedRevision,
        participantRuntimeRevisions: {
          ...(predicted.participantRuntimeRevisions ?? {}),
          [id]: acceptedRevision,
        },
      };
      characterRef.current = saved;
      setCharacter(saved);
      const mergedRows = { ...participantCharactersRef.current, [saved.id]: saved };
      participantCharactersRef.current = mergedRows;
      setParticipantCharacters(mergedRows);
      setState(accepted);
    } finally {
      if (ownsSession()) setBusy(false);
    }
	}, [id, roguelikeRunId, ownsSession]);

  const resetStaleCombat = useCallback(async () => {
    if (!ownsSession()) return;
    const current = characterRef.current;
    if (!current || !id) return;
    setBusy(true);
    try {
      const saved = await charactersV3Api.patchRuntime(id, {
        expected_runtime_revision: Number(current.runtime_revision ?? 0),
        turn_state: clearIncompatibleCombatSnapshot(current.turn_state),
	  }, roguelikeRunId ? { runId: roguelikeRunId, intent: 'combat' } : undefined);
      if (!ownsSession()) return;
      characterRef.current = saved;
      setCharacter(saved);
      navigate(`/characters-v3/${id}`);
    } catch (reason) {
      if (!ownsSession()) return;
      setError(reason instanceof Error ? reason.message : 'Не удалось сбросить устаревший бой');
      setBusy(false);
    }
	}, [id, navigate, roguelikeRunId, ownsSession]);

  const apply = useCallback((next: SoloCombatState) => {
    if (!ownsSession()) return;
    setError(null);
    void persist(next).catch((reason) => {
      if (ownsSession()) setError(reason instanceof Error ? reason.message : 'Не удалось сохранить ход');
    });
  }, [persist, ownsSession]);

  return {persist, apply, resetStaleCombat};
}
