import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Swords, RotateCcw, SkipForward, Play, Download, BookOpen, Share2 } from 'lucide-react';
import InitiativeCharacterBlock from '../components/initiative/InitiativeCharacterBlock';
import LibraryModal from '../components/initiative/LibraryModal';
import TtgSearchModal from '../components/initiative/TtgSearchModal';
import PlayerInitiativeModal from '../components/initiative/PlayerInitiativeModal';
import CombatToasts from '../components/initiative/CombatToasts';
import CombatLogFab from '../components/initiative/CombatLogFab';
import {
  COLOR_BY_TYPE,
  createEmptyCharacter,
  duplicateCharacter,
  getInitiativeColor,
  NEUTRAL_COLOR,
  normalizeCharacter,
  rollInitiativeValue,
  sortByInitiative,
  type InitiativeCharacter,
  type InitiativeTrackerState,
} from '../types/initiative';
import { importFromTtgClubUrl, isTtgClubBestiaryUrl } from '../utils/ttgClubBestiary';
import { parseAttacks, rollAttack } from '../utils/attackParser';
import { useCombatLog } from '../utils/useCombatLog';
import {
  buildAttackEntry,
  buildDamageEntry,
  buildHealEntry,
  buildHpChangeEntry,
} from '../utils/combatLog';
import {
  characterToLibrary,
  libraryToCharacter,
  loadLibrary,
  saveLibrary,
  upsertLibraryCreature,
  type LibraryCreature,
} from '../utils/initiativeLibrary';
import { buildShareUrl, clearCombatHash, readCombatFromHash } from '../utils/initiativeShare';

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
      characters: (Array.isArray(parsed.characters) ? parsed.characters : []).map(normalizeCharacter),
      activeIndex: typeof parsed.activeIndex === 'number' ? parsed.activeIndex : 0,
      round: typeof parsed.round === 'number' ? parsed.round : 1,
    };
  } catch {
    return defaultState;
  }
}

/** При открытии по ссылке-снимку — грузим бой из хэша, иначе из localStorage. */
function initialState(): InitiativeTrackerState {
  const fromHash = readCombatFromHash();
  if (fromHash) {
    const current = loadState();
    if (
      current.characters.length === 0 ||
      window.confirm('Открыть бой из ссылки? Текущий список участников будет заменён.')
    ) {
      clearCombatHash();
      return fromHash;
    }
    clearCombatHash();
  }
  return loadState();
}

