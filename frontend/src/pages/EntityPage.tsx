import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiClient } from '../api/client';
import { RARITY_OPTIONS, SPELL_SCHOOL_OPTIONS, SPELL_CLASS_OPTIONS, getSpellLevelLabel, type Action, type Background, type Card, type CharacterClass, type Concept, type Feat, type PassiveEffect, type Race, type ResourceDefinition, type Spell, type Variable } from '../types';
import type { Monster } from '../monsters/types';
import { useContentPermissions } from '../hooks/useContentPermissions';
import { FormattedText } from '../utils/formattedText';
import HoverCard from '../components/HoverCard';
import CardPreview from '../components/CardPreview';
import ItemPreview from '../components/ItemPreview';
import SpellPreview from '../components/SpellPreview';
import ActionPreview from '../components/ActionPreview';
import EffectPreview from '../components/EffectPreview';
import FeatPreview from '../components/FeatPreview';
import BackgroundPreview from '../components/BackgroundPreview';
import RacePreview from '../components/RacePreview';
import ClassPreview from '../components/ClassPreview';
import ResourcePreview from '../components/ResourcePreview';
import VariablePreview from '../components/VariablePreview';
import ConceptPreview from '../components/ConceptPreview';
import MonsterPreview from '../components/MonsterPreview';
import EntityTags from '../components/EntityTags';
import type { TaggedEntityType } from '../api/entityTags';
import CurrencyPriceInline from '../components/CurrencyPriceInline';
import { passivePresentationEffect, savePassivePresentation, type PassivePresentation } from '../character/passiveCatalog';
import { getDamageTypeLabel, getPropertyLabel } from '../utils/propertyLabels';
import { allWeaponTypeOptions } from '../utils/weaponTypeCatalog';
import { parseMechanicsStats, abilityFullRu } from '../engine/describeMechanics';
import { getDamageColorOnDark, getDamageIconPath, getDamageLabel } from '../utils/damageTypes';
import { resourceLabel, useResourceOptions } from '../utils/resources';
import { useSiteSettings } from '../settings';
import './EntityPage.css';

