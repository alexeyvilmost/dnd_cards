import React, { useMemo, useState } from 'react';
import { Check, Plus, Search, X } from 'lucide-react';
import {
  searchTtgBestiary,
  ttgEntryUrl,
  type TtgBestiaryEntry,
} from '../../utils/ttgBestiaryMap';

interface TtgSearchModalProps {
  /** Импорт монстра в бой по ссылке ttg.club (бросает исключение при ошибке). */
  onImportUrl: (url: string) => Promise<void>;
  onClose: () => void;
}

/** Диалог: поиск монстра по названию и импорт его в бой прямо из окна. */
const TtgSearchModal: React.FC<TtgSearchModalProps> = ({ onImportUrl, onClose }) => {
  const [query, setQuery] = useState('');
  const [loadingSlug, setLoadingSlug] = useState<string | null>(null);
  const [addedSlugs, setAddedSlugs] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  const results = useMemo(() => searchTtgBestiary(query), [query]);

  const importEntry = async (entry: TtgBestiaryEntry) => {
    setError(null);
    setLoadingSlug(entry.slug);
    try {
      await onImportUrl(ttgEntryUrl(entry));
      setAddedSlugs((prev) => ({ ...prev, [entry.slug]: (prev[entry.slug] ?? 0) + 1 }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка импорта');
    } finally {
      setLoadingSlug(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <h2 className="text-lg font-semibold text-gray-900">Поиск монстра на ttg.club</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100">
            <X size={18} />
          </button>
        </div>

        <div className="border-b border-gray-100 px-5 py-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Название монстра (напр. «скелет»)"
              className="w-full rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {results.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-gray-500">
              Ничего не найдено. Список курируемый — можно импортировать вручную по ссылке.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {results.map((entry) => {
                const count = addedSlugs[entry.slug] ?? 0;
                const loading = loadingSlug === entry.slug;
                return (
                  <li key={entry.slug}>
                    <button
                      type="button"
                      onClick={() => void importEntry(entry)}
                      disabled={loading}
                      className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-gray-50 disabled:opacity-60"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-gray-800">{entry.name}</div>
                        <div className="truncate text-xs text-gray-400">
                          {entry.type}
                          {entry.cr ? ` · ПО ${entry.cr}` : ''}
                        </div>
                      </div>
                      {count > 0 && (
                        <span className="flex items-center gap-1 text-xs font-medium text-green-600">
                          <Check size={14} /> добавлен{count > 1 ? ` ×${count}` : ''}
                        </span>
                      )}
                      <span className="flex items-center gap-1 text-xs text-red-600">
                        {loading ? (
                          'Импорт...'
                        ) : (
                          <>
                            <Plus size={14} /> в бой
                          </>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex justify-end border-t border-gray-200 px-5 py-3">
          <button type="button" onClick={onClose} className="btn-secondary">
            Готово
          </button>
        </div>
      </div>
    </div>
  );
};

export default TtgSearchModal;
