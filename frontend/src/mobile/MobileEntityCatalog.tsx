import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Backpack,
  BookOpen,
  ChevronRight,
  CircleDot,
  Minus,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  actionsApi,
  cardsApi,
  effectsApi,
  featsApi,
  resourcesApi,
  spellsApi,
} from '../api/client';
import { charactersV3Api } from '../character/api';
import { loadAssembly } from '../character/assemble';
import { buildSavePayload, characterToDraft } from '../character/forgeHelpers';
import { resolveCharacterRules } from '../character/rules/resolveCharacterRules';
import type { ForgeCharacter } from '../character/types';
import type { ActiveEffectEntry } from '../mvp/contracts';
import type { Action, Card, Feat, PassiveEffect, ResourceDefinition, Spell } from '../types';
import MobileOverlay from './MobileOverlay';
import './mobile.css';

const CATALOGS = [
  { key: 'items', title: 'Предметы', description: 'Инвентарь и экипировка', icon: Backpack },
  { key: 'actions', title: 'Действия', description: 'Боевые и особые действия', icon: Zap },
  { key: 'spells', title: 'Заклинания', description: 'Известные заклинания', icon: Sparkles },
  { key: 'feats', title: 'Черты', description: 'Черты и способности', icon: ShieldCheck },
  { key: 'effects', title: 'Эффекты', description: 'Пассивные и классовые эффекты', icon: CircleDot },
  { key: 'conditions', title: 'Состояния', description: 'Активные состояния персонажа', icon: CircleDot },
  { key: 'resources', title: 'Ресурсы', description: 'Заряды и расходуемые ресурсы', icon: BookOpen },
] as const;

type CatalogType = typeof CATALOGS[number]['key'];
type SourceEntity = Card | Action | Spell | Feat | PassiveEffect | ResourceDefinition;

interface CatalogEntity {
  id: string;
  name: string;
  description: string;
  imageUrl?: string;
  meta?: string;
  repeatable?: boolean;
  source: SourceEntity;
}

function isCatalogType(value: string | undefined): value is CatalogType {
  return CATALOGS.some((catalog) => catalog.key === value);
}

function describeError(error: unknown): string {
  if (typeof error === 'object' && error && 'response' in error) {
    const message = (error as { response?: { data?: { error?: string; message?: string } } })
      .response?.data;
    return message?.error || message?.message || 'Не удалось сохранить изменения';
  }
  return error instanceof Error ? error.message : 'Не удалось сохранить изменения';
}

function normalize(
  source: SourceEntity,
  type: CatalogType,
): CatalogEntity {
  const description = source.description || '';
  const repeatable = 'repeatable' in source ? Boolean(source.repeatable) : false;
  let meta = '';
  if (type === 'spells' && 'level' in source) {
    meta = source.level === 0 ? 'Заговор' : `${source.level} уровень`;
  } else if (type === 'actions' && 'resource' in source) {
    meta = source.resource || '';
  } else if (type === 'effects' && 'effect_type' in source) {
    meta = source.effect_type || '';
  } else if (type === 'resources' && 'resource_id' in source) {
    meta = source.recharge || source.category || '';
  } else if (type === 'items' && 'type' in source) {
    meta = source.type || '';
  }
  return {
    id: source.id,
    name: source.name,
    description,
    imageUrl: source.image_url,
    meta,
    repeatable,
    source,
  };
}

