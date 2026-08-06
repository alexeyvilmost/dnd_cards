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
import { certifiedConditionEffectEntity } from '../api/conditionsApi';
import { charactersV3Api } from '../character/api';
import { expandItemGrantedEffects, loadAssembly } from '../character/assemble';
import { collectItemMechanics } from '../character/attunement';
import { buildSavePayload, characterToDraft } from '../character/forgeHelpers';
import { persistDetachedManualEffects } from '../character/manualEffectPersistence';
import {
  assertManualEffectMutationAllowed,
  manualEffectMutationBlockReason,
} from '../character/manualEffectMutationPolicy';
import { forgeToRuntimeState } from '../character/runtime';
import { collectPassiveMechanics } from '../character/resourceInit';
import {
  addManualEntities,
  FEAT_CATEGORY_LABELS,
  type ManualEntity,
  type ManualEntityType,
} from '../character/manualEntityAddition';
import { resolveCharacterRules } from '../character/rules/resolveCharacterRules';
import { isCharacterReadOnly, type ForgeCharacter } from '../character/types';
import type { EngineEvent } from '../mvp/contracts';
import { conditionLevel, conditionStacking } from '../engine/conditions';
import {
  applyEffectCommandFromEntity,
  collectConditionImmunitiesFromPassives,
  conditionIdFromEffectEntity,
  executeManualEffectCommand,
  nextBrowserManualEffectId,
} from '../engine/manualEffectCommands';
import type { Action, Card, Feat, PassiveEffect, ResourceDefinition, Spell } from '../types';
import { useSiteSettings } from '../settings';
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

export type CatalogType = typeof CATALOGS[number]['key'];
type SourceEntity = Card | Action | Spell | Feat | PassiveEffect | ResourceDefinition;

export const MOBILE_CONDITION_EVENT_JOURNAL_LIMITATION =
  'Ручные состояния на отдельном листе сохраняются в runtime, но их engine events пока не записываются атомарно в серверный журнал.';

