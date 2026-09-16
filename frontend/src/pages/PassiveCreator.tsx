import {useEffect, useState} from 'react';
import {Link, useSearchParams} from 'react-router-dom';
import {usePassiveCatalog, savePassivePresentation, passivePresentationEffect, type PassivePresentation} from '../character/passiveCatalog';
import ImageUploader from '../components/ImageUploader';
import EffectPreview from '../components/EffectPreview';
import {FormattedTextarea} from '../components/FormattedTextarea';
import EntityTags from '../components/EntityTags';

export default function PassiveCreator() {
  const [params]=useSearchParams();
  const key=params.get('edit');
  const catalog=usePassiveCatalog();
  const source=catalog.passives.find(row=>row.key===key);
  const [draft,setDraft]=useState<PassivePresentation|undefined>(source);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  useEffect(()=>{setDraft(source);},[source]);
  if (!draft) return <p>{catalog.loading ? 'Загрузка оформления…' : catalog.error || 'Пассив не найден.'} <Link to="/?type=passives">В библиотеку</Link></p>;
  const field=(name:keyof PassivePresentation,value:string)=>setDraft({...draft,[name]:value});
  return <div className="space-y-5"><Link to="/?type=passives">← Переключаемые пассивы</Link>
    <h1 className="text-2xl font-fantasy">Конструктор пассива</h1>
    <EntityTags type="passive" id={draft.key}/>
    <p>Редактируется только оформление. Правила предложения выбора и сохранённые настройки игроков не меняются.</p>
    {catalog.error && <p role="alert">{catalog.error}</p>}
    <div className="grid md:grid-cols-2 gap-8"><form onSubmit={async event=>{event.preventDefault();if(!catalog.can_manage||busy)return;setBusy(true);setMessage('');try{await savePassivePresentation(draft);setMessage('Оформление сохранено.');}catch{setMessage('Не удалось сохранить. Проверьте доступ или откройте карточку заново.');}finally{setBusy(false);}}}>
      <fieldset disabled={!catalog.can_manage||busy} className="space-y-4">
        <label className="block">Название<input className="block w-full border rounded p-2" required maxLength={200} value={draft.name} onChange={e=>field('name',e.target.value)}/></label>
        {(['description','enabled_description','disabled_description'] as const).map((name,index)=><div key={name}><label htmlFor={`passive-${name}`} className="block">{['Описание','Когда включён','Когда выключен'][index]}</label><FormattedTextarea id={`passive-${name}`} rows={4} value={draft[name]} onChange={value=>field(name,value)}/></div>)}
        <label className="block">Адрес изображения<input className="block w-full border rounded p-2" value={draft.image_url} onChange={e=>field('image_url',e.target.value)}/></label>
        <ImageUploader currentImageUrl={draft.image_url} onImageUpload={url=>field('image_url',url)}/>
        <p className="text-sm">Пустое изображение наследуется от родительского действия в бою.</p>
        <button className="border rounded px-4 py-2" type="submit">{busy?'Сохранение…':'Сохранить'}</button>
      </fieldset>
      {!catalog.can_manage && <p>Изменять библиотеку может администратор.</p>}
      {message && <p role="status">{message}</p>}
    </form><EffectPreview effect={passivePresentationEffect(draft)} disableHover/></div>
  </div>;
}