type Entity = Record<string, unknown>;
type EntityKind = 'cards' | 'spells' | 'actions' | 'effects' | 'feats' | 'backgrounds' | 'races' | 'classes' | 'resources' | 'variables' | 'concepts' | 'monsters' | 'passives';
const LABELS: Record<EntityKind, string> = {
  cards: 'Предметы', spells: 'Заклинания', actions: 'Действия', effects: 'Эффекты',
  feats: 'Черты', backgrounds: 'Предыстории', races: 'Виды', classes: 'Классы',
  resources: 'Ресурсы', variables: 'Переменные', concepts: 'Понятия', monsters: 'Монстры', passives: 'Переключаемые пассивы',
};
const TAG_KIND: Record<EntityKind, TaggedEntityType> = {
  cards: 'card', spells: 'spell', actions: 'action', effects: 'effect', feats: 'feat',
  backgrounds: 'background', races: 'race', classes: 'class', resources: 'resource',
  variables: 'variable', concepts: 'concept', monsters: 'monster', passives: 'passive',
};
const FIELD_LABELS: Record<string, string> = {
  name: 'Название', name_en: 'Название на английском', description: 'Описание', detailed_description: 'Полное описание',
  image_url: 'Изображение', token_url: 'Токен', source: 'Источник', author: 'Автор', rarity: 'Редкость',
  card_number: 'Номер', level: 'Уровень', school: 'Школа', casting_time: 'Время накладывания', range: 'Дистанция',
  duration: 'Длительность', components: 'Компоненты', size: 'Размер', creature_type: 'Тип существа',
  challenge_rating: 'Показатель опасности', armor_class: 'КД', max_hp: 'Хиты', speed: 'Скорость',
  initiative_bonus: 'Инициатива', proficiency_bonus: 'Бонус мастерства', category: 'Категория',
  resource_id: 'Код ресурса', variable_id: 'Код переменной', concept_id: 'Код понятия',
  var_type: 'Тип', default_value: 'Значение по умолчанию', recharge: 'Восстановление',
  enabled_description: 'Когда включено', disabled_description: 'Когда выключено',
  price: 'Цена', weight: 'Вес', resource: 'Стоимость действия', effect_type: 'Тип эффекта',
  properties: 'Свойства', bonus_type: 'Тип бонуса', bonus_value: 'Значение бонуса', damage_type: 'Тип урона',
  type: 'Тип предмета', weapon_type: 'Вид оружия', slot: 'Место экипировки', mastery: 'Оружейное мастерство',
  attunement: 'Настройка', requires_attunement: 'Требуется настройка', max_uses: 'Использования',
  is_template: 'Шаблон', component_verbal: 'Вербальный компонент', component_somatic: 'Соматический компонент',
  component_material: 'Материальный компонент', material_text: 'Материалы', concentration: 'Концентрация',
  ritual: 'Ритуал', classes: 'Классы', subclasses: 'Подклассы', area: 'Область действия',
  heal_dice: 'Кости лечения', save_outcome: 'Результат спасброска', upcast_description: 'На высших уровнях',
  elemental_damage_value: 'Стихийный урон', elemental_damage_type: 'Тип стихийного урона',
  enchant_bonus: 'Бонус зачарования', defense_type: 'Тип защиты',
};
const EDIT_SKIP = new Set(['id', 'key', 'author', 'created_at', 'updated_at', 'deleted_at', 'support', 'tags', 'version', 'image_cloudinary_url', 'image_storage_id', 'token_storage_id']);
const VIEW_SKIP = new Set(['id', 'key', 'name', 'name_en', 'description', 'detailed_description', 'image_url', 'token_url', 'created_at', 'updated_at', 'deleted_at', 'support', 'tags', 'mechanics', 'ai', 'abilities', 'contents', 'battle_profile', 'image_storage_id', 'image_cloudinary_url', 'token_storage_id', 'price_currency', 'price_abbreviated', 'custom_rarity_color', 'description_font_size', 'text_alignment', 'text_font_size', 'show_detailed_description', 'detailed_description_alignment', 'detailed_description_font_size', 'is_extended']);
const COMPLEX_SKIP = new Set(['tags', 'properties', 'related_cards', 'related_actions', 'related_effects', 'related_spells', 'action_ids', 'effect_ids']);
const SPELL_FACT_SKIP = new Set(['level', 'school', 'casting_time', 'range', 'area', 'duration', 'concentration', 'ritual', 'component_verbal', 'component_somatic', 'component_material', 'material_text', 'classes', 'resources', 'damage', 'is_healing', 'heal_dice', 'save_outcome', 'upcast_description', 'source']);
const MAIN_FIELDS = ['name', 'name_en', 'description', 'detailed_description', 'image_url', 'token_url', 'source'];
const WEAPON_NAMES = new Map(allWeaponTypeOptions().map((option) => [option.id, option.label]));

const isKind = (value: string | undefined): value is EntityKind => Boolean(value && value in LABELS);
const asText = (value: unknown) => typeof value === 'string' ? value : '';
const imageOf = (entity: Entity) => asText(entity.image_url || entity.token_url || entity.image_cloudinary_url);
const pagePath = (kind: EntityKind, id: string) => kind === 'spells' ? `/spell/${encodeURIComponent(id)}` : `/entity/${kind}/${encodeURIComponent(id)}`;
const libraryPath = (kind: EntityKind) => kind === 'monsters' ? '/monsters' : `/?type=${kind}`;

