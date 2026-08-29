import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, Trash2 } from 'lucide-react';
import { actionsApi, effectsApi } from '../api/client';
import { imagesApi } from '../api/imagesApi';
import ImageUploader from '../components/ImageUploader';
import { monstersApi } from '../monsters/api';
import type { MonsterAbility, MonsterInput } from '../monsters/types';
import type { Action, PassiveEffect } from '../types';
import './MonsterLibrary.css';

const ABILITIES: Array<[MonsterAbility, string]> = [
  ['str', 'СИЛ'], ['dex', 'ЛВК'], ['con', 'ТЕЛ'], ['int', 'ИНТ'], ['wis', 'МДР'], ['cha', 'ХАР'],
];
const emptyMonster = (): MonsterInput => ({
  slug: '', name: '', name_en: '', description: '', size: 'medium', creature_type: 'humanoid',
  alignment: '', challenge_rating: '0', armor_class: 10, max_hp: 1, speed: 30,
  initiative_bonus: 0, proficiency_bonus: 2,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  action_ids: [], effect_ids: [], ai: { strategy: 'melee_chase', preferred_range_ft: 5 },
  token_url: '', source: '',
});

export function monsterPayloadForSave(form: MonsterInput, persistedTokenUrl: string): {
  localToken: string | null;
  payload: MonsterInput;
} {
  const localToken = form.token_url.startsWith('data:') ? form.token_url : null;
  return {
    localToken,
    payload: localToken ? { ...form, token_url: persistedTokenUrl } : form,
  };
}

