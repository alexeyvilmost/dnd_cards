import {useEffect,useRef,useState,type ReactNode} from 'react';
import {setEntityDisplay,setSetting,useSiteSettings,type SiteSettings} from '../settings';
import {usePassivePreferences} from '../character/passivePreferences';
import {decisionPolicyEnabled,decisionPolicyToggles} from '../solo-combat/decisionPolicies';
import CombatRollModeSelect from './CombatRollModeSelect';
import AudioSettings from '../audio/AudioSettings';
import './SettingsPanel.css';

const sections=[
  {id:'audio',title:'Звук и музыка'},
  {id:'combat',title:'Бой и поле'},
  {id:'combat-rolls',title:'Показ бросков в бою'},
  {id:'dice',title:'Другие броски кубов'},
  {id:'entities',title:'Отображение сущностей'},
  {id:'previews',title:'Превью и названия'},
  {id:'editing',title:'Лист и редактирование'},
] as const;
export type SettingsPage='home'|typeof sections[number]['id'];
type BooleanSetting={ [K in keyof SiteSettings]:SiteSettings[K] extends boolean ? K : never }[keyof SiteSettings];

export default function SettingsPanel({initialPage='home',onTestDice}:{initialPage?:SettingsPage;onTestDice?:()=>void}) {
  const settings=useSiteSettings();
  const [preferences,setPreference]=usePassivePreferences();
  const [active,setActive]=useState<SettingsPage>(initialPage);
  const anchors=useRef<Partial<Record<SettingsPage,HTMLElement|null>>>({});
  useEffect(()=>{
    if(initialPage==='home')return;
    const frame=requestAnimationFrame(()=>anchors.current[initialPage]?.scrollIntoView?.({block:'start'}));
    return ()=>cancelAnimationFrame(frame);
  },[initialPage]);
  const check=(key:BooleanSetting,label:string,hint:string,disabled=false)=><label className="settings-panel-check">
    <input type="checkbox" checked={settings[key]} disabled={disabled} onChange={event=>setSetting(key,event.target.checked)}/>
    <span>{label}<small>{hint}</small></span>
  </label>;
  const section=(id:SettingsPage,content:ReactNode)=><section key={id} id={`settings-section-${id}`}
    className="settings-panel__section" ref={element=>{anchors.current[id]=element;}} tabIndex={-1}>
    <h3>{sections.find(row=>row.id===id)?.title}</h3>{content}
  </section>;
  return <div className="settings-panel">
    <nav className="settings-panel__nav" aria-label="Разделы настроек">
      {sections.map(item=><button key={item.id} type="button" aria-current={active===item.id?'location':undefined}
        onClick={()=>{setActive(item.id);anchors.current[item.id]?.scrollIntoView?.({behavior:'smooth',block:'start'});anchors.current[item.id]?.focus({preventScroll:true});}}>
        {item.title}
      </button>)}
    </nav>
    <div className="settings-panel__content site-scrollbar">
      {section('audio',<AudioSettings/>)}
      {section('combat',<>
        {check('combat3d','Монетки на поле','Объёмное поле на фоне страницы. Камера смотрит строго сверху; поле можно сдвигать и масштабировать.')}
        {[...decisionPolicyToggles('roll_influence'),...decisionPolicyToggles('turn_start')].map(policy=><label className="settings-panel-check" key={policy.id}>
          <input type="checkbox" checked={decisionPolicyEnabled(policy,preferences)} onChange={event=>setPreference(policy.id,event.target.checked)}/>
          <span>{policy.name}<small>{policy.description}</small></span>
        </label>)}
      </>)}
      {section('combat-rolls',<><CombatRollModeSelect/><p>Режим выбирается отдельно для союзников и противников. Кубики на поле доступны при включённых монетках; исход берётся из сохранённого броска.</p></>)}
      {section('dice',<>
        <p>Проверки навыков и спасброски из листа всегда открываются с кнопкой «Бросить». Эти настройки управляют другими бросками.</p>
        {check('diceDialog','Диалог бросков кубов','Выбор автоброска или ввода своих кубов.')}
        {check('dice3d','Физические 3D-кубики','Сцена с физикой и столкновениями.')}
        {check('dice3dAutoThrow','Кидать 3D-кубики автоматически','Запускать бросок после загрузки сцены.',!settings.dice3d)}
        {onTestDice&&<button type="button" disabled={!settings.diceDialog&&!settings.dice3d} onClick={onTestDice}>Проверить бросок</button>}
      </>)}
      {section('entities',(['spells','actions','effects','items'] as const).map((kind,index)=><fieldset key={kind}>
        <legend>{['Заклинания','Действия','Эффекты','Предметы'][index]}</legend>
        {(['icon','row'] as const).map((mode,choice)=><label key={mode}><input type="radio" name={`display-${kind}`}
          checked={settings.entityDisplay[kind]===mode} onChange={()=>setEntityDisplay(kind,mode)}/>{['Иконки','Список'][choice]}</label>)}
      </fieldset>))}
      {section('previews',<>
        <fieldset><legend>Превью предмета при наведении</legend>{(['card','interface'] as const).map((mode,index)=><label key={mode}>
          <input type="radio" name="item-preview" checked={settings.itemPreview===mode} onChange={()=>setSetting('itemPreview',mode)}/>{['Карточка','Интерфейс'][index]}
        </label>)}</fieldset>
        {check('showReviewStatus','Статус проверки','Цветные уголки, фильтр и статистика статусов в библиотеках; изменение статуса в детальном превью.')}
        {check('showOriginalNames','Оригинальные названия','Показывать английское название в превью и детальных окнах.')}
      </>)}
      {section('editing',<>
        {check('playerMode','Режим игрока','Скрывать технические поля механики, сохраняя боевые характеристики.')}
        {check('allowSheetEntityAdditions','Ручное добавление в лист','Разрешить добавление предметов, действий, эффектов, заклинаний и черт.')}
      </>)}
      <p className="settings-panel-saved">Изменения сохраняются автоматически в этом браузере.</p>
    </div>
  </div>;
}
