import React, { useMemo, useState } from 'react';
import { Check, Download, Plus, Search, Trash2, X } from 'lucide-react';
import { getInitiativeColor, type CreatureType } from '../../types/initiative';
import type { LibraryCreature } from '../../utils/initiativeLibrary';
import { isTtgClubBestiaryUrl } from '../../utils/ttgClubBestiary';

interface LibraryModalProps {
  library: LibraryCreature[];
  onAddToCombat: (creature: LibraryCreature) => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, patch: Partial<LibraryCreature>) => void;
  /** Импорт монстра в библиотеку по ссылке ttg.club (бросает исключение при ошибке). */
  onImportUrl: (url: string) => Promise<void>;
  onClose: () => void;
}

const TYPE_LABEL: Record<CreatureType, string> = { monster: 'Монстр', player: 'Игрок' };

/** Диалог библиотеки существ: поиск, добавление нескольких в бой, импорт из ttg. */
const LibraryModal: React.FC<LibraryModalProps> = ({
  library,
  onAddToCombat,
  onRemove,
  onUpdate,
  onImportUrl,
  onClose,
}) => {
  const [query, setQuery] = useState('');
  const [importUrl, setImportUrl] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addedCounts, setAddedCounts] = useState<Record<string, number>>({});

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? library.filter((c) => c.name.toLowerCase().includes(q)) : library;
    return [...list].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [library, query]);

  const addToCombat = (creature: LibraryCreature) => {
    onAddToCombat(creature);
    setAddedCounts((prev) => ({ ...prev, [creature.id]: (prev[creature.id] ?? 0) + 1 }));
  };

  const runImport = async () => {
    setError(null);
    if (!isTtgClubBestiaryUrl(importUrl)) {
      setError('Вставьте ссылку на монстра с new.ttg.club/bestiary/...');
      return;
    }
    setIsImporting(true);
    try {
      await onImportUrl(importUrl);
      setImportUrl('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка импорта');
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-xl flex-col rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <h2 className="text-lg font-semibold text-gray-900">Библиотека существ</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-2 border-b border-gray-100 px-5 py-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск по библиотеке"
              className="w-full rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="flex gap-2">
            <input
              type="url"
              value={importUrl}
              onChange={(e) => {
                setImportUrl(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void runImport();
              }}
              placeholder="Импорт в библиотеку: https://new.ttg.club/bestiary/..."
              className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button
              type="button"
              onClick={() => void runImport()}
              disabled={isImporting || !importUrl.trim()}
              className="btn-secondary flex items-center gap-2 whitespace-nowrap disabled:opacity-50"
            >
              <Download size={16} />
              {isImporting ? '...' : 'Импорт'}
            </button>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {results.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-gray-500">
              {library.length === 0
                ? 'Библиотека пуста. Импортируйте монстра с ttg.club или сохраните существо из боя (иконка закладки).'
                : 'Ничего не найдено.'}
            </p>
          ) : (
            <ul className="space-y-0.5">
              {results.map((creature) => {
                const color = getInitiativeColor(creature.color);
                const count = addedCounts[creature.id] ?? 0;
                return (
                  <li
                    key={creature.id}
                    className="flex items-center gap-2 rounded-md px-3 py-2 hover:bg-gray-50"
                  >
                    <span
                      className="h-3 w-3 flex-shrink-0 rounded-full"
                      style={{ backgroundColor: color.hex }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-gray-800">{creature.name}</div>
                      <div className="text-xs text-gray-400">
                        КД {creature.ac} · HP {creature.maxHp} · иниц.{' '}
                        {creature.initiativeBonus >= 0 ? '+' : ''}
                        {creature.initiativeBonus}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        onUpdate(creature.id, {
                          type: creature.type === 'monster' ? 'player' : 'monster',
                        })
                      }
                      className="flex-shrink-0 rounded border border-gray-300 px-1.5 py-0.5 text-xs text-gray-600 hover:bg-gray-100"
                      title="Переключить тип (влияет на цвет при добавлении)"
                    >
                      {TYPE_LABEL[creature.type]}
                    </button>

                    {count > 0 && (
                      <span className="flex items-center gap-0.5 text-xs text-green-600">
                        <Check size={13} />
                        {count > 1 ? `×${count}` : ''}
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={() => addToCombat(creature)}
                      className="flex flex-shrink-0 items-center gap-1 rounded-md bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700"
                      title="Добавить в бой"
                    >
                      <Plus size={14} /> В бой
                    </button>

                    <button
                      type="button"
                      onClick={() => onRemove(creature.id)}
                      className="flex-shrink-0 rounded p-1 text-red-500 hover:bg-red-50"
                      title="Удалить из библиотеки"
                    >
                      <Trash2 size={15} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-gray-200 px-5 py-3">
          <span className="text-xs text-gray-500">{library.length} существ в библиотеке</span>
          <button type="button" onClick={onClose} className="btn-secondary">
            Готово
          </button>
        </div>
      </div>
    </div>
  );
};

export default LibraryModal;