async function loadEntities(type: CatalogType, search: string): Promise<CatalogEntity[]> {
  const query = search.trim();
  switch (type) {
    case 'items': {
      const response = await cardsApi.getCards({
        limit: 100,
        search: query || undefined,
        exclude_template_only: true,
      });
      return (response.cards ?? []).map((entity) => normalize(entity, type));
    }
    case 'actions': {
      const response = await actionsApi.getActions({ limit: 100, search: query || undefined });
      return (response.actions ?? []).map((entity) => normalize(entity, type));
    }
    case 'spells': {
      const response = await spellsApi.getSpells({ limit: 100, search: query || undefined });
      return (response.spells ?? []).map((entity) => normalize(entity, type));
    }
    case 'feats': {
      const response = await featsApi.getFeats({ limit: 100, search: query || undefined });
      return (response.feats ?? []).map((entity) => normalize(entity, type));
    }
    case 'conditions':
    case 'effects': {
      const response = await effectsApi.getEffects({
        limit: 100,
        search: query || undefined,
        effect_type: type === 'conditions' ? 'condition' : undefined,
      });
      const effects = type === 'effects'
        ? (response.effects ?? []).filter((entity) => entity.effect_type !== 'condition')
        : (response.effects ?? []);
      return effects.map((entity) => normalize(entity, type));
    }
    case 'resources': {
      const response = await resourcesApi.getResources();
      const needle = query.toLocaleLowerCase('ru');
      return (response.resources ?? [])
        .filter((entity) => !needle || `${entity.name} ${entity.description ?? ''}`.toLocaleLowerCase('ru').includes(needle))
        .map((entity) => normalize(entity, type));
    }
  }
}

function nextIds(
  current: string[] | null | undefined,
  entities: CatalogEntity[],
  selection: Record<string, number>,
  allowRepeatable: boolean,
): string[] {
  const result = [...(current ?? [])];
  for (const entity of entities) {
    const amount = selection[entity.id] ?? 0;
    if (!amount) continue;
    const copies = allowRepeatable && entity.repeatable ? amount : 1;
    if (!entity.repeatable && result.includes(entity.id)) continue;
    for (let index = 0; index < copies; index += 1) result.push(entity.id);
  }
  return result;
}

async function saveSelection(
  character: ForgeCharacter,
  type: CatalogType,
  entities: CatalogEntity[],
  selection: Record<string, number>,
): Promise<void> {
  if (type === 'items') {
    const inventory = [...(character.inventory_items ?? [])];
    for (const entity of entities) {
      const amount = selection[entity.id] ?? 0;
      if (!amount) continue;
      const existing = inventory.find((row) => row.card_id === entity.id && !row.container_id);
      if (existing) existing.qty += amount;
      else inventory.push({ card_id: entity.id, qty: amount });
    }
    await charactersV3Api.patchRuntime(character.id, { inventory_items: inventory });
    return;
  }

  if (type === 'conditions') {
    const activeEffects = [...((character.active_effects ?? []) as ActiveEffectEntry[])];
    for (const entity of entities) {
      const amount = selection[entity.id] ?? 0;
      if (!amount) continue;
      const effect = await effectsApi.getEffect(entity.id);
      for (let index = 0; index < amount; index += 1) {
        activeEffects.push({
          id: `cond-player-${Date.now()}-${index}-${effect.id}`,
          name: effect.name,
          mechanics: effect.mechanics ?? {},
          expiry: 'manual',
          source: 'Добавлено игроком',
        });
      }
    }
    await charactersV3Api.patchRuntime(character.id, { active_effects: activeEffects });
    return;
  }

  const draft = characterToDraft(character);
  if (type === 'actions') draft.actionIds = nextIds(draft.actionIds, entities, selection, false);
  if (type === 'spells') draft.spellIds = nextIds(draft.spellIds, entities, selection, false);
  if (type === 'feats') draft.featIds = nextIds(draft.featIds, entities, selection, true);
  if (type === 'effects') draft.effectIds = nextIds(draft.effectIds, entities, selection, true);
  if (type === 'resources') draft.resourceIds = nextIds(draft.resourceIds, entities, selection, false);

  const assembled = await loadAssembly(draft);
  const ruleState = resolveCharacterRules({ draft, assembled });
  await charactersV3Api.update(
    character.id,
    buildSavePayload(draft, assembled, ruleState, character.current_hp),
  );

  if (type === 'resources') {
    const resources = { ...(character.resources ?? {}) };
    const maxResources = { ...(character.max_resources ?? {}) };
    for (const entity of entities) {
      if (!(selection[entity.id] ?? 0)) continue;
      const resource = entity.source as ResourceDefinition;
      if (!(resource.resource_id in resources)) resources[resource.resource_id] = 1;
      if (!(resource.resource_id in maxResources)) maxResources[resource.resource_id] = 1;
    }
    await charactersV3Api.patchRuntime(character.id, { resources, max_resources: maxResources });
  }
}