function EntityImage({ src, name }: { src: string; name: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return src && !failed
    ? <img src={src} alt="" onError={() => setFailed(true)} />
    : <span aria-hidden="true">{name.slice(0, 1)}</span>;
}

async function loadEntity(kind: EntityKind, id: string): Promise<Entity> {
  if (kind === 'passives') {
    const { data } = await apiClient.get<{ passives: PassivePresentation[] }>('/api/passive-presentations');
    const row = data.passives.find((candidate) => candidate.key === id);
    if (!row) throw new Error('Сущность не найдена');
    return row as unknown as Entity;
  }
  const { data } = await apiClient.get<Entity>(`/api/${kind}/${encodeURIComponent(id)}`);
  return data;
}

function CanonicalPreview({ kind, entity }: { kind: EntityKind; entity: Entity }) {
  const asInterface = useSiteSettings().itemPreview === 'interface';
  switch (kind) {
    case 'cards': return asInterface ? <ItemPreview card={entity as unknown as Card} disableHover /> : <CardPreview card={entity as unknown as Card} disableHover />;
    case 'spells': return <SpellPreview spell={entity as unknown as Spell} disableHover />;
    case 'actions': return <ActionPreview action={entity as unknown as Action} disableHover />;
    case 'effects': return <EffectPreview effect={entity as unknown as PassiveEffect} disableHover />;
    case 'feats': return <FeatPreview feat={entity as unknown as Feat} disableHover />;
    case 'backgrounds': return <BackgroundPreview background={entity as unknown as Background} disableHover />;
    case 'races': return <RacePreview race={entity as unknown as Race} disableHover />;
    case 'classes': return <ClassPreview characterClass={entity as unknown as CharacterClass} disableHover />;
    case 'resources': return <ResourcePreview resource={entity as unknown as ResourceDefinition} disableHover />;
    case 'variables': return <VariablePreview variable={entity as unknown as Variable} disableHover />;
    case 'concepts': return <ConceptPreview concept={entity as unknown as Concept} disableHover />;
    case 'monsters': return <MonsterPreview monster={entity as unknown as Monster} />;
    case 'passives': return <EffectPreview effect={passivePresentationEffect(entity as unknown as PassivePresentation)} disableHover />;
  }
}

type Relation = { kind: EntityKind; id: string };
const RELATED_FIELDS: Record<string, EntityKind> = {
  related_cards: 'cards', related_actions: 'actions', related_effects: 'effects', related_spells: 'spells',
  action_ids: 'actions', effect_ids: 'effects', mastery: 'effects', parent_race_id: 'races', parent_class_id: 'classes',
};
const INLINE_REF = /\[\[[^\]|]+\|(card|spell|action|effect|concept|resource|variable|feat|background|race|class|monster):([^\]]+)\]\]/g;
const SINGULAR_KIND: Record<string, EntityKind> = {
  card: 'cards', spell: 'spells', action: 'actions', effect: 'effects', concept: 'concepts',
  resource: 'resources', variable: 'variables', feat: 'feats', background: 'backgrounds',
  race: 'races', class: 'classes', monster: 'monsters',
};
function relatedEntities(entity: Entity): Relation[] {
  const entries: Relation[] = [];
  for (const [field, kind] of Object.entries(RELATED_FIELDS)) {
    const value = entity[field];
    for (const id of Array.isArray(value) ? value : typeof value === 'string' ? [value] : []) {
      if (typeof id === 'string' && id.trim()) entries.push({ kind, id });
    }
  }
  for (const field of ['description', 'detailed_description', 'upcast_description', 'enabled_description', 'disabled_description']) {
    const value = asText(entity[field]);
    for (const match of value.matchAll(INLINE_REF)) entries.push({ kind: SINGULAR_KIND[match[1]], id: match[2] });
  }
  const mechanicKinds: Record<string, EntityKind> = {
    action_id: 'actions', action_ids: 'actions', effect_id: 'effects', effect_ids: 'effects',
    mastery_effect_id: 'effects', card_id: 'cards', card_ids: 'cards', spell_id: 'spells',
    spell_ids: 'spells', resource_id: 'resources', variable_id: 'variables', concept_id: 'concepts',
  };
  const inspect = (value: unknown, depth: number) => {
    if (!value || depth > 6 || entries.length > 32) return;
    if (Array.isArray(value)) { value.forEach((part) => inspect(part, depth + 1)); return; }
    if (typeof value !== 'object') return;
    for (const [field, part] of Object.entries(value)) {
      const kind = mechanicKinds[field];
      if (kind) for (const id of Array.isArray(part) ? part : [part]) {
        if (typeof id === 'string' && id.trim()) entries.push({ kind, id });
      }
      else inspect(part, depth + 1);
    }
  };
  inspect(entity.mechanics, 0);
  inspect(entity.battle_profile, 0);
  return [...new Map(entries.map((row) => [`${row.kind}:${row.id}`, row])).values()];
}

