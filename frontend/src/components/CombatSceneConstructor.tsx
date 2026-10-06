import { useEffect, useState } from 'react';
import { Plus, RefreshCcw, Save, X } from 'lucide-react';
import { charactersV3Api } from '../character/api';
import type { ForgeCharacterPreview } from '../character/types';
import { monstersApi } from '../monsters/api';
import type { Monster } from '../monsters/types';
import {
  refreshSoloCombatResources,
  setSoloCombatMount,
  setSoloCombatInitiativeTotals,
} from '../solo-combat/engine';
import { effectiveActorSize } from '../solo-combat/tacticalGrid';
import { isPlayerControlledCombatActor, type SoloCombatState } from '../solo-combat/types';
import { actorOwnsMountedCombatant } from '../rules-core/generalFeatReactionRuntime';
import {BATTLE_MAPS, installBattleMap} from '../solo-combat/battleMaps';

export default function CombatSceneConstructor({
  state,
  busy,
  onApply,
  onAddCharacter,
  onAddMonster,
  onClose,
  laboratory = false,
}: {
  state: SoloCombatState;
  busy: boolean;
  onApply: (state: SoloCombatState) => void;
  onAddCharacter: (characterId: string) => Promise<void>;
  onAddMonster: (monsterId: string) => Promise<void>;
  onClose: () => void;
  laboratory?: boolean;
}) {
  const [totals, setTotals] = useState<Record<string, number>>({});
  const [addKind, setAddKind] = useState<'character' | 'monster'>('monster');
  const [selectedId, setSelectedId] = useState('');
  const [characters, setCharacters] = useState<ForgeCharacterPreview[]>([]);
  const [monsters, setMonsters] = useState<Monster[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const sceneLocked = busy || adding || Boolean(state.world.pendingResolution || state.pendingD20Interrupt
    || state.pendingTriggeredAction || state.pendingDeathSave || state.pendingInterception
    || state.pendingTurnStartGrappleDamage || state.pendingAlertSwapActorIds?.length
    || state.playerMovement || state.pendingAdditionalMovement || state.pendingMovementStep);
  useEffect(() => {
    setTotals(Object.fromEntries(state.initiative.map((entry) => [entry.actorId, entry.total])));
  }, [state.initiative]);
  useEffect(() => {
    let active = true;
    void Promise.all([
      charactersV3Api.listPreviews(),
      monstersApi.list({ page: 1, limit: 100 }),
    ]).then(([characterRows, monsterRows]) => {
      if (!active) return;
      setCharacters(characterRows);
      setMonsters(monsterRows.monsters);
      setLoadingOptions(false);
    }).catch((reason) => {
      if (!active) return;
      setAddError(reason instanceof Error ? reason.message : 'Не удалось загрузить участников');
      setLoadingOptions(false);
    });
    return () => { active = false; };
  }, []);

  const availableCharacters = characters.filter((character) => !state.world.actors[character.id]);
  const candidates = addKind === 'character' ? availableCharacters : monsters;
  const selectedCandidateId = candidates.some(({ id }) => id === selectedId)
    ? selectedId
    : candidates[0]?.id ?? '';

  const addParticipant = async () => {
    if (!selectedCandidateId || sceneLocked) return;
    setAdding(true);
    setAddError(null);
    try {
      if (addKind === 'character') await onAddCharacter(selectedCandidateId);
      else await onAddMonster(selectedCandidateId);
      setSelectedId('');
    } catch (reason) {
      setAddError(reason instanceof Error ? reason.message : 'Не удалось добавить участника');
    } finally {
      setAdding(false);
    }
  };

  return <aside className="combat-scene-constructor" aria-label="Конструктор сцены">
    <header>
      <div><p>ТЕСТОВЫЕ ИНСТРУМЕНТЫ</p><h2>Конструктор сцены</h2></div>
      <button type="button" onClick={onClose} aria-label="Закрыть"><X /></button>
    </header>
    <p className="combat-scene-constructor__hint">Добавляйте участников, меняйте порядок хода и восстанавливайте ресурсы без пересоздания сцены.</p>
    {laboratory && <section className="combat-scene-constructor__add">
      <label>Карта сцены<select aria-label="Карта сцены" disabled={sceneLocked} value={state.battleMap?.id ?? ''}
        onChange={event => {try {const index = BATTLE_MAPS.findIndex(map => map.id === event.target.value); const next=installBattleMap(state,index); onApply({...next,boardRevision:state.boardRevision+1}); setAddError(null);} catch(reason) {setAddError(reason instanceof Error ? reason.message : 'Не удалось сменить карту');}}}>
        <option value="" disabled>Без карты</option>{BATTLE_MAPS.map(map => <option key={map.id} value={map.id}>{map.name}</option>)}
      </select></label>
      <p className="combat-scene-constructor__hint">Участники будут расставлены на новой карте. Инициатива, эффекты и ресурсы сохранятся.</p>
    </section>}
    <section className="combat-scene-constructor__add" aria-label="Добавить участника">
      <h3>Добавить участника</h3>
      <div>
        <label>Тип
          <select aria-label="Тип участника" value={addKind} disabled={sceneLocked} onChange={(event) => {
            setAddKind(event.target.value as 'character' | 'monster');
            setSelectedId('');
            setAddError(null);
          }}>
            <option value="monster">Противник из каталога</option>
            <option value="character">Мой персонаж</option>
          </select>
        </label>
        <label>Участник
          <select
            aria-label="Участник"
            value={selectedCandidateId}
            disabled={sceneLocked || loadingOptions || !candidates.length}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            {candidates.length ? candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
            )) : <option value="">Нет доступных участников</option>}
          </select>
        </label>
        <button
          type="button"
          disabled={sceneLocked || loadingOptions || !selectedCandidateId}
          onClick={() => { void addParticipant(); }}
        >
          <Plus size={16} /> {adding ? 'Добавляем…' : 'Добавить в сцену'}
        </button>
      </div>
      {addError && <p role="alert">{addError}</p>}
    </section>
    <div className="combat-scene-constructor__actors">
      {state.initiative.map((entry) => {
        const actor = state.world.actors[entry.actorId];
        const controlled = isPlayerControlledCombatActor(state, entry.actorId);
        const ownsMountedCombatant = actorOwnsMountedCombatant(actor);
        const mountCandidates = (ownsMountedCombatant || Object.values(state.world.actors).some((candidate) => (
          candidate.ownedSummon?.ownerActorId === actor.id
            && candidate.ownedSummon.summonKey === 'otherworldly_steed'
        )))
          ? Object.values(state.world.actors).filter((candidate) => (
            candidate.id !== actor.id
              && (ownsMountedCombatant || (candidate.ownedSummon?.ownerActorId === actor.id
                && candidate.ownedSummon.summonKey === 'otherworldly_steed'))
              && state.sideByActorId[candidate.id] === state.sideByActorId[actor.id]
              && candidate.runtime.hp.current > 0
              && Number.isInteger(effectiveActorSize(actor))
              && Number.isInteger(effectiveActorSize(candidate))
              && effectiveActorSize(candidate)! > effectiveActorSize(actor)!
              && Math.max(
                Math.abs(state.tokens[candidate.id].position.x - state.tokens[actor.id].position.x),
                Math.abs(state.tokens[candidate.id].position.y - state.tokens[actor.id].position.y),
              ) <= 1
          ))
          : [];
        return <article key={entry.actorId}>
          <span className="combat-scene-constructor__token">{state.tokens[entry.actorId]?.tokenUrl ? <img src={state.tokens[entry.actorId].tokenUrl} alt="" /> : actor.name.slice(0, 1)}</span>
          <span><b>{actor.name}</b><small>{actor.ownedSummon ? `Призвано: ${state.world.actors[actor.ownedSummon.ownerActorId]?.name ?? 'владелец'}` : controlled ? 'Персонаж' : 'Противник'} · ресурсы {Object.values(actor.runtime.resources).filter((value) => Number(value) > 0).length}/{Object.keys(actor.runtime.maxResources).length}</small></span>
          <label>Инициатива<input type="number" min={-100} max={100} value={totals[entry.actorId] ?? entry.total} onChange={(event) => setTotals((current) => ({ ...current, [entry.actorId]: Number(event.target.value) }))} /></label>
          {mountCandidates.length > 0 && <label>Скакун
            <select
              aria-label={`Скакун: ${actor.name}`}
              disabled={sceneLocked}
              value={state.mountByRiderId?.[actor.id] ?? ''}
              onChange={(event) => onApply(setSoloCombatMount(
                state, actor.id, event.target.value || null,
              ))}
            >
              <option value="">Не верхом</option>
              {mountCandidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
              ))}
            </select>
          </label>}
          <button type="button" disabled={sceneLocked} onClick={() => onApply(refreshSoloCombatResources(state, entry.actorId))}><RefreshCcw size={15} /> Ресурсы</button>
        </article>;
      })}
    </div>
    <footer><button type="button" disabled={sceneLocked} onClick={() => onApply(setSoloCombatInitiativeTotals(state, totals))}><Save size={16} /> Применить инициативу</button></footer>
  </aside>;
}
