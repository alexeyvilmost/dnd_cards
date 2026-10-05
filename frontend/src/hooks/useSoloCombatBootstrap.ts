import { useEffect } from 'react';
import { actionsApi, ApiRequestError, effectsApi } from '../api/client';
import { measureClientPhase } from '../api/performanceTelemetry';
import { charactersV3Api } from '../character/api';
import { checkManeuverChoice } from '../character/checkManeuvers';
import { loadSheetCombatParticipant } from '../character/sheetCombatTargetRuntime';
import type { ForgeCharacter } from '../character/types';
import { useChoiceDialog } from '../contexts/ChoiceDialogContext';
import { monstersApi } from '../monsters/api';
import type { RoguelikeRun } from '../roguelike/api';
import { roguelikeApi } from '../roguelike/api';
import { participantInitiativeOptions } from '../roguelike/initiativeOptions';
import { runCharacters, runEncounterSelection } from '../roguelike/navigation';
import {
  createSoloCombatState,
  refreshSoloCombatParticipants
} from '../solo-combat/engine';
import { readSoloCombatState } from '../solo-combat/persistence';
import { isIncompatibleCombatRulesError } from '../solo-combat/rulesUpgrade';
import {
  controlledCharacterIds,
  type SoloCombatState
} from '../solo-combat/types';

function combatBootstrapError(reason: unknown): string {
  if (reason instanceof ApiRequestError) {
    return reason.code ? `${reason.code}: ${reason.message}` : reason.message;
  }
  return reason instanceof Error ? reason.message : 'Не удалось начать бой';
}
interface SoloCombatBootstrapOptions {
  id: string | undefined;
  roguelikeRunId: string | null;
  navigate: import('react-router-dom').NavigateFunction;
  persist: (state: SoloCombatState) => Promise<void>;
  requestChoice: ReturnType<typeof useChoiceDialog>['request'];
  initialRequestedRef: import('react').MutableRefObject<Array<{id:string;quantity:number}>>;
  initialAlliesRef: import('react').MutableRefObject<string[]>;
  characterRef: import('react').MutableRefObject<ForgeCharacter | null>;
  trustedRunRef: import('react').MutableRefObject<RoguelikeRun | null>;
  participantCharactersRef: import('react').MutableRefObject<Record<string, ForgeCharacter>>;
  setCharacter: (character: ForgeCharacter | null) => void;
  setParticipantCharacters: (characters: Record<string, ForgeCharacter>) => void;
  setOpeningState: (state: SoloCombatState | null) => void;
  setState: (state: SoloCombatState | null) => void;
  setBusy: (busy: boolean) => void;
  setStaleRulesSnapshot: (stale: boolean) => void;
  setError: (message: string | null) => void;
}