function RelatedIcon({ relation }: { relation: Relation }) {
  const [entity, setEntity] = useState<Entity | null>(null);
  useEffect(() => {
    let active = true;
    void loadEntity(relation.kind, relation.id).then((value) => { if (active) setEntity(value); }).catch(() => {});
    return () => { active = false; };
  }, [relation.kind, relation.id]);
  if (!entity) return null;
  const name = asText(entity.name) || LABELS[relation.kind];
  return <HoverCard content={<CanonicalPreview kind={relation.kind} entity={entity} />} className="entity-page__related-hover">
    <Link to={pagePath(relation.kind, asText(entity.id || entity.key) || relation.id)} className={`entity-page__icon ${relation.kind === 'passives' ? 'entity-page__icon--passive' : ''}`} aria-label={name}>
      <EntityImage src={imageOf(entity)} name={name} />
    </Link>
  </HoverCard>;
}

function visibleValue(key: string, value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (key === 'is_template' && (value === false || value === 'false')) return null;
  if (typeof value === 'boolean') return value ? 'Да' : null;
  if (Array.isArray(value)) return value.every((entry) => typeof entry !== 'object') ? value.map((entry) => key === 'properties' ? getPropertyLabel(String(entry)) : String(entry)).join(', ') : null;
  if (typeof value === 'object') return null;
  if (key === 'rarity') return RARITY_OPTIONS.find((option) => option.value === value)?.label || String(value);
  if (key === 'school') return SPELL_SCHOOL_OPTIONS.find((option) => option.value === value)?.label || String(value);
  if (key === 'damage_type') return getDamageTypeLabel(String(value));
  if (key === 'weapon_type') return WEAPON_NAMES.get(String(value)) || String(value);
  if (key === 'bonus_type') return ({ damage: 'Урон', defense: 'Защита' } as Record<string, string>)[String(value)] || String(value);
  if (key === 'is_template') return value === true || value === 'true' ? 'Да' : String(value);
  if (key === 'type') return ({ weapon: 'Оружие', armor: 'Доспех', item: 'Предмет', consumable: 'Расходуемый предмет' } as Record<string, string>)[String(value)] || String(value);
  if (key === 'slot') return ({ one_hand: 'Одна рука', two_hands: 'Две руки', versatile: 'Универсальное', body: 'Тело', head: 'Голова', ring: 'Кольцо', neck: 'Шея', cloak: 'Плащ' } as Record<string, string>)[String(value)] || String(value);
  return String(value);
}

