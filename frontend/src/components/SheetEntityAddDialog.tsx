import { useEffect, useMemo, useState } from 'react';
import {
  Backpack,
  CircleDot,
  Plus,
  Search,
  Sparkles,
  Swords,
  X,
} from 'lucide-react';
import {
  addManualEntities,
  loadManualEntities,
  manualEntityAlreadyAdded,
  type ManualEntity,
  type ManualEntityType,
} from '../character/manualEntityAddition';
import type { ForgeCharacter } from '../character/types';
import {
  filterEntitiesBySupport,
  supportSelectionWarning,
  type SupportableEntity,
} from '../content/supportStatus';

const TYPES: Array<{
  type: ManualEntityType;
  label: string;
  search: string;
  icon: typeof Backpack;
}> = [
  { type: 'items', label: 'Предметы', search: 'меч, щит, зелье…', icon: Backpack },
  { type: 'actions', label: 'Действия', search: 'атака, приём, способность…', icon: Swords },
  { type: 'effects', label: 'Эффекты', search: 'пассивный эффект…', icon: CircleDot },
  { type: 'spells', label: 'Заклинания', search: 'название заклинания…', icon: Sparkles },
];

function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error && 'response' in error) {
    const data = (error as { response?: { data?: { error?: string; message?: string } } }).response?.data;
    return data?.error || data?.message || 'Не удалось добавить сущность';
  }
  return error instanceof Error ? error.message : 'Не удалось добавить сущность';
}

export default function SheetEntityAddDialog({
  character,
  onUpdated,
  onClose,
}: {
  character: ForgeCharacter;
  onUpdated: (character: ForgeCharacter) => void | Promise<void>;
  onClose: () => void;
}) {
  const [type, setType] = useState<ManualEntityType>('items');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [entities, setEntities] = useState<ManualEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const config = TYPES.find((entry) => entry.type === type)!;

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let stale = false;
    setLoading(true);
    setError(null);
    loadManualEntities(type, debouncedSearch, 100)
      .then((items) => { if (!stale) setEntities(items); })
      .catch((reason) => { if (!stale) setError(errorMessage(reason)); })
      .finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [type, debouncedSearch]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !addingId) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [addingId, onClose]);

  const visibleEntities = useMemo(() => {
    const sources = filterEntitiesBySupport(
      entities.map((entity) => entity.source as SupportableEntity & { id: string }),
      showAll,
    );
    const visibleIds = new Set(sources.map((entity) => entity.id));
    return entities.filter((entity) => visibleIds.has(entity.id));
  }, [entities, showAll]);

  const add = async (entity: ManualEntity) => {
    const warning = supportSelectionWarning(entity.source as SupportableEntity);
    if (warning && !window.confirm(warning)) return;
    setAddingId(entity.id);
    setError(null);
    try {
      const updated = await addManualEntities(character, type, [{ entity, amount: 1 }]);
      await onUpdated(updated);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setAddingId(null);
    }
  };

  return (
    <div className="sheet-equip-overlay" onClick={() => !addingId && onClose()}>
      <div className="sheet-entity-add-dialog" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="sheet-equip-close" onClick={onClose} disabled={!!addingId} title="Закрыть (Esc)">
          <X size={18} />
        </button>
        <h2 className="sheet-settings-title">Добавить в лист</h2>
        <p className="sheet-settings-hint">Сущность станет полноценной частью персонажа и сразу попадёт в пересчёт листа.</p>

        <div className="sheet-entity-add-tabs" role="tablist" aria-label="Тип сущности">
          {TYPES.map(({ type: entryType, label, icon: Icon }) => (
            <button
              key={entryType}
              type="button"
              role="tab"
              aria-selected={type === entryType}
              className={`sheet-entity-add-tab${type === entryType ? ' is-active' : ''}`}
              onClick={() => {
                setType(entryType);
                setSearch('');
                setEntities([]);
              }}
            >
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>

        <label className="sheet-inv-search sheet-entity-add-search">
          <Search size={16} className="sheet-inv-search-icon" />
          <input
            className="forge-input sheet-inv-search-input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={`Поиск: ${config.search}`}
            autoFocus
          />
        </label>

        <label className="sheet-entity-add-all">
          <input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} />
          Показать неподтверждённые сущности
        </label>

        {error && <p className="issues">{error}</p>}
        {loading && <p className="forge-note">Загрузка…</p>}
        {!loading && visibleEntities.length === 0 && <p className="forge-note">Ничего не найдено.</p>}

        <div className="sheet-entity-add-list">
          {visibleEntities.map((entity) => {
            const already = manualEntityAlreadyAdded(character, type, entity);
            const adding = addingId === entity.id;
            return (
              <article className="sheet-entity-add-row" key={entity.id}>
                <img
                  src={entity.imageUrl?.trim() || '/default_image.png'}
                  alt=""
                  onError={(event) => { (event.currentTarget as HTMLImageElement).src = '/default_image.png'; }}
                />
                <div className="sheet-entity-add-copy">
                  <strong>{entity.name}</strong>
                  <span>{entity.meta || entity.description || 'Без дополнительного описания'}</span>
                </div>
                <button
                  type="button"
                  className="forge-btn ghost sheet-entity-add-button"
                  disabled={!!addingId || already}
                  onClick={() => void add(entity)}
                >
                  {already ? 'Уже в листе' : adding ? 'Добавляем…' : <><Plus size={14} /> Добавить</>}
                </button>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