export default function MobileEntityCatalog() {
  const navigate = useNavigate();
  const { id, type: rawType } = useParams<{ id: string; type?: string }>();
  const type = isCatalogType(rawType) ? rawType : null;
  const config = type ? CATALOGS.find((item) => item.key === type)! : null;
  const [character, setCharacter] = useState<ForgeCharacter | null>(null);
  const [entities, setEntities] = useState<CatalogEntity[]>([]);
  const [selection, setSelection] = useState<Record<string, number>>({});
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [preview, setPreview] = useState<CatalogEntity | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!id) return;
    let stale = false;
    charactersV3Api.get(id)
      .then((value) => { if (!stale) setCharacter(value); })
      .catch((reason) => { if (!stale) setError(describeError(reason)); });
    return () => { stale = true; };
  }, [id]);

  useEffect(() => {
    if (!type) {
      setLoading(false);
      return;
    }
    let stale = false;
    setLoading(true);
    setError(null);
    loadEntities(type, debouncedSearch)
      .then((items) => { if (!stale) setEntities(items); })
      .catch((reason) => { if (!stale) setError(describeError(reason)); })
      .finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [type, debouncedSearch]);

  const selectedEntities = useMemo(
    () => entities.filter((entity) => (selection[entity.id] ?? 0) > 0),
    [entities, selection],
  );
  const selectedCount = useMemo(
    () => Object.values(selection).reduce((sum, amount) => sum + amount, 0),
    [selection],
  );

  const selectedAlready = (entity: CatalogEntity): boolean => {
    if (!character || !type) return false;
    if (type === 'actions') return (character.action_ids ?? []).includes(entity.id);
    if (type === 'spells') return (character.spell_ids ?? []).includes(entity.id);
    if (type === 'feats') return !entity.repeatable && (character.feat_ids ?? []).includes(entity.id);
    if (type === 'effects') return !entity.repeatable && (character.effect_ids ?? []).includes(entity.id);
    if (type === 'resources') return (character.resource_ids ?? []).includes(entity.id);
    if (type === 'conditions') return false;
    return false;
  };

  const changeAmount = (entity: CatalogEntity, delta: number) => {
    if (selectedAlready(entity)) return;
    const supportsCopies = type === 'items'
      || type === 'conditions'
      || ((type === 'feats' || type === 'effects') && entity.repeatable);
    setSelection((current) => {
      const amount = Math.max(0, (current[entity.id] ?? 0) + delta);
      const nextAmount = supportsCopies ? amount : Math.min(1, amount);
      const next = { ...current };
      if (nextAmount === 0) delete next[entity.id];
      else next[entity.id] = nextAmount;
      return next;
    });
  };

  const apply = async () => {
    if (!character || !type || selectedCount === 0) return;
    setSaving(true);
    setError(null);
    try {
      await saveSelection(character, type, selectedEntities, selection);
      navigate(`/m/characters/${character.id}`, {
        replace: true,
        state: { notice: `${config?.title ?? 'Сущности'} добавлены` },
      });
    } catch (reason) {
      setError(describeError(reason));
      setConfirming(false);
    } finally {
      setSaving(false);
    }
  };

  if (!id) return null;

  if (!type) {
    return (
      <main className="m-app">
        <header className="m-page-header">
          <button className="m-icon-button" type="button" aria-label="Назад" onClick={() => navigate(`/m/characters/${id}`)}>
            <ArrowLeft size={20} />
          </button>
          <div className="m-catalog-title">
            <span className="m-eyebrow">Добавить персонажу</span>
            <h1>Выберите тип</h1>
          </div>
          <span className="m-overlay-header-spacer" />
        </header>
        <section className="m-page-body m-catalog-types">
          {CATALOGS.map(({ key, title, description, icon: Icon }) => (
            <button className="m-catalog-type" type="button" key={key} onClick={() => navigate(`/m/characters/${id}/add/${key}`)}>
              <span className="m-catalog-type-icon"><Icon size={22} /></span>
              <span><strong>{title}</strong><small>{description}</small></span>
              <ChevronRight size={19} />
            </button>
          ))}
        </section>
      </main>
    );
  }

  return (
    <main className="m-app m-catalog-page">
      <header className="m-page-header">
        <button className="m-icon-button" type="button" aria-label="Назад" onClick={() => navigate(`/m/characters/${id}/add`)}>
          <ArrowLeft size={20} />
        </button>
        <div className="m-catalog-title">
          <span className="m-eyebrow">{character?.name || 'Персонаж'}</span>
          <h1>{config?.title}</h1>
        </div>
        <span className="m-overlay-header-spacer" />
      </header>

      <section className="m-page-body">
        <label className="m-catalog-search">
          <Search size={18} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={`Найти: ${config?.title.toLocaleLowerCase('ru')}`}
          />
        </label>
        {error && <div className="m-inline-error">{error}</div>}
        {loading && <div className="m-loading">Загрузка…</div>}
        {!loading && !error && entities.length === 0 && <div className="m-empty-state">Ничего не найдено</div>}
        <div className="m-catalog-list">
          {entities.map((entity) => {
            const amount = selection[entity.id] ?? 0;
            const already = selectedAlready(entity);
            const supportsCopies = type === 'items'
              || type === 'conditions'
              || ((type === 'feats' || type === 'effects') && entity.repeatable);
            return (
              <article className={`m-catalog-card${amount ? ' is-selected' : ''}`} key={entity.id}>
                <button className="m-catalog-card-main" type="button" onClick={() => setPreview(entity)}>
                  {entity.imageUrl
                    ? <img src={entity.imageUrl} alt="" />
                    : <span className="m-catalog-image-fallback">{entity.name.slice(0, 1)}</span>}
                  <span>
                    <strong>{entity.name}</strong>
                    <small>{entity.meta || (entity.repeatable ? 'Можно выбрать несколько раз' : 'Открыть карточку')}</small>
                  </span>
                  <ChevronRight size={17} />
                </button>
                <div className="m-catalog-counter">
                  {already ? (
                    <span className="m-catalog-added">Уже добавлено</span>
                  ) : amount === 0 ? (
                    <button className="m-button" type="button" onClick={() => changeAmount(entity, 1)}>
                      <Plus size={17} /> Добавить
                    </button>
                  ) : (
                    <>
                      <button className="m-icon-button" type="button" aria-label="Уменьшить" onClick={() => changeAmount(entity, -1)}>
                        <Minus size={17} />
                      </button>
                      <strong>{amount}</strong>
                      {supportsCopies && (
                        <button className="m-icon-button" type="button" aria-label="Увеличить" onClick={() => changeAmount(entity, 1)}>
                          <Plus size={17} />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {selectedCount > 0 && (
        <div className="m-selection-bar">
          <span><strong>{selectedCount}</strong> выбрано</span>
          <button className="m-button m-button--gold" type="button" onClick={() => setConfirming(true)}>
            Продолжить
          </button>
        </div>
      )}

      {preview && <MobileOverlay title={preview.name} onClose={() => setPreview(null)}>
        {preview && (
          <>
            {preview.meta && <p className="m-entity-detail">{preview.meta}</p>}
            <div className="m-entity-description">{preview.description || 'Описание пока не добавлено.'}</div>
          </>
        )}
      </MobileOverlay>}

      {confirming && <MobileOverlay
        title="Подтвердите добавление"
        onClose={() => !saving && setConfirming(false)}
        footer={(
          <div className="m-confirm-actions">
            <button className="m-button" type="button" disabled={saving} onClick={() => setConfirming(false)}>Отмена</button>
            <button className="m-button m-button--gold" type="button" disabled={saving} onClick={apply}>
              {saving ? 'Сохраняем…' : 'Применить'}
            </button>
          </div>
        )}
      >
        <p>Будет добавлено: <strong>{selectedCount}</strong>.</p>
        <div className="m-confirm-list">
          {selectedEntities.map((entity) => (
            <p key={entity.id}><span>{entity.name}</span><strong>× {selection[entity.id]}</strong></p>
          ))}
        </div>
      </MobileOverlay>}
    </main>
  );
}