function SpellSummary({ spell }: { spell: Spell }) {
  const resourceOptions = useResourceOptions();
  const mechanics = parseMechanicsStats((spell.mechanics || null) as Record<string, unknown> | null);
  const classes = (spell.classes || []).map((entry) => SPELL_CLASS_OPTIONS.find((option) => option.value === entry)?.label || entry);
  const resources = (spell.resources || []).map((entry) => resourceLabel(resourceOptions, entry));
  const damage = mechanics.damage.length ? mechanics.damage : (spell.damage || []).map((entry) => ({ value: entry.dice, type: entry.damage_type }));
  const healing = mechanics.heal.length ? mechanics.heal : spell.is_healing && spell.heal_dice ? [spell.heal_dice] : [];
  const components = [spell.component_verbal && 'В', spell.component_somatic && 'С', spell.component_material && 'М'].filter(Boolean).join(', ');
  const row = (label: string, value: ReactNode) => value ? <div className="entity-page__spell-row" key={label}><span>{label}</span><strong>{value}</strong></div> : null;
  return <section className="entity-page__panel entity-page__spell"><h2>Заклинание</h2>
    {row('Уровень', getSpellLevelLabel(spell.level))}
    {row('Школа', SPELL_SCHOOL_OPTIONS.find((option) => option.value === spell.school)?.label || spell.school)}
    {row('Время', spell.casting_time)}{row('Дистанция', spell.range)}{row('Область', spell.area)}{row('Длительность', spell.duration)}
    {spell.concentration && row('Концентрация', 'Да')}{spell.ritual && row('Ритуал', 'Да')}
    {row('Компоненты', `${components || '—'}${spell.component_material && spell.material_text ? ` (${spell.material_text})` : ''}`)}
    {mechanics.attack && row('Атака', 'к20 + бонус атаки заклинателя')}
    {mechanics.save && row('Спасбросок', `${abilityFullRu(mechanics.saveAbility) || 'Характеристика'} · СЛ заклинателя`)}
    {damage.length > 0 && row('Урон', <span className="entity-page__damage">{damage.map((entry, index) => <span key={`${entry.type}-${index}`} style={{ color: getDamageColorOnDark(entry.type) }}>
      {index > 0 && ' + '}{String(entry.value).replace(/(\d)[dд](\d)/gi, '$1к$2')} <img src={getDamageIconPath(entry.type)} alt="" /> {getDamageLabel(entry.type).toLowerCase()}
    </span>)}</span>)}
    {healing.length > 0 && row('Лечение', healing.join(' + ').replace(/(\d)[dд](\d)/gi, '$1к$2'))}
    {row('Классы', classes.join(', '))}{row('Ресурсы', resources.join(', '))}{row('Источник', spell.source)}
  </section>;
}