export default function MonsterCreator() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [form, setForm] = useState<MonsterInput>(emptyMonster);
  const [actions, setActions] = useState<Action[]>([]);
  const [effects, setEffects] = useState<PassiveEffect[]>([]);
  const [filter, setFilter] = useState('');
  const [savedId, setSavedId] = useState<string | null>(id ?? null);
  const [persistedTokenUrl, setPersistedTokenUrl] = useState('');
  const [busy, setBusy] = useState(Boolean(id));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      actionsApi.getActions({ limit: 500 }), effectsApi.getEffects({ limit: 500 }),
      id ? monstersApi.get(id) : Promise.resolve(null),
    ]).then(([actionResponse, effectResponse, monster]) => {
      if (!active) return;
      setActions(actionResponse.actions);
      setEffects(effectResponse.effects);
      if (monster) {
        const { id: _id, support: _support, created_at: _created, updated_at: _updated, ...input } = monster;
        void _id; void _support; void _created; void _updated;
        setForm(input);
        setPersistedTokenUrl(input.token_url);
      }
    }).catch((reason) => setError(reason instanceof Error ? reason.message : 'Не удалось открыть конструктор'))
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [id]);

  const visibleActions = useMemo(() => actions.filter((action) => (
    !filter || `${action.name} ${action.card_number}`.toLowerCase().includes(filter.toLowerCase())
  )).slice(0, 80), [actions, filter]);
  const visibleEffects = useMemo(() => effects.filter((effect) => (
    !filter || `${effect.name} ${effect.card_number}`.toLowerCase().includes(filter.toLowerCase())
  )).slice(0, 80), [effects, filter]);
  const patch = <K extends keyof MonsterInput>(key: K, value: MonsterInput[K]) => setForm((current) => ({ ...current, [key]: value }));
  const toggle = (key: 'action_ids' | 'effect_ids', value: string) => patch(key, form[key].includes(value) ? form[key].filter((id) => id !== value) : [...form[key], value]);

  const save = async () => {
    setBusy(true); setError(null);
    try {
      const { localToken, payload } = monsterPayloadForSave(form, persistedTokenUrl);
      // Keep the last durable token until the separate object-storage upload
      // succeeds. A failed upload must not erase the existing monster image.
      let result = savedId ? await monstersApi.update(savedId, payload) : await monstersApi.create(payload);
      if (localToken) {
        const blob = await fetch(localToken).then((response) => response.blob());
        const uploaded = await imagesApi.uploadImage(
          'monster', result.id,
          new File([blob], 'monster-token.png', { type: blob.type || 'image/png' }),
        );
        result = { ...result, token_url: uploaded.image_url };
        setForm((current) => ({ ...current, token_url: uploaded.image_url }));
        setPersistedTokenUrl(uploaded.image_url);
      } else {
        setPersistedTokenUrl(result.token_url);
      }
      setSavedId(result.id);
      if (!id) navigate(`/monster-forge/${result.id}`, { replace: true });
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось сохранить монстра'); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!savedId || !window.confirm('Удалить монстра?')) return;
    await monstersApi.remove(savedId); navigate('/monsters');
  };

  return (
    <section className="monster-forge">
      <header className="monster-forge__header">
        <Link to="/monsters"><ArrowLeft size={18} /> Бестиарий</Link>
        <div><p className="monster-eyebrow">КОНСТРУКТОР STAT BLOCK</p><h1>{form.name || 'Новый монстр'}</h1></div>
        <div className="monster-forge__header-actions">
          {savedId && <button type="button" className="monster-danger" onClick={remove}><Trash2 size={16} /></button>}
          <button type="button" className="monster-primary" disabled={busy || !form.name || !form.slug} onClick={save}><Save size={16} /> {busy ? 'Сохранение…' : 'Сохранить'}</button>
        </div>
      </header>
      {error && <p className="monster-error" role="alert">{error}</p>}
      <div className="monster-forge__layout">
        <div className="monster-forge__main">
          <fieldset><legend>Идентичность</legend><div className="monster-form-grid">
            <label>Название<input value={form.name} onChange={(event) => patch('name', event.target.value)} /></label>
            <label>Название EN<input value={form.name_en ?? ''} onChange={(event) => patch('name_en', event.target.value)} /></label>
            <label>Slug<input value={form.slug} onChange={(event) => patch('slug', event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '-'))} /></label>
            <label>Тип<input value={form.creature_type} onChange={(event) => patch('creature_type', event.target.value)} /></label>
            <label>Размер<select value={form.size} onChange={(event) => patch('size', event.target.value)}><option value="tiny">Крошечный</option><option value="small">Маленький</option><option value="medium">Средний</option><option value="large">Большой</option><option value="huge">Огромный</option><option value="gargantuan">Громадный</option></select></label>
            <label>ПО<input value={form.challenge_rating} onChange={(event) => patch('challenge_rating', event.target.value)} /></label>
          </div><label>Описание<textarea value={form.description} onChange={(event) => patch('description', event.target.value)} /></label></fieldset>
          <fieldset><legend>Боевые параметры</legend><div className="monster-form-grid monster-form-grid--compact">
            <label>КЗ<input type="number" min={1} value={form.armor_class} onChange={(event) => patch('armor_class', Number(event.target.value))} /></label>
            <label>HP<input type="number" min={1} value={form.max_hp} onChange={(event) => patch('max_hp', Number(event.target.value))} /></label>
            <label>Скорость<input type="number" min={5} step={5} value={form.speed} onChange={(event) => patch('speed', Number(event.target.value))} /></label>
            <label>Инициатива<input type="number" value={form.initiative_bonus} onChange={(event) => patch('initiative_bonus', Number(event.target.value))} /></label>
            <label>Бонус мастерства<input type="number" min={1} value={form.proficiency_bonus} onChange={(event) => patch('proficiency_bonus', Number(event.target.value))} /></label>
          </div><div className="monster-abilities">{ABILITIES.map(([key, label]) => <label key={key}>{label}<input type="number" min={1} max={30} value={form.abilities[key]} onChange={(event) => patch('abilities', { ...form.abilities, [key]: Number(event.target.value) })} /></label>)}</div></fieldset>
          <fieldset><legend>Действия и эффекты</legend><input className="monster-filter" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Фильтр сущностей" /><div className="monster-pickers"><div><h3>Действия</h3>{visibleActions.map((action) => <label className="monster-check" key={action.id}><input type="checkbox" checked={form.action_ids.includes(action.id)} onChange={() => toggle('action_ids', action.id)} /><span>{action.name}<small>{action.card_number}</small></span></label>)}</div><div><h3>Эффекты</h3>{visibleEffects.map((effect) => <label className="monster-check" key={effect.id}><input type="checkbox" checked={form.effect_ids.includes(effect.id)} onChange={() => toggle('effect_ids', effect.id)} /><span>{effect.name}<small>{effect.card_number}</small></span></label>)}</div></div></fieldset>
        </div>
        <aside className="monster-forge__aside"><h2>Токен</h2><ImageUploader currentImageUrl={form.token_url} onImageUpload={(url) => patch('token_url', url)} entityType="monster" entityId={savedId ?? undefined} /><label>Или URL<input value={form.token_url} onChange={(event) => patch('token_url', event.target.value)} /></label><label>Источник<input value={form.source} onChange={(event) => patch('source', event.target.value)} /></label><p>Выбранный файл загружается вместе с сохранением монстра.</p><p>ИИ: приблизиться → атаковать, а если скорости не хватило — использовать Рывок.</p></aside>
      </div>
    </section>
  );
}
