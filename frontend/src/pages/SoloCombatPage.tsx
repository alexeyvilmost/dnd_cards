import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, RotateCcw, X } from 'lucide-react';
import { actionsApi, effectsApi } from '../api/client';
import { charactersV3Api } from '../character/api';
import { loadSheetCombatParticipant } from '../character/sheetCombatTargetRuntime';
import { writeRulesEngineRuntimeTurnState } from '../character/runtime';
import type { ForgeCharacter } from '../character/types';
import CombatHotbar from '../components/CombatHotbar';
import MonsterTurnController from '../components/MonsterTurnController';
import TacticalBattleMap from '../components/TacticalBattleMap';
import { monstersApi } from '../monsters/api';
import {
  activeActor,
  advanceTurn,
  autoResolveSystemDecisions,
  createSoloCombatState,
  executeCombatAction,
  moveActor,
  resolvePlayerReaction,
  selectedTargetsForAction,
} from '../solo-combat/engine';
import { readSoloCombatState, writeSoloCombatState } from '../solo-combat/persistence';
import type { GridPosition, SoloCombatState } from '../solo-combat/types';
import { getCardsIndex } from '../utils/cardsIndex';
import './SoloCombatPage.css';

function querySelection(params: URLSearchParams): Array<{ id: string; quantity: number }> {
  return [...params.entries()].flatMap(([id, raw]) => {
    const quantity = Number(raw);
    return /^[0-9a-f-]{36}$/i.test(id) && Number.isInteger(quantity) && quantity > 0
      ? [{ id, quantity: Math.min(quantity, 6) }]
      : [];
  });
}

function initiativeLabel(entry: SoloCombatState['initiative'][number]): string {
  return `${entry.die}${entry.bonus >= 0 ? '+' : ''}${entry.bonus} = ${entry.total}`;
}