export default function EntityPage({ fixedType }: { fixedType?: EntityKind }) {
  const { type, id } = useParams<{ type: string; id: string }>();
  const kind = fixedType ?? (isKind(type) ? type : null);
  const navigate = useNavigate();
  const { playerMode } = useSiteSettings();
  const { canEdit } = useContentPermissions();
  const [entity, setEntity] = useState<Entity | null>(null);
  const [draft, setDraft] = useState<Entity | null>(null);
  const [complexText, setComplexText] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setEntity(null); setDraft(null); setEditing(false); setError(null);
    if (kind && id) void loadEntity(kind, id).then((value) => { if (active) { setEntity(value); setDraft(value); } })
      .catch(() => { if (active) setError('Сущность не найдена или недоступна'); });
    return () => { active = false; };
  }, [kind, id]);

  const shown = (editing ? draft : entity) || entity;
  const canManage = Boolean(shown && (kind === 'passives' ? canEdit({}) : canEdit(shown as { author?: string })));
  const relations = useMemo(() => shown ? relatedEntities(shown) : [], [shown]);
  const editKeys = useMemo(() => entity ? Object.keys(entity).filter((key) => !EDIT_SKIP.has(key) && !key.startsWith('image_cloudinary_')) : [], [entity]);
  const extraKeys = editKeys.filter((key) => !MAIN_FIELDS.includes(key));
  const setField = (key: string, value: unknown) => setDraft((current) => current ? { ...current, [key]: value } : current);
  const editField = (key: string) => {
    if (!draft) return null;
    const value = draft[key];
    const label = FIELD_LABELS[key] || key.replaceAll('_', ' ');
    if (Array.isArray(value) || (value !== null && typeof value === 'object')) {
      const text = complexText[key] ?? JSON.stringify(value, null, 2);
      return <label key={key} className="entity-page__field"><span>{label}</span><textarea value={text} rows={4}
        onChange={(event) => {
          const raw = event.target.value;
          setComplexText((current) => ({ ...current, [key]: raw }));
          try { setField(key, JSON.parse(raw)); } catch { /* Keep last valid live preview until JSON is complete. */ }
        }} /></label>;
    }
    if (typeof value === 'boolean') return <label key={key} className="entity-page__check"><input type="checkbox" checked={value} onChange={(event) => setField(key, event.target.checked)} />{label}</label>;
    if (typeof value === 'number') return <label key={key} className="entity-page__field"><span>{label}</span><input type="number" value={value} onChange={(event) => setField(key, Number(event.target.value))} /></label>;
    const multiline = key.includes('description') || key.endsWith('_text');
    return <label key={key} className="entity-page__field"><span>{label}</span>{multiline
      ? <textarea rows={key === 'detailed_description' ? 8 : 4} value={asText(value)} onChange={(event) => setField(key, event.target.value)} />
      : <input value={asText(value)} onChange={(event) => setField(key, event.target.value)} />}</label>;
  };

  const save = async () => {
    if (!kind || !id || !draft || !canManage) return;
    for (const raw of Object.values(complexText)) {
      try { JSON.parse(raw); } catch { setError('Проверьте формат JSON в дополнительных полях'); return; }
    }
    setBusy(true); setError(null);
    try {
      let updated: Entity;
      if (kind === 'passives') updated = await savePassivePresentation(draft as unknown as PassivePresentation) as unknown as Entity;
      else {
        const body = Object.fromEntries(Object.entries(draft).filter(([key]) => !EDIT_SKIP.has(key)));
        updated = (await apiClient.put<Entity>(`/api/${kind}/${encodeURIComponent(id)}`, body)).data;
      }
      setEntity(updated); setDraft(updated); setComplexText({}); setEditing(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось сохранить изменения'); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!kind || !id || !canManage || kind === 'passives' || !window.confirm('Удалить эту сущность?')) return;
    setBusy(true); setError(null);
    try { await apiClient.delete(`/api/${kind}/${encodeURIComponent(id)}`); navigate(libraryPath(kind)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось удалить сущность'); setBusy(false); }
  };
  const openRelated = (type: string, refID: string) => {
    const relatedKind = SINGULAR_KIND[type];
    if (relatedKind) navigate(pagePath(relatedKind, refID));
  };

  if (!kind || !id) return <div className="entity-page entity-page--center">Неизвестный тип сущности</div>;
  if (error && !entity) return <div className="entity-page entity-page--center">{error} <Link to={libraryPath(kind)}>Вернуться в библиотеку</Link></div>;
  if (!shown) return <div className="entity-page entity-page--center">Загрузка…</div>;
  const name = asText(shown.name) || 'Без названия';
  const image = imageOf(shown);
  const technical = Object.fromEntries(Object.entries(shown).filter(([key, value]) =>
    value && typeof value === 'object' && !COMPLEX_SKIP.has(key),
  ));

  return <div className="entity-page">
    <div className="entity-page__inner">
      <header className="entity-page__head">
        <Link to={libraryPath(kind)} className="entity-page__back">← {LABELS[kind]}</Link>
        <div className="entity-page__head-row"><div><h1>{name}</h1>{Boolean(shown.name_en) && <p>{String(shown.name_en)}</p>}</div>
          {canManage && <div className="entity-page__actions">
            {editing ? <><button type="button" onClick={() => { setDraft(entity); setComplexText({}); setEditing(false); setError(null); }} disabled={busy}>Отмена</button><button type="button" className="entity-page__primary" onClick={save} disabled={busy}>Сохранить</button></>
              : <button type="button" onClick={() => setEditing(true)}>Редактировать</button>}
            {!editing && kind !== 'passives' && <button type="button" className="entity-page__danger" onClick={remove} disabled={busy}>Удалить</button>}
          </div>}
        </div>
      </header>
      {error && <p role="alert" className="entity-page__error">{error}</p>}
      <div className="entity-page__columns">
        <main className="entity-page__main">
          {editing && <section className="entity-page__panel entity-page__editor"><h2>Изменить сущность</h2><p>Предпросмотр справа и описание ниже обновляются по мере ввода.</p>
            {MAIN_FIELDS.filter((key) => editKeys.includes(key)).map(editField)}
            <details><summary>Дополнительные поля и механика</summary>{extraKeys.map(editField)}</details>
          </section>}
          <section className="entity-page__panel"><h2>Описание</h2><div className="entity-page__prose"><FormattedText text={asText(shown.description)} emptyText="Описание не добавлено" onOpenRef={openRelated} /></div></section>
          {kind === 'spells' && asText(shown.upcast_description).trim() && <section className="entity-page__panel"><h2>На высших уровнях</h2><div className="entity-page__prose"><FormattedText text={asText(shown.upcast_description)} onOpenRef={openRelated} /></div></section>}
          {kind === 'spells' && asText(shown.save_outcome).trim() && <section className="entity-page__panel"><h2>Результат спасброска</h2><div className="entity-page__prose"><FormattedText text={asText(shown.save_outcome)} onOpenRef={openRelated} /></div></section>}
          {asText(shown.detailed_description).trim() && <section className="entity-page__panel"><h2>Подробно</h2><div className="entity-page__prose"><FormattedText text={asText(shown.detailed_description)} onOpenRef={openRelated} /></div></section>}
          {kind === 'passives' && <section className="entity-page__panel"><h2>Состояния</h2><p>Включено: <FormattedText text={asText(shown.enabled_description)} onOpenRef={openRelated} /></p><p>Выключено: <FormattedText text={asText(shown.disabled_description)} onOpenRef={openRelated} /></p></section>}
          {Object.keys(technical).length > 0 &&
            <details className="entity-page__panel"><summary>Механика и дополнительные данные</summary><pre>{JSON.stringify(technical, null, 2)}</pre></details>}
        </main>
        <aside className="entity-page__side">
          {image && <div className="entity-page__art" role="img" aria-label={name}><EntityImage src={image} name={name} /></div>}
          {kind === 'spells' && <SpellSummary spell={shown as unknown as Spell} />}
          <section className="entity-page__panel"><h2>В библиотеке</h2><HoverCard content={<CanonicalPreview kind={kind} entity={shown} />} className="entity-page__own-hover">
            <span className={`entity-page__icon ${kind === 'passives' ? 'entity-page__icon--passive' : ''}`} role="img" aria-label={`Превью: ${name}`}><EntityImage src={image} name={name} /></span>
          </HoverCard>
          {relations.length > 0 && <><h3>См. также</h3><div className="entity-page__related">{relations.map((relation) => <RelatedIcon key={`${relation.kind}:${relation.id}`} relation={relation} />)}</div></>}
          </section>
          <section className="entity-page__panel entity-page__facts"><h2>Сведения</h2>{Object.entries(shown).filter(([key, value]) => !VIEW_SKIP.has(key) && !(kind === 'spells' && SPELL_FACT_SKIP.has(key)) && !RELATED_FIELDS[key] && visibleValue(key, value)).map(([key, value]) =>
            <div key={key}><span>{FIELD_LABELS[key] || key.replaceAll('_', ' ')}</span><strong>{key === 'price' && typeof value === 'number'
              ? <CurrencyPriceInline price={value} currency={asText(shown.price_currency)} abbreviate={shown.price_abbreviated !== false} iconClassName="entity-page__coin" />
              : visibleValue(key, value)}</strong></div>)}</section>
          {!playerMode && <section className="entity-page__panel"><EntityTags type={TAG_KIND[kind]} id={asText(shown.id || shown.key) || id} /></section>}
        </aside>
      </div>
    </div>
  </div>;
}