/** Loads one route session using the existing canonical builders and saved artifacts. */
export function useSoloCombatBootstrap({id, roguelikeRunId, navigate, persist, requestChoice, initialRequestedRef, initialAlliesRef, characterRef, trustedRunRef, participantCharactersRef, setCharacter, setParticipantCharacters, setOpeningState, setState, setBusy, setStaleRulesSnapshot, setError}: SoloCombatBootstrapOptions) {
  useEffect(() => {
    if (!id) return;
    let active = true;
    setBusy(true); setError(null); setStaleRulesSnapshot(false);
    setState(null); setOpeningState(null); setCharacter(null); setParticipantCharacters({});
    characterRef.current = null; trustedRunRef.current = null; participantCharactersRef.current = {};
    (async () => {
      try {
        const [loadedCharacter, loadedRun] = await Promise.all([
          charactersV3Api.get(id),
          roguelikeRunId ? roguelikeApi.get(roguelikeRunId) : Promise.resolve(null),
        ]);
        if (loadedRun && loadedRun.character_id !== id) {
          throw new Error('Этот лист не участвует в активной встрече забега');
        }
        if (!active) return;
        if (loadedRun && loadedRun.phase !== 'combat') {
          navigate(`/roguelike/${loadedRun.id}`); return;
        }
        characterRef.current = loadedCharacter;
        setCharacter(loadedCharacter);
        participantCharactersRef.current = { [loadedCharacter.id]: loadedCharacter };
        setParticipantCharacters(participantCharactersRef.current);
        if (loadedRun?.combat_state || (loadedRun?.trusted_combat_available && !loadedCharacter.turn_state?.solo_combat_v1)) {
          let initiativeManeuverActionId: string | undefined;
          if (!loadedRun.combat_state) {
            const offer = await roguelikeApi.initiativeOptions(loadedRun.id, loadedRun.revision);
            if (!active) return;
            if (offer.enabled && (offer.run_revision !== loadedRun.revision || offer.character_id !== loadedCharacter.id
              || offer.runtime_revision !== loadedCharacter.runtime_revision)) throw Error('Состояние участника изменилось. Обновите страницу.');
            const options = offer.enabled ? offer.options
              : participantInitiativeOptions(await loadSheetCombatParticipant({character: loadedCharacter, cards: new Map()}));
            if (!active) return;
            if (options.length) {
              const selection = await measureClientPhase('initiative_player_choice', () => requestChoice([checkManeuverChoice(options, 'Инициатива')], 'Инициатива'));
              if (!active) return;
              if (!selection) { navigate(`/roguelike/${loadedRun.id}`); return; }
              const selectedId = selection.check_maneuver?.[0];
              if (selectedId !== 'none') {
                if (!options.some(action => action.id === selectedId)) throw Error('Выберите приём инициативы или обычный бросок.');
                initiativeManeuverActionId = selectedId;
              }
            }
          }
          const accepted = loadedRun.combat_state ? loadedRun
            : await roguelikeApi.command(loadedRun.id, loadedRun.revision, 'initialize_combat',
              initiativeManeuverActionId ? {initiative_maneuver_action_id: initiativeManeuverActionId} : {}).catch(async reason => {
              const current = await roguelikeApi.get(loadedRun.id);
              if (current.combat_state) return current;
              throw reason;
            });
          if (!active) return;
          if (!accepted.combat_state || !accepted.character) throw new Error('Сервер не вернул состояние боя');
          trustedRunRef.current = accepted;
          characterRef.current = accepted.character;
          setCharacter(accepted.character);
          participantCharactersRef.current = Object.fromEntries(runCharacters(accepted).map(c=>[c.id,c]));
          setParticipantCharacters(participantCharactersRef.current);
          if (!loadedRun.combat_state) setOpeningState(accepted.combat_opening_state ?? accepted.combat_state);
          setState(accepted.combat_state);
          setBusy(false);
          return;
        }
        const requested = loadedRun
          ? loadedCharacter.turn_state?.solo_combat_v1 ? [] : runEncounterSelection(loadedRun.encounter)
          : initialRequestedRef.current;
        const pinnedCatalog = loadedRun?.encounter.catalog;
        if (pinnedCatalog && pinnedCatalog.version !== 1) throw new Error('Версия сохранённого каталога встречи не поддерживается');
        if (!requested.length) {
          const restored = readSoloCombatState(
            loadedCharacter.turn_state, id, Number(loadedCharacter.runtime_revision ?? 0),
          );
          if (!restored) throw new Error('Сохранённый бой не найден. Запустите проверку из листа персонажа.');
          const allyIds = controlledCharacterIds(restored).filter((actorId) => actorId !== loadedCharacter.id);
          const [allyRows, basicResponse] = await Promise.all([
            Promise.all(allyIds.map((allyId) => charactersV3Api.get(allyId))),
            actionsApi.getActions({ type: 'basic', limit: 100 }),
          ]);
          if (!active) return;
          const loadedRows = [loadedCharacter, ...allyRows];
          participantCharactersRef.current = Object.fromEntries(
            loadedRows.map((row) => [row.id, row]),
          );
          setParticipantCharacters(participantCharactersRef.current);
          const participants = await Promise.all(loadedRows.map((row) => (
            loadSheetCombatParticipant({
              character: row,
              basicActions: basicResponse.actions,
              cards: new Map(),
            })
          )));
          const refreshed = await refreshSoloCombatParticipants({ state: restored, participants });
          if (!active) return;
          setState(refreshed);
          setBusy(false); return;
        }
        const [monsters, allyCharacters] = await Promise.all([
          pinnedCatalog ? Promise.resolve(pinnedCatalog.monsters)
            : Promise.all(requested.map(({ id: monsterId }) => monstersApi.get(monsterId))),
          Promise.all((loadedRun ? [] : initialAlliesRef.current).map((allyId) => charactersV3Api.get(allyId))),
        ]);
        if (allyCharacters.some((ally) => ally.user_id !== loadedCharacter.user_id)) {
          throw new Error('Союзник должен принадлежать тому же пользователю');
        }
        const actionIds = [...new Set(monsters.flatMap((monster) => monster.action_ids))];
        const effectIds = [...new Set(monsters.flatMap((monster) => monster.effect_ids))];
        const [actionRows, effectRows, basicResponse] = await Promise.all([
          pinnedCatalog ? Promise.resolve(pinnedCatalog.actions)
            : Promise.all(actionIds.map((actionId) => actionsApi.getAction(actionId))),
          pinnedCatalog ? Promise.resolve(pinnedCatalog.effects)
            : Promise.all(effectIds.map((effectId) => effectsApi.getEffect(effectId))),
          actionsApi.getActions({ type: 'basic', limit: 100 }),
        ]);
        const basicActions = basicResponse.actions;
        const allActions = [...new Map([...actionRows, ...basicActions].map((action) => [action.id, action])).values()];
        const participants = await Promise.all([loadedCharacter, ...allyCharacters].map((row) => (
          loadSheetCombatParticipant({ character: row, basicActions, cards: new Map() })
        )));
        const participant = participants[0];
        const selected = requested.map(({ id: monsterId, quantity }) => ({
          monster: monsters.find((monster) => monster.id === monsterId)!, quantity,
        }));
        const created = await createSoloCombatState({
          character: loadedCharacter, participant, allies: participants.slice(1), selected,
          actions: allActions, effects: effectRows,
          dashAction: basicActions.find((action) => action.card_number === 'action_basic_dash'),
        });
        if (!active) return;
        participantCharactersRef.current = Object.fromEntries(
          [loadedCharacter, ...allyCharacters].map((row) => [row.id, row]),
        );
        setParticipantCharacters(participantCharactersRef.current);
        setOpeningState(created);
        setState(created);
        await persist(created);
        if (!active) return;
        initialRequestedRef.current = [];
        initialAlliesRef.current = [];
        navigate(
          `/characters-v3/${id}/combat${roguelikeRunId ? `?roguelike=${encodeURIComponent(roguelikeRunId)}` : ''}`,
          { replace: true },
        );
      } catch (reason) {
        if (active) {
          setStaleRulesSnapshot(isIncompatibleCombatRulesError(reason));
          setError(combatBootstrapError(reason)); setBusy(false);
        }
      }
    })();
    return () => { active = false; };
  }, [id, navigate, persist, roguelikeRunId, requestChoice]);

}