const InitiativeTracker: React.FC = () => {
  const [state, setState] = useState<InitiativeTrackerState>(initialState);
  const [library, setLibrary] = useState<LibraryCreature[]>(loadLibrary);
  const [manualOrder, setManualOrder] = useState<string[] | null>(null);
  const [importUrl, setImportUrl] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const [isTtgOpen, setIsTtgOpen] = useState(false);
  const [playersToRoll, setPlayersToRoll] = useState<InitiativeCharacter[] | null>(null);
  const [isLogOpen, setIsLogOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<number | null>(null);
  const { entries, activeToasts, push } = useCombatLog();

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  useEffect(() => {
    saveLibrary(library);
  }, [library]);

  useEffect(() => () => {
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
  }, []);

  const showFlash = useCallback((message: string) => {
    setFlash(message);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 2500);
  }, []);

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

  const appendCharacter = useCallback((character: InitiativeCharacter) => {
    setState((prev) => ({ ...prev, characters: [...prev.characters, character] }));
    setManualOrder(null);
  }, []);

  const addCharacter = () => {
    const character = createEmptyCharacter({ color: NEUTRAL_COLOR });
    character.name = `Участник ${state.characters.length + 1}`;
    appendCharacter(character);
  };

  const addFromLibrary = useCallback(
    (creature: LibraryCreature) => {
      appendCharacter(libraryToCharacter(creature));
    },
    [appendCharacter],
  );

  /** Импорт монстра с ttg.club прямо в бой (красный монстр, с бонусом инициативы). */
  const importToCombat = useCallback(
    async (url: string) => {
      const data = await importFromTtgClubUrl(url);
      appendCharacter(
        createEmptyCharacter({
          name: data.name,
          type: 'monster',
          color: COLOR_BY_TYPE.monster,
          ac: data.ac,
          maxHp: data.maxHp,
          currentHp: data.maxHp,
          initiativeBonus: data.initiativeBonus,
          description: data.description,
          statblock: data.statblock,
        }),
      );
    },
    [appendCharacter],
  );

  /** Импорт монстра с ttg.club в библиотеку. */
  const importToLibrary = useCallback(async (url: string) => {
    const data = await importFromTtgClubUrl(url);
    const creature: LibraryCreature = {
      id: crypto.randomUUID(),
      name: data.name,
      type: 'monster',
      color: COLOR_BY_TYPE.monster,
      ac: data.ac,
      maxHp: data.maxHp,
      initiativeBonus: data.initiativeBonus,
      description: data.description,
      sourceUrl: data.sourceUrl,
      statblock: data.statblock,
    };
    setLibrary((prev) => upsertLibraryCreature(prev, creature));
    showFlash(`«${data.name}» добавлен в библиотеку`);
  }, [showFlash]);

  const importFromTtgClub = async () => {
    setImportError(null);
    if (!isTtgClubBestiaryUrl(importUrl)) {
      setImportError('Вставьте ссылку на монстра с new.ttg.club/bestiary/...');
      return;
    }
    setIsImporting(true);
    try {
      await importToCombat(importUrl);
      setImportUrl('');
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Ошибка импорта');
    } finally {
      setIsImporting(false);
    }
  };

  const saveToLibrary = (id: string) => {
    const source = state.characters.find((c) => c.id === id);
    if (!source) return;
    setLibrary((prev) => upsertLibraryCreature(prev, characterToLibrary(source)));
    showFlash(`«${source.name || 'Существо'}» сохранён в библиотеку`);
  };

  const copyCharacter = (id: string) => {
    const source = state.characters.find((c) => c.id === id);
    if (!source) return;
    const copy = duplicateCharacter(source, state.characters.map((c) => c.color));
    appendCharacter(copy);
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
    const character = state.characters.find((c) => c.id === id);
    updateCharacter(id, { initiative: rollInitiativeValue(character?.initiativeBonus ?? 0) });
  };

  const accentOf = (character: InitiativeCharacter) => getInitiativeColor(character.color).hex;

  // Бросок атаки (меч/лук) с записью в лог и подсказкой (#4, #5).
  const attackCharacter = (id: string, kind: 'melee' | 'ranged') => {
    const character = state.characters.find((c) => c.id === id);
    if (!character) return;
    const attacks = parseAttacks(character.description);
    const attack = kind === 'melee' ? attacks.melee : attacks.ranged;
    if (!attack) return;
    push(buildAttackEntry(character.name, accentOf(character), rollAttack(attack)));
  };

  // Изменение HP кнопками +/- с подсказкой и записью в лог (#7).
  const damageCharacter = (id: string, amount: number) => {
    const character = state.characters.find((c) => c.id === id);
    if (!character) return;
    updateCharacter(id, { currentHp: Math.max(0, character.currentHp - amount) });
    push(buildDamageEntry(character.name, accentOf(character), amount));
  };

  const healCharacter = (id: string, amount: number) => {
    const character = state.characters.find((c) => c.id === id);
    if (!character) return;
    updateCharacter(id, { currentHp: Math.min(character.maxHp, character.currentHp + amount) });
    push(buildHealEntry(character.name, accentOf(character), amount));
  };

  // Прямое редактирование поля HP — логируем факт изменения (#7).
  const editHp = (id: string, from: number, to: number) => {
    const character = state.characters.find((c) => c.id === id);
    if (!character) return;
    push(buildHpChangeEntry(character.name, accentOf(character), from, to));
  };

  /** Проставляет инициативу: монстры кидают d20+бонус, игрокам — введённые значения. */
  const applyStart = useCallback((playerValues?: Record<string, number>) => {
    setState((prev) => ({
      ...prev,
      characters: prev.characters.map((c) => {
        if (c.type === 'monster' && c.initiative === 0) {
          return { ...c, initiative: rollInitiativeValue(c.initiativeBonus) };
        }
        if (c.type === 'player' && playerValues && playerValues[c.id] !== undefined) {
          return { ...c, initiative: playerValues[c.id] };
        }
        return c;
      }),
      activeIndex: 0,
      round: 1,
    }));
    setManualOrder(null);
  }, []);

  const startCombat = () => {
    const unfilledPlayers = state.characters.filter(
      (c) => c.type === 'player' && c.initiative === 0,
    );
    if (unfilledPlayers.length > 0) {
      setPlayersToRoll(unfilledPlayers);
      return;
    }
    applyStart();
  };

  const shareCombat = async () => {
    if (state.characters.length === 0) return;
    const url = buildShareUrl(state);
    try {
      await navigator.clipboard.writeText(url);
      showFlash('Ссылка на бой скопирована в буфер обмена');
    } catch {
      window.prompt('Скопируйте ссылку на бой:', url);
    }
  };

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
            disabled={orderedCharacters.length === 0}
            className="btn-primary bg-amber-600 hover:bg-amber-700 flex items-center justify-center gap-2 flex-1 sm:flex-none disabled:opacity-50"
            title="Монстры кидают инициативу сами, для игроков откроется окно ввода"
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
            onClick={shareCombat}
            disabled={orderedCharacters.length === 0}
            className="btn-secondary flex items-center justify-center gap-2 flex-1 sm:flex-none disabled:opacity-50"
            title="Скопировать ссылку на текущий бой"
          >
            <Share2 size={18} />
            Поделиться
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setIsLibraryOpen(true)}
          className="btn-secondary flex items-center gap-2"
          title="Библиотека существ"
        >
          <BookOpen size={18} />
          Библиотека
        </button>
        <button
          type="button"
          onClick={() => setIsTtgOpen(true)}
          className="btn-secondary flex items-center gap-2"
          title="Поиск монстра на ttg.club"
        >
          <Swords size={18} />
          TTG
        </button>
        <button
          type="button"
          onClick={addCharacter}
          className="btn-primary bg-blue-600 hover:bg-blue-700 flex items-center gap-2"
        >
          <Plus size={18} />
          Добавить
        </button>
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
              if (e.key === 'Enter') void importFromTtgClub();
            }}
            placeholder="https://new.ttg.club/bestiary/skeleton-mm"
            className="input-field flex-1 text-sm"
          />
          <button
            type="button"
            onClick={() => void importFromTtgClub()}
            disabled={isImporting || !importUrl.trim()}
            className="btn-secondary flex items-center justify-center gap-2 whitespace-nowrap disabled:opacity-50"
          >
            <Download size={18} />
            {isImporting ? 'Импорт...' : 'Импорт с ttg.club'}
          </button>
        </div>
        {importError && <p className="text-sm text-red-600">{importError}</p>}
        <p className="text-xs text-gray-500">
          Импорт добавляет монстра (красный) с КД, макс. HP, бонусом инициативы и разделом «Действия».
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
              onCopy={copyCharacter}
              onSaveToLibrary={saveToLibrary}
              onRollInitiative={rollInitiative}
              onAttack={attackCharacter}
              onDamage={damageCharacter}
              onHeal={healCharacter}
              onHpEdit={editHp}
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

      {flash && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-gray-900 px-4 py-2 text-sm text-white shadow-lg">
          {flash}
        </div>
      )}

      <CombatToasts toasts={activeToasts} />
      <CombatLogFab entries={entries} open={isLogOpen} onToggle={() => setIsLogOpen((v) => !v)} />

      {isLibraryOpen && (
        <LibraryModal
          library={library}
          onAddToCombat={addFromLibrary}
          onRemove={(id) => setLibrary((prev) => prev.filter((c) => c.id !== id))}
          onUpdate={(id, patch) =>
            setLibrary((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
          }
          onImportUrl={importToLibrary}
          onClose={() => setIsLibraryOpen(false)}
        />
      )}

      {isTtgOpen && (
        <TtgSearchModal onImportUrl={importToCombat} onClose={() => setIsTtgOpen(false)} />
      )}

      {playersToRoll && (
        <PlayerInitiativeModal
          players={playersToRoll}
          onCancel={() => setPlayersToRoll(null)}
          onSubmit={(values) => {
            applyStart(values);
            setPlayersToRoll(null);
          }}
        />
      )}
    </div>
  );
};

export default InitiativeTracker;
