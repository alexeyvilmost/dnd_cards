import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Swords, RotateCcw, SkipForward, Play, Download } from 'lucide-react';
import InitiativeCharacterBlock from '../components/initiative/InitiativeCharacterBlock';
import {
  createEmptyCharacter,
  sortByInitiative,
  type InitiativeCharacter,
  type InitiativeTrackerState,
} from '../types/initiative';
import { importFromDndSuUrl, isDndSuBestiaryUrl } from '../utils/dndSuBestiary';

const STORAGE_KEY = 'initiative-tracker-v1';

const defaultState: InitiativeTrackerState = {
  characters: [],
  activeIndex: 0,
  round: 1,
};

function loadState(): InitiativeTrackerState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState;
    const parsed = JSON.parse(raw) as InitiativeTrackerState;
    return {
      characters: (Array.isArray(parsed.characters) ? parsed.characters : []).map((c) => ({
        ...createEmptyCharacter(),
        ...c,
        description: typeof c.description === 'string' ? c.description : '',
      })),
      activeIndex: typeof parsed.activeIndex === 'number' ? parsed.activeIndex : 0,
      round: typeof parsed.round === 'number' ? parsed.round : 1,
    };
  } catch {
    return defaultState;
  }
}

const InitiativeTracker: React.FC = () => {
  const [state, setState] = useState<InitiativeTrackerState>(loadState);
  const [manualOrder, setManualOrder] = useState<string[] | null>(null);
  const [importUrl, setImportUrl] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const orderedCharacters = useMemo(() => {
    if (manualOrder) {
      const byId = new Map(state.characters.map((c) => [c.id, c]));
      const ordered = manualOrder
        .map((id) => byId.get(id))
        .filter((c): c is InitiativeCharacter => Boolean(c));
      const missing = state.characters.filter((c) => !manualOrder.includes(c.id));
      return [...ordered, ...missing];
    }
    return sortByInitiative(state.characters);
  }, [state.characters, manualOrder]);

  const activeIndex = Math.min(state.activeIndex, Math.max(0, orderedCharacters.length - 1));
  const activeId = orderedCharacters[activeIndex]?.id;

  const updateCharacter = useCallback((id: string, patch: Partial<InitiativeCharacter>) => {
    setState((prev) => ({
      ...prev,
      characters: prev.characters.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));
    if (patch.initiative !== undefined) {
      setManualOrder(null);
    }
  }, []);

  const addCharacter = () => {
    const character = createEmptyCharacter();
    character.name = `Участник ${state.characters.length + 1}`;
    setState((prev) => ({
      ...prev,
      characters: [...prev.characters, character],
    }));
    setManualOrder(null);
  };

  const importFromDndSu = async () => {
    setImportError(null);
    if (!isDndSuBestiaryUrl(importUrl)) {
      setImportError('Вставьте ссылку на монстра с next.dnd.su или 5e14.dnd.su');
      return;
    }

    setIsImporting(true);
    try {
      const data = await importFromDndSuUrl(importUrl);
      const character = createEmptyCharacter();
      character.name = data.name;
      character.ac = data.ac;
      character.maxHp = data.maxHp;
      character.currentHp = data.maxHp;
      character.description = data.description;

      setState((prev) => ({
        ...prev,
        characters: [...prev.characters, character],
      }));
      setManualOrder(null);
      setImportUrl('');
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Ошибка импорта');
    } finally {
      setIsImporting(false);
    }
  };

  const removeCharacter = (id: string) => {
    setState((prev) => {
      const nextCharacters = prev.characters.filter((c) => c.id !== id);
      const nextActive = Math.min(prev.activeIndex, Math.max(0, nextCharacters.length - 1));
      return { ...prev, characters: nextCharacters, activeIndex: nextActive };
    });
    setManualOrder((prev) => (prev ? prev.filter((itemId) => itemId !== id) : null));
  };

  const rollInitiative = (id: string) => {
    const roll = Math.floor(Math.random() * 20) + 1;
    updateCharacter(id, { initiative: roll });
  };

  const startCombat = () => {
    const needsRoll = state.characters.some((c) => c.initiative === 0);
    if (!needsRoll) return;

    setState((prev) => ({
      ...prev,
      characters: prev.characters.map((c) =>
        c.initiative === 0
          ? { ...c, initiative: Math.floor(Math.random() * 20) + 1 }
          : c
      ),
      activeIndex: 0,
      round: 1,
    }));
    setManualOrder(null);
  };

  const hasUnrolledInitiative = state.characters.some((c) => c.initiative === 0);

  const moveCharacter = (id: string, direction: -1 | 1) => {
    const ids = orderedCharacters.map((c) => c.id);
    const index = ids.indexOf(id);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    setManualOrder(ids);
  };

  const nextTurn = () => {
    if (orderedCharacters.length === 0) return;
    setState((prev) => {
      const nextIndex = (prev.activeIndex + 1) % orderedCharacters.length;
      const nextRound = nextIndex === 0 ? prev.round + 1 : prev.round;
      return { ...prev, activeIndex: nextIndex, round: nextRound };
    });
  };

  const resetCombat = () => {
    setState((prev) => ({ ...prev, activeIndex: 0, round: 1 }));
    setManualOrder(null);
  };

  const clearAll = () => {
    if (!window.confirm('Удалить всех участников?')) return;
    setState(defaultState);
    setManualOrder(null);
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 flex items-center gap-2">
            <Swords className="text-blue-600" />
            Трекер инициативы
          </h1>
          <p className="text-sm sm:text-base text-gray-600 mt-1">
            Порядок ходов в бою — раунд {state.round}
            {orderedCharacters.length > 0 && ` · ${orderedCharacters.length} участников`}
          </p>
        </div>

        <div className="flex flex-wrap gap-2 w-full sm:w-auto">
          <button
            type="button"
            onClick={startCombat}
            disabled={orderedCharacters.length === 0 || !hasUnrolledInitiative}
            className="btn-primary bg-amber-600 hover:bg-amber-700 flex items-center justify-center gap-2 flex-1 sm:flex-none disabled:opacity-50"
            title="Бросить d20 за всех с инициативой 0"
          >
            <Play size={18} />
            Начать бой
          </button>
          <button
            type="button"
            onClick={nextTurn}
            disabled={orderedCharacters.length === 0}
            className="btn-primary flex items-center justify-center gap-2 flex-1 sm:flex-none disabled:opacity-50"
          >
            <SkipForward size={18} />
            Следующий ход
          </button>
          <button
            type="button"
            onClick={resetCombat}
            disabled={orderedCharacters.length === 0}
            className="btn-secondary flex items-center justify-center gap-2 flex-1 sm:flex-none disabled:opacity-50"
          >
            <RotateCcw size={18} />
            Сброс раунда
          </button>
          <button
            type="button"
            onClick={addCharacter}
            className="btn-primary bg-green-600 hover:bg-green-700 flex items-center justify-center gap-2 flex-1 sm:flex-none"
          >
            <Plus size={18} />
            Добавить
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4 space-y-2">
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="url"
            value={importUrl}
            onChange={(e) => {
              setImportUrl(e.target.value);
              if (importError) setImportError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void importFromDndSu();
            }}
            placeholder="https://next.dnd.su/bestiary/21552-skeleton/"
            className="input-field flex-1 text-sm"
          />
          <button
            type="button"
            onClick={() => void importFromDndSu()}
            disabled={isImporting || !importUrl.trim()}
            className="btn-secondary flex items-center justify-center gap-2 whitespace-nowrap disabled:opacity-50"
          >
            <Download size={18} />
            {isImporting ? 'Импорт...' : 'Импорт с dnd.su'}
          </button>
        </div>
        {importError && (
          <p className="text-sm text-red-600">{importError}</p>
        )}
        <p className="text-xs text-gray-500">
          Подтягиваются имя, КД и макс. HP. Остальное — в описание (видно в развёрнутом блоке).
        </p>
      </div>

      {orderedCharacters.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-lg border border-gray-200">
          <Swords className="h-16 w-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Нет участников боя</h3>
          <p className="text-gray-600 mb-6">Добавьте персонажей и NPC, чтобы отслеживать инициативу</p>
          <button type="button" onClick={addCharacter} className="btn-primary inline-flex items-center gap-2">
            <Plus size={18} />
            Добавить участника
          </button>
        </div>
      ) : (
        <div className="space-y-1.5">
          {orderedCharacters.map((character, index) => (
            <InitiativeCharacterBlock
              key={character.id}
              character={character}
              isActive={character.id === activeId}
              onUpdate={updateCharacter}
              onRemove={removeCharacter}
              onRollInitiative={rollInitiative}
              onMoveUp={(id) => moveCharacter(id, -1)}
              onMoveDown={(id) => moveCharacter(id, 1)}
              canMoveUp={index > 0}
              canMoveDown={index < orderedCharacters.length - 1}
            />
          ))}
        </div>
      )}

      {orderedCharacters.length > 0 && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={clearAll}
            className="text-sm text-red-600 hover:text-red-800 underline"
          >
            Очистить всё
          </button>
        </div>
      )}
    </div>
  );
};

export default InitiativeTracker;