export default function SoloCombatPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [character, setCharacter] = useState<ForgeCharacter | null>(null);
  const characterRef = useRef<ForgeCharacter | null>(null);
  const [state, setState] = useState<SoloCombatState | null>(null);
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);
  const [movementMode, setMovementMode] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  characterRef.current = character;
  // The setup query is consumed exactly once. Removing it from the URL after
  // creation must not start a second initialization against the persisted fight.
  const initialRequestedRef = useRef(querySelection(searchParams));

  const persist = useCallback(async (next: SoloCombatState) => {
    const currentCharacter = characterRef.current;
    if (!currentCharacter || !id) throw new Error('Лист персонажа не загружен');
    setBusy(true);
    const actor = next.world.actors[id];
    const predicted = { ...next, runtimeRevision: next.runtimeRevision + 1 };
    const baseTurnState = writeRulesEngineRuntimeTurnState(currentCharacter.turn_state, actor.runtime);
    const turnState = writeSoloCombatState(baseTurnState, predicted);
    try {
      const saved = await charactersV3Api.patchRuntime(id, {
        expected_runtime_revision: next.runtimeRevision,
        current_hp: actor.runtime.hp.current,
        resources: actor.runtime.resources,
        max_resources: actor.runtime.maxResources,
        active_effects: actor.runtime.activeEffects,
        turn_state: turnState,
      });
      const accepted = { ...predicted, runtimeRevision: Number(saved.runtime_revision ?? predicted.runtimeRevision) };
      characterRef.current = saved;
      setCharacter(saved);
      setState(accepted);
    } finally {
      setBusy(false);
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let active = true;
    (async () => {
      try {
        const loadedCharacter = await charactersV3Api.get(id);
        if (!active) return;
        characterRef.current = loadedCharacter;
        setCharacter(loadedCharacter);
        const requested = initialRequestedRef.current;
        if (!requested.length) {
          const restored = readSoloCombatState(
            loadedCharacter.turn_state, id, Number(loadedCharacter.runtime_revision ?? 0),
          );
          if (!restored) throw new Error('Сохранённый бой не найден. Запустите проверку из листа персонажа.');
          setState(restored); setBusy(false); return;
        }
        const monsters = await Promise.all(requested.map(({ id: monsterId }) => monstersApi.get(monsterId)));
        const actionIds = [...new Set(monsters.flatMap((monster) => monster.action_ids))];
        const effectIds = [...new Set(monsters.flatMap((monster) => monster.effect_ids))];
        const [actionRows, effectRows, basicResponse, cards] = await Promise.all([
          Promise.all(actionIds.map((actionId) => actionsApi.getAction(actionId))),
          Promise.all(effectIds.map((effectId) => effectsApi.getEffect(effectId))),
          actionsApi.getActions({ type: 'basic', limit: 100 }),
          getCardsIndex(),
        ]);
        const basicActions = basicResponse.actions;
        const allActions = [...new Map([...actionRows, ...basicActions].map((action) => [action.id, action])).values()];
        const participant = await loadSheetCombatParticipant({
          character: loadedCharacter, basicActions, cards,
        });
        const selected = requested.map(({ id: monsterId, quantity }) => ({
          monster: monsters.find((monster) => monster.id === monsterId)!, quantity,
        }));
        const created = await createSoloCombatState({
          character: loadedCharacter, participant, selected,
          actions: allActions, effects: effectRows,
          dashAction: basicActions.find((action) => action.card_number === 'action_basic_dash'),
        });
        if (!active) return;
        setState(created);
        await persist(created);
        navigate(`/characters-v3/${id}/combat`, { replace: true });
      } catch (reason) {
        if (active) { setError(reason instanceof Error ? reason.message : 'Не удалось начать бой'); setBusy(false); }
      }
    })();
    return () => { active = false; };
  }, [id, navigate, persist]);

  const apply = useCallback((next: SoloCombatState) => {
    setError(null);
    void persist(next).catch((reason) => setError(reason instanceof Error ? reason.message : 'Не удалось сохранить ход'));
  }, [persist]);

  const playerTurn = state ? activeActor(state).id === state.characterId : false;
  const chooseAction = (action: SoloCombatState['catalogActions'][number]) => {
    if (!state || !playerTurn || busy) return;
    const targeting = action.mechanics.targeting as Record<string, unknown> | undefined;
    if (targeting?.shape === 'self') {
      try { apply(autoResolveSystemDecisions(executeCombatAction({ state, actorId: state.characterId, actionId: action.id, targetIds: [state.characterId] }))); }
      catch (reason) { setError(reason instanceof Error ? reason.message : 'Действие не выполнено'); }
      return;
    }
    setMovementMode(false);
    setSelectedActionId((current) => current === action.id ? null : action.id);
  };

  const clickCell = (position: GridPosition, actorId?: string) => {
    if (!state || !playerTurn || busy || state.world.pendingResolution) return;
    try {
      if (movementMode) {
        if (actorId) throw new Error('Для перемещения выберите свободную клетку');
        const next = moveActor({ state, actorId: state.characterId, destination: position, voluntary: true });
        setMovementMode(false); apply(next); return;
      }
      if (!selectedActionId) return;
      const targetIds = selectedTargetsForAction({ state, actionId: selectedActionId, clickedActorId: actorId, clickedPosition: position });
      const action = state.catalogActions.find((candidate) => candidate.id === selectedActionId)!;
      if (!targetIds.length && (action.targeting?.minTargets ?? 0) > 0) throw new Error('В выбранной области нет допустимой цели');
      const next = autoResolveSystemDecisions(executeCombatAction({ state, actorId: state.characterId, actionId: selectedActionId, targetIds }));
      setSelectedActionId(null); apply(next);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Действие не выполнено'); }
  };

  const finish = async () => {
    const currentCharacter = characterRef.current;
    if (!currentCharacter || !state || !id) return;
    setBusy(true);
    try {
      const actor = state.world.actors[id];
      const runtimeTurnState = writeRulesEngineRuntimeTurnState(currentCharacter.turn_state, actor.runtime);
      const saved = await charactersV3Api.patchRuntime(id, {
        expected_runtime_revision: state.runtimeRevision,
        current_hp: actor.runtime.hp.current,
        resources: actor.runtime.resources,
        max_resources: actor.runtime.maxResources,
        active_effects: actor.runtime.activeEffects,
        turn_state: writeSoloCombatState(runtimeTurnState, null),
      });
      characterRef.current = saved;
      navigate(`/characters-v3/${id}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось завершить бой'); setBusy(false); }
  };

  if (!state || !character) {
    return <main className="solo-combat-loading"><h1>Подготовка поля боя</h1><p>{error ?? 'Компилируем лист, монстров и инициативу…'}</p>{error && <Link to={`/characters-v3/${id}`}>Вернуться в лист</Link>}</main>;
  }
  const actor = activeActor(state);
  const pending = state.world.pendingResolution;
  const reactionOptions = pending?.request.type === 'reaction' && pending.request.actorId === state.characterId
    ? pending.request.options : [];
  const reactionTitle = pending?.request.type === 'reaction'
    && pending.request.trigger.type === 'hit_by_attack'
    ? 'По вам попали'
    : 'Открыто окно реакции';
  return (
    <main className="solo-combat-page">
      <MonsterTurnController state={state} disabled={busy} onTransition={apply} onError={setError} />
      <header className="combat-topbar">
        <Link to={`/characters-v3/${id}`}><ArrowLeft size={18} /> Лист</Link>
        <div className="initiative-ribbon" aria-label="Порядок инициативы">
          {state.initiative.map((entry) => {
            const participant = state.world.actors[entry.actorId];
            const isActive = actor.id === entry.actorId;
            return <div key={entry.actorId} className={`${isActive ? 'is-active ' : ''}${participant.runtime.hp.current <= 0 ? 'is-dead' : ''}`} title={`Инициатива: ${initiativeLabel(entry)}`}><span>{state.tokens[entry.actorId]?.tokenUrl ? <img src={state.tokens[entry.actorId].tokenUrl} alt="" /> : participant.name.slice(0, 1)}</span><b>{entry.total}</b><small>{participant.name}</small></div>;
          })}
        </div>
        <div className="combat-round">Раунд {state.world.scene.mode === 'encounter' ? state.world.scene.round : 1}<b>{busy ? 'Сохраняем…' : `Ход: ${actor.name}`}</b></div>
      </header>
      {error && <div className="combat-error" role="alert"><span>{error}</span><button type="button" onClick={() => setError(null)}><X size={16} /></button></div>}
      <section className="combat-stage"><TacticalBattleMap state={state} selectedActionId={selectedActionId} movementMode={movementMode} onCell={clickCell} /><aside className="combat-log"><h2>Журнал боя</h2>{[...state.log].reverse().map((entry) => <article key={entry.id}><span>Раунд {entry.round}</span><p>{entry.text}</p></article>)}</aside></section>
      <CombatHotbar state={state} selectedActionId={selectedActionId} movementMode={movementMode} disabled={!playerTurn || busy || Boolean(pending) || state.outcome !== 'active'} onAction={chooseAction} onMove={() => { setSelectedActionId(null); setMovementMode((value) => !value); }} onEndTurn={() => apply(advanceTurn(state))} onSheet={() => setSheetOpen(true)} />
      {sheetOpen && <aside className="combat-sheet-drawer"><button type="button" onClick={() => setSheetOpen(false)} aria-label="Закрыть"><X /></button><h2>{character.name}</h2><p>Уровень {character.level} · КЗ {state.world.actors[id!].ac} · скорость {character.speed} фт.</p><div className="combat-sheet-stats">{Object.entries(state.world.actors[id!].character.abilityScores ?? {}).map(([key, value]) => <span key={key}><b>{key.toUpperCase()}</b>{value}</span>)}</div><h3>Ресурсы</h3>{Object.entries(state.world.actors[id!].runtime.resources).map(([key, value]) => <p key={key}>{key}: {value}/{state.world.actors[id!].runtime.maxResources[key] ?? value}</p>)}<h3>Действия</h3>{state.playerActionIds.map((actionId) => <p key={actionId}>{state.catalogActions.find((action) => action.id === actionId)?.name}</p>)}<Link target="_blank" to={`/characters-v3/${id}`}>Открыть полный лист ↗</Link></aside>}
      {reactionOptions.length > 0 && <div className="combat-reaction-backdrop"><section><p>РЕАКЦИЯ</p><h2>{reactionTitle}</h2><div>{reactionOptions.map((option) => <button type="button" key={option.actionId} disabled={busy} onClick={() => apply(resolvePlayerReaction(state, option.actionId))}>{option.label}</button>)}<button type="button" onClick={() => apply(resolvePlayerReaction(state, null))}>Пропустить</button></div></section></div>}
      {state.outcome !== 'active' && <div className="combat-outcome"><section><p>БОЙ ЗАВЕРШЁН</p><h1>{state.outcome === 'victory' ? 'Победа' : 'Поражение'}</h1><p>{state.outcome === 'victory' ? 'Все противники уничтожены.' : `${character.name} потерял все хиты.`}</p><button type="button" onClick={finish}>Завершить и вернуться в лист</button><button type="button" onClick={() => navigate(`/characters-v3/${id}`)}><RotateCcw size={16} /> Оставить запись боя</button></section></div>}
    </main>
  );
}
