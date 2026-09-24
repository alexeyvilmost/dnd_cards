import {useEffect, useState} from 'react';
import {Link, useNavigate} from 'react-router-dom';
import {characterTemplatesApi, type CharacterTemplate} from '../character/templatesApi';
import {charactersV3Api, characterV3ErrorMessage} from '../character/api';
import type {ForgeCharacterPreview} from '../character/types';
import {roguelikeApi} from '../roguelike/api';
import {useCombatDialogFocus} from './useCombatDialogFocus';
import './CharacterTemplateLibrary.css';
import RunCharacterIdentity from './RunCharacterIdentity';

export default function CharacterTemplateLibrary({forRun = false, runSelection}: {forRun?: boolean; runSelection?: {
  selectedIds: string[]; full: boolean; busy: boolean; onToggle: (template: CharacterTemplate) => void;
}}) {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<CharacterTemplate[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<CharacterTemplate | null>(null);
  const [name, setName] = useState('');
  const [createdCopy, setCreatedCopy] = useState<string | null>(null);
  const [edit, setEdit] = useState<CharacterTemplate | 'new' | null>(null);
  const [description, setDescription] = useState('');
  const [source, setSource] = useState('');
  const [sources, setSources] = useState<ForgeCharacterPreview[]>([]);
  const dialogRef = useCombatDialogFocus(Boolean(selected || edit));
  const refresh = async () => {
    const data = await characterTemplatesApi.list(); setTemplates(data.templates ?? []); setCanManage(data.can_manage);
  };
  useEffect(() => { void refresh().catch(e => setError(characterV3ErrorMessage(e, 'Не удалось загрузить шаблоны')))
    .finally(() => setLoading(false)); }, []);
  const openEditor = async (value: CharacterTemplate | 'new') => {
    setEdit(value); setName(value === 'new' ? '' : value.name); setDescription(value === 'new' ? '' : value.description);
    setSource(''); setError('');
    try {setSources((await charactersV3Api.listPreviews()).filter(c => c.access_mode === 'owner' && c.character_type !== 'dungeon_crawl' && !c.current_encounter_id));}
    catch (e) {setError(characterV3ErrorMessage(e, 'Не удалось загрузить листы'));}
  };
  const copy = async () => {
    if (!selected || !name.trim() || busy) return;
    setBusy(true); setError('');
    try {
      // If starting the run fails, retry with the same personal copy.
      const id = createdCopy ?? (await characterTemplatesApi.copy(selected.id, name.trim())).id;
      setCreatedCopy(id);
      if (forRun) {const run = await roguelikeApi.create(id); navigate(`/roguelike/${run.id}`);}
      else navigate(`/characters-v3/${id}`);
    } catch (e) {setError(characterV3ErrorMessage(e, 'Не удалось создать персонажа'));}
    finally {setBusy(false);}
  };
  const save = async () => {
    if (!edit || busy || !name.trim()) return;
    setBusy(true); setError('');
    try {
      const data = {name: name.trim(), description, ...(source ? {source_character_id: source} : {})};
      if (edit === 'new') await characterTemplatesApi.create(data);
      else await characterTemplatesApi.update(edit.id, {...data, version: edit.version});
      await refresh(); setEdit(null);
    } catch (e) {setError(characterV3ErrorMessage(e, 'Не удалось сохранить шаблон'));}
    finally {setBusy(false);}
  };
  return <section className={`character-template-library${forRun ? ' character-template-library--run' : ''}`}>
    {forRun ? <h3>Пресеты</h3> : <h2>Библиотека шаблонов</h2>}
    {!forRun && <p>Общие готовые листы. Копия с выбранным именем принадлежит вам; оригинал шаблона не изменяется.</p>}
    {loading && <p>Загрузка шаблонов…</p>}
    {error && <p role="alert">{error}</p>}
    <div className={forRun ? 'run-preset-list' : 'character-template-grid'}>
      {templates.filter(t => !forRun || t.preset_key).map(template => forRun && runSelection ? <label key={template.id} className="run-preset-row">
        <input type="checkbox" checked={runSelection.selectedIds.includes(template.id)}
          disabled={runSelection.busy || (runSelection.full && !runSelection.selectedIds.includes(template.id))}
          onChange={() => runSelection.onToggle(template)} />
        <RunCharacterIdentity character={template.character} name={template.name} />
      </label> : forRun ? <button key={template.id} type="button" className="run-preset-row"
        onClick={() => {setSelected(template); setName(template.name); setCreatedCopy(null); setError('');}}>
        <RunCharacterIdentity character={template.character} name={template.name} />
        <span className="run-preset-arrow" aria-hidden="true">→</span>
      </button> : <article className="roguelike-card" key={template.id}>
        {template.character.avatar_url && <img className="character-template-portrait" src={template.character.avatar_url} alt={template.name} />}
        <h3>{template.name}</h3><p>{template.description}</p>
        <p className="character-template-summary">Уровень {template.character.level} · Хиты {template.character.max_hp}</p>
        <button className="forge-btn" type="button" onClick={() => {setSelected(template); setName(template.name); setCreatedCopy(null); setError('');}}>
          {forRun ? 'Начать за пресет' : 'Создать копию'}
        </button>
        {canManage && !forRun && <button className="forge-btn ghost" type="button" onClick={() => void openEditor(template)}>Редактировать шаблон</button>}
      </article>)}
    </div>
    {!loading && templates.length === 0 && <p>Шаблонов пока нет.</p>}
    {canManage && !forRun && <button type="button" className="forge-btn ghost" onClick={() => void openEditor('new')}>Создать шаблон из листа</button>}
    {(selected || edit) && <div className="character-template-backdrop">
      <section ref={dialogRef} tabIndex={-1} className="character-template-dialog" role="dialog" aria-modal="true" aria-label={edit ? 'Редактирование шаблона' : 'Создание из шаблона'}
        onKeyDown={event => {if (event.key === 'Escape' && !busy) {event.stopPropagation(); setSelected(null); setEdit(null); setError('');}}}>
        <h3>{edit ? 'Общий шаблон' : 'Как зовут персонажа?'}</h3>
        <label>Имя<input autoFocus maxLength={100} value={name} disabled={busy || Boolean(createdCopy)} onChange={e => setName(e.target.value)} /></label>
        {edit && <>
          <label>Описание<textarea tabIndex={0} maxLength={2000} value={description} onChange={e => setDescription(e.target.value)} /></label>
          <label>Лист-источник<select value={source} onChange={e => setSource(e.target.value)}>
            <option value="">{edit === 'new' ? 'Выберите свой готовый лист' : 'Сохранить текущее содержимое'}</option>
            {sources.map(s => <option key={s.id} value={s.id}>{s.name} · уровень {s.level}</option>)}
          </select></label>
          <p>Подготовьте и проверьте свой лист в кузне, затем опубликуйте его здесь. Выбор источника заменит сборку шаблона, но не уже созданные копии.</p>
          <Link to="/character-forge">Открыть кузню</Link>
        </>}
        {error && <p role="alert">{error}</p>}
        <div className="character-template-dialog-actions">
          <button type="button" className="forge-btn" disabled={busy || !name.trim() || (edit === 'new' && !source)} onClick={() => void (edit ? save() : copy())}>
            {busy ? 'Сохраняем…' : edit ? 'Сохранить шаблон' : forRun ? 'Создать и начать забег' : 'Создать персонажа'}
          </button>
          <button type="button" className="forge-btn ghost" disabled={busy} onClick={() => {setSelected(null); setEdit(null); setError('');}}>Отмена</button>
        </div>
      </section>
    </div>}
  </section>;
}
