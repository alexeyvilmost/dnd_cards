import { useState } from 'react';
import { setEntityDisplay, setSetting, useSiteSettings, type SiteSettings } from '../settings';
import CombatRollModeSelect from './CombatRollModeSelect';
import './SettingsPanel.css';

const pages = {
  home: { title: 'Все настройки', parent: 'home' },
  combat: { title: 'Бой и броски', parent: 'home' },
  display: { title: 'Отображение', parent: 'home' },
  sheet: { title: 'Лист персонажа', parent: 'home' },
  'combat-rolls': { title: 'Показ бросков в бою', parent: 'combat' },
  dice: { title: 'Другие броски кубов', parent: 'combat' },
  entities: { title: 'Отображение сущностей', parent: 'display' },
  previews: { title: 'Превью и названия', parent: 'display' },
  editing: { title: 'Режим и редактирование', parent: 'sheet' },
} as const;
export type SettingsPage = keyof typeof pages;
type BooleanSetting = { [K in keyof SiteSettings]: SiteSettings[K] extends boolean ? K : never }[keyof SiteSettings];

export default function SettingsPanel({ initialPage = 'home', onTestDice }: { initialPage?: SettingsPage; onTestDice?: () => void }) {
  const [page, setPage] = useState<SettingsPage>(initialPage);
  const settings = useSiteSettings();
  const check = (key: BooleanSetting, label: string, hint: string, disabled = false) => <label className="settings-panel-check">
    <input type="checkbox" checked={settings[key]} disabled={disabled} onChange={e => setSetting(key, e.target.checked)} />
    <span>{label}<small>{hint}</small></span>
  </label>;
  const children = (Object.keys(pages) as SettingsPage[]).filter(key => key !== 'home' && pages[key].parent === page);
  return <div className="settings-panel">
    <nav aria-label="Разделы настроек">{page !== 'home' && <><button type="button" onClick={() => setPage(pages[page].parent)}>← Назад</button><button type="button" onClick={() => setPage('home')}>Все настройки</button></>}</nav>
    <h3>{pages[page].title}</h3>
    {children.length > 0 && <div className="settings-panel-categories">{children.map(key => <button type="button" key={key} onClick={() => setPage(key)}>{pages[key].title}<span aria-hidden="true">→</span></button>)}</div>}
    {page === 'combat-rolls' && <><CombatRollModeSelect /><p>Режим зависит от владельца действия или эффекта, включая спасброски его целей. Стандарт — анимация и расчёт, быстрый режим — готовый результат, пропуск — результат на поле.</p></>}
    {page === 'dice' && <>
      <p>Проверки навыков и спасброски из листа всегда открываются с кнопкой «Бросить». Эти настройки управляют другими бросками.</p>
      {check('diceDialog', 'Диалог бросков кубов', 'Выбор автоброска или ввода своих кубов.')}
      {check('dice3d', 'Физические 3D-кубики', 'Сцена с физикой и столкновениями.')}
      {check('dice3dAutoThrow', 'Кидать 3D-кубики автоматически', 'Запускать бросок после загрузки сцены.', !settings.dice3d)}
      {onTestDice && <button type="button" disabled={!settings.diceDialog && !settings.dice3d} onClick={onTestDice}>Проверить бросок</button>}
    </>}
    {page === 'editing' && <>
      {check('playerMode', 'Режим игрока', 'Скрывать технические поля механики, сохраняя боевые характеристики.')}
      {check('allowSheetEntityAdditions', 'Ручное добавление в лист', 'Разрешить добавление предметов, действий, эффектов, заклинаний и черт.')}
    </>}
    {page === 'entities' && (['spells', 'actions', 'effects', 'items'] as const).map((kind, i) => <fieldset key={kind}><legend>{['Заклинания', 'Действия', 'Эффекты', 'Предметы'][i]}</legend>
      {(['icon', 'row'] as const).map((mode, j) => <label key={mode}><input type="radio" name={`display-${kind}`} checked={settings.entityDisplay[kind] === mode} onChange={() => setEntityDisplay(kind, mode)} />{['Иконки', 'Список'][j]}</label>)}
    </fieldset>)}
    {page === 'previews' && <>
      <fieldset><legend>Превью предмета при наведении</legend>{(['card', 'interface'] as const).map((mode, i) => <label key={mode}><input type="radio" name="item-preview" checked={settings.itemPreview === mode} onChange={() => setSetting('itemPreview', mode)} />{['Карточка', 'Интерфейс'][i]}</label>)}</fieldset>
      {check('showOriginalNames', 'Оригинальные названия', 'Показывать английское название в превью и детальных окнах.')}
    </>}
    <p className="settings-panel-saved">Изменения сохраняются автоматически в этом браузере.</p>
  </div>;
}