export interface CatalogEntity {
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
  } else if (type === 'feats' && 'category' in source) {
    meta = FEAT_CATEGORY_LABELS[(source as Feat).category];
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
        : (response.effects ?? []).filter((entity) => {
          try {
            const conditionId = conditionIdFromEffectEntity(entity);
            return certifiedConditionEffectEntity(conditionId)?.id === entity.id;
          } catch {
            return false;
          }
        });
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

export async function saveMobileCatalogSelection(
  character: ForgeCharacter,
  type: CatalogType,
  entities: CatalogEntity[],
  selection: Record<string, number>,
  conditionFacts: { sourceActorId: string; causeTags: string },
): Promise<EngineEvent[]> {
  if (isCharacterReadOnly(character)) {
    throw new Error('Архивный публичный лист доступен только для чтения.');
  }
  if (type === 'items' || type === 'actions' || type === 'effects' || type === 'spells' || type === 'feats') {
    const manualType = type as ManualEntityType;
    await addManualEntities(character, manualType, entities.map((entity) => ({
      entity: {
        id: entity.id,
        name: entity.name,
        description: entity.description,
        imageUrl: entity.imageUrl,
        meta: entity.meta,
        repeatable: Boolean(entity.repeatable),
        source: entity.source as ManualEntity['source'],
      },
      amount: selection[entity.id] ?? 0,
    })));
    return [];
  }

  if (type === 'conditions') {
    assertManualEffectMutationAllowed(character.current_encounter_id);
    const draft = characterToDraft(character);
    const assembled = await loadAssembly(draft);
    let runtime = forgeToRuntimeState(character);
    const itemIds = [...new Set([
      ...(character.inventory_items ?? []).map((row) => row.card_id),
      ...Object.values(character.equipment ?? {}).filter((id): id is string => !!id),
    ])];
    const itemCards = await Promise.all(itemIds.map((itemId) => cardsApi.getCard(itemId)));
    const itemMechanics = collectItemMechanics(
      character.equipment ?? {},
      new Map(itemCards.map((card) => [card.id, card])),
      character.turn_state,
      runtime.inventory,
    );
    const itemGrantedEffects = await expandItemGrantedEffects(
      itemMechanics.map((item) => ({
        id: item.card.id,
        name: item.card.name,
        mechanics: item.mechanics,
      })),
      draft,
    );
    const passives = [
      ...collectPassiveMechanics(assembled, character.resolved_choices ?? {}),
      ...itemMechanics.map((item) => item.mechanics),
      ...itemGrantedEffects.flatMap((effect) => (
        effect.mechanics && typeof effect.mechanics === 'object'
          ? [{ ...effect.mechanics, id: effect.id, name: effect.name }]
          : []
      )),
    ];
    const conditionImmunities = collectConditionImmunitiesFromPassives(passives);
    const events: EngineEvent[] = [];
    for (const entity of entities) {
      const amount = selection[entity.id] ?? 0;
      if (!amount) continue;
      const conditionId = conditionIdFromEffectEntity(entity.source as never);
      const effect = certifiedConditionEffectEntity(conditionId);
      if (!effect || effect.id !== entity.id) {
        throw new Error('Сертифицированная карточка состояния из БД недоступна; изменение запрещено');
      }
      for (let index = 0; index < amount; index += 1) {
        const command = applyEffectCommandFromEntity(effect, 'manual:mobile_entity_catalog', {
          ownerActorId: character.id,
          conditionImmunities,
          causeTags: conditionFacts.causeTags.split(',').map((tag) => tag.trim()).filter(Boolean),
          ...(conditionFacts.sourceActorId.trim()
            ? { sourceActorId: conditionFacts.sourceActorId.trim() }
            : {}),
        });
        const result = executeManualEffectCommand(runtime, command, {
          nextId: nextBrowserManualEffectId,
        });
        runtime = result.state;
        events.push(...result.events);
      }
    }
    await persistDetachedManualEffects(character, runtime.activeEffects);
    return events;
  }

  const draft = characterToDraft(character);
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
  return [];
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
  const [conditionSourceActorId, setConditionSourceActorId] = useState('');
  const [conditionCauseTags, setConditionCauseTags] = useState('');
  const { allowSheetEntityAdditions } = useSiteSettings();
  const conditionMutationBlockReason = type === 'conditions'
    ? manualEffectMutationBlockReason(character?.current_encounter_id)
    : null;

  useEffect(() => {
    if (!allowSheetEntityAdditions && id) {
      navigate(`/m/characters/${id}`, { replace: true });
    }
  }, [allowSheetEntityAdditions, id, navigate]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!id) return;
    let stale = false;
    charactersV3Api.get(id)
      .then((value) => {
        if (stale) return;
        if (isCharacterReadOnly(value)) {
          navigate(`/m/characters/${value.id}`, {
            replace: true,
            state: { notice: 'Архивный публичный лист доступен только для чтения.' },
          });
          return;
        }
        setCharacter(value);
      })
      .catch((reason) => { if (!stale) setError(describeError(reason)); });
    return () => { stale = true; };
  }, [id, navigate]);

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
    if (type === 'conditions') {
      try {
        const conditionId = conditionIdFromEffectEntity(entity.source as never);
        const stacking = conditionStacking(conditionId);
        const level = conditionLevel(forgeToRuntimeState(character), conditionId);
        return stacking.mode === 'binary'
          ? level > 0
          : stacking.max != null && level >= stacking.max;
      } catch {
        // The strict interpreter reports malformed condition data on apply.
        return false;
      }
    }
    return false;
  };

  const changeAmount = (entity: CatalogEntity, delta: number) => {
    if (selectedAlready(entity)) return;
    const supportsCopies = type === 'items'
      || (type === 'conditions' && entity.repeatable)
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
    if (!allowSheetEntityAdditions || !character || !type || selectedCount === 0) return;
    setSaving(true);
    setError(null);
    try {
      const events = await saveMobileCatalogSelection(character, type, selectedEntities, selection, {
        sourceActorId: conditionSourceActorId,
        causeTags: conditionCauseTags,
      });
      const immuneCount = events.filter((event) => event.type === 'condition_immune').length;
      const outcomeNotice = immuneCount
        ? `Состояния обработаны: иммунитет предотвратил ${immuneCount}`
        : `${config?.title ?? 'Сущности'} добавлены`;
      navigate(`/m/characters/${character.id}`, {
        replace: true,
        state: {
          notice: type === 'conditions'
            ? `${outcomeNotice}. ${MOBILE_CONDITION_EVENT_JOURNAL_LIMITATION}`
            : outcomeNotice,
        },
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
        {conditionMutationBlockReason && (
          <div className="m-inline-error">{conditionMutationBlockReason}</div>
        )}
        {type === 'conditions' && !conditionMutationBlockReason && (
          <div
            className="m-empty-state"
            role="status"
            data-testid="mobile-condition-journal-limitation"
          >
            {MOBILE_CONDITION_EVENT_JOURNAL_LIMITATION}
          </div>
        )}
        {loading && <div className="m-loading">Загрузка…</div>}
        {!loading && !error && entities.length === 0 && <div className="m-empty-state">Ничего не найдено</div>}
        <div className="m-catalog-list">
          {entities.map((entity) => {
            const amount = selection[entity.id] ?? 0;
            const already = selectedAlready(entity);
            const supportsCopies = type === 'items'
              || (type === 'conditions' && entity.repeatable)
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
                    <button className="m-button" type="button" disabled={Boolean(conditionMutationBlockReason)} onClick={() => changeAmount(entity, 1)}>
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
          <button className="m-button m-button--gold" type="button" disabled={Boolean(conditionMutationBlockReason)} onClick={() => setConfirming(true)}>
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
            <button className="m-button m-button--gold" type="button" disabled={saving || Boolean(conditionMutationBlockReason)} onClick={apply}>
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
        {type === 'conditions' && (
          <>
            <label className="m-catalog-search">
              <span>ID источника</span>
              <input
                value={conditionSourceActorId}
                onChange={(event) => setConditionSourceActorId(event.target.value)}
                placeholder="Обязателен для реляционных состояний"
              />
            </label>
            <label className="m-catalog-search">
              <span>Теги причины</span>
              <input
                value={conditionCauseTags}
                onChange={(event) => setConditionCauseTags(event.target.value)}
                placeholder="например: magical, sleep"
              />
            </label>
          </>
        )}
      </MobileOverlay>}
    </main>
  );
}
