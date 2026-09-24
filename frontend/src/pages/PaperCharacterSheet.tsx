import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, FilePlus2, HelpCircle, Printer, Settings2, Upload } from 'lucide-react';
import { cardsApi } from '../api/client';
import { ABILITIES, SKILLS, SKILL_ABILITY } from '../character/rules/foundation';
import { calculateSheet, createPaperSheet, exportPaperSheet, importPaperSheet, loadPaperSheet, savePaperSheet, type PaperSheetDocument } from '../paper-sheet/model';
import { Check, Dialog, Field, FieldSettings, FormulaHelp, Frame, Note, PaperSheetContext, usePaperSheet } from '../paper-sheet/controls';
import { NotesPage, SpellPage, StoryPage } from '../paper-sheet/SecondaryPages';
import { Weapons } from '../paper-sheet/Weapons';
import { paperEquipmentEffectsKey, projectPaperEquipment, referencedPaperItemIds, startPaperEquipmentEffectLoad, type PaperGrantedEffectSnapshot } from '../paper-sheet/equipmentEffects';
import type { Card } from '../types';
import { attachLssSpells, exportLssSheet, importSheetJSON, paperExtraSections } from '../paper-sheet/lssExchange';
import { buildPrintSnapshot, downloadPaperPDF } from '../paper-sheet/print';
import '../paper-sheet/PaperCharacterSheet.css';
import '../paper-sheet/print.css';

function Identity() {
  const { doc, setField } = usePaperSheet();
  return <div className="ps-identity-row">
    <div className="ps-identity"><div className="ps-identity-fields">
      {[['name', 'Имя персонажа'], ['background', 'Предыстория'], ['class', 'Класс'], ['species', 'Вид'], ['subclass', 'Подкласс']].map(([key, label]) => <label key={key} className={`ps-line-label ps-id-${key}`}><Field field={key} label={label} /><span>{label}</span></label>)}
    </div><div className="ps-level"><label><Field field="level" label="Уровень" /><span>Уровень</span></label><label className="ps-xp"><Field field="xp" label="Опыт" /><span>Опыт</span></label></div></div>
    <div className="ps-armor"><div className="ps-shield"><h2>КД</h2><FieldSettings field="ac" label="КД" /><Field field="ac" label="КД" /><span>Щит</span><Check field="shield" label="Щит" diamond /></div></div>
    <div className="ps-vitals">
      <div className="ps-hp"><h2>Хиты</h2><div className="ps-hp-fields"><label className="ps-hp-current ps-line-label"><Field field="hpCurrent" label="Текущие хиты" /><span>Текущие</span></label><div><label className="ps-line-label"><Field field="hpTemp" label="Временные хиты" /><span>Временные</span></label><label className="ps-line-label"><Field field="hpMax" label="Максимум хитов" /><span>Максимум</span></label></div></div></div>
      <div className="ps-hit-dice"><h2>Кости<br />хитов</h2><div className="ps-dice-values"><Field field="hitDiceCurrent" label="Текущие кости хитов" /><span>/</span><Field field="hitDiceMax" label="Максимум костей хитов" /></div><span className="ps-tiny">Текущие</span><select aria-label="Кость хитов" value={doc.fields.hitDie ?? ''} onChange={event => setField('hitDie', event.target.value)}><option value=""></option>{['d6', 'd8', 'd10', 'd12'].map(die => <option key={die}>{die}</option>)}</select><span className="ps-tiny">Кость</span></div>
      <div className="ps-death"><h2>Спасброски<br />от смерти</h2>{[['success', 'Успехи'], ['failure', 'Провалы']].map(([key, label]) => <div key={key}><div className="ps-death-checks">{[1, 2, 3].map(n => <Check key={n} field={`death.${key}.${n}`} label={`${label}: ${n}`} diamond />)}</div><span>{label}</span></div>)}</div>
    </div>
  </div>;
}

function Training({ trainingKey, label, save = false }: { trainingKey: string; label: string; save?: boolean }) {
  const { doc, setDoc } = usePaperSheet();
  const value = doc.training[trainingKey] ?? 0;
  const key = save ? trainingKey : `skill.${trainingKey}`;
  return <div className={`ps-skill ${save ? 'ps-saving' : ''}`}>
    <button type="button" className={`ps-training ps-training-${value}`} aria-label={`Владение: ${label}`} aria-description={`Сейчас: ${['нет владения', 'владение', 'компетентность'][value]}. Нажмите для переключения.`} onClick={() => setDoc(current => ({ ...current, training: { ...current.training, [trainingKey]: ((value + 1) % (save ? 2 : 3)) as 0 | 1 | 2 } }))}><span /></button>
    <Field field={key} label={`Бонус: ${label}`} signed /><span>{save ? 'Спасбросок' : label}</span>
  </div>;
}

function Ability({ ability }: { ability: string }) {
  const label = ABILITIES.find(item => item.id === ability)?.label ?? ability;
  return <Frame className={`ps-ability ps-ability-${ability}`}><h2 className="ps-ability-heading">{label}</h2><FieldSettings field={ability} label={label} />
    <div className="ps-ability-values"><div className="ps-modifier"><Field field={`${ability}Mod`} label={`Модификатор: ${label}`} signed /><span>Модификатор</span></div><div className="ps-score"><Field field={ability} label={label} /><span>Значение</span></div></div>
    <Training trainingKey={`save.${ability}`} label={`Спасбросок ${label}`} save />
    {SKILLS.filter(item => SKILL_ABILITY[item.id] === ability).sort((a, b) => (a.id === 'investigation' ? 'Анализ' : a.label).localeCompare(b.id === 'investigation' ? 'Анализ' : b.label, 'ru')).map(skill => <Training key={skill.id} trainingKey={skill.id} label={skill.id === 'investigation' ? 'Анализ' : skill.label} />)}
  </Frame>;
}

function Proficiencies() {
  return <Note section="proficiencies" heading="Владение снаряжением и умения" className="ps-proficiencies">
    <div className="ps-proficiency-options">{[
      ['Доспехи', [['lightArmor', 'Лёгкие'], ['mediumArmor', 'Средние'], ['heavyArmor', 'Тяжёлые'], ['shield', 'Щит']]],
      ['Оружие', [['simpleWeapons', 'Простое'], ['martialWeapons', 'Воинское'], ['otherWeapons', 'Другое']]],
    ].map(([heading, items]) => <div key={heading as string}><span>{heading as string}</span>{(items as string[][]).map(([key, label]) => <label key={key}><Check field={`proficiency.${key}`} label={`Владение: ${label}`} diamond />{label}</label>)}</div>)}<p>Владение инструментами и языками</p></div>
  </Note>;
}

function MainPage() {
  return <><Identity /><div className="ps-wordmark"><span>Bag of Holding</span></div>
    <div className="ps-main-body"><div className="ps-left-block"><div className="ps-abilities"><div className="ps-physical">
      <Frame heading="Бонус владения" className="ps-proficiency"><Field field="proficiency" label="Бонус владения" signed /></Frame>
      <Ability ability="str" /><Ability ability="dex" /><Ability ability="con" />
      <Frame heading="Истощение" className="ps-exhaustion"><div>{[1, 2, 3, 4, 5, 6].map(n => <Check key={n} field={`exhaustion.${n}`} label={`Истощение ${n}`} />)}</div></Frame>
      <Frame heading="Героическое вдохновение" className="ps-inspiration"><div><Check field="inspiration" label="Героическое вдохновение" /></div></Frame>
    </div><div className="ps-mental"><Ability ability="int" /><Ability ability="wis" /><Ability ability="cha" /></div></div><Proficiencies /></div>
    <div className="ps-right-block"><div className="ps-quick-stats">{[['initiative', 'Инициатива'], ['speed', 'Скорость'], ['passive', 'П. восприятие']].map(([key, label]) => <Frame key={key} heading={label}><FieldSettings field={key} label={label} /><Field field={key} label={label} signed={key === 'initiative'} /></Frame>)}<Frame heading="Состояния"><Field field="conditions" label="Состояния" /></Frame></div>
      <Weapons /><Note section="features" heading="Умения и способности" className="ps-main-features" /><div className="ps-bottom-notes"><Note section="attacks" heading="Атаки и заклинания" /><Note section="traits" heading="Черты" /></div>
    </div></div>
  </>;
}

const PAGES = [{ id: 'main', name: 'Персонаж', Component: MainPage }, { id: 'story', name: 'История', Component: StoryPage }, { id: 'notes', name: 'Заметки', Component: NotesPage }, { id: 'spells', name: 'Заклинания', Component: SpellPage }];

export default function PaperCharacterSheet({ initialDocument, onDocumentChange, remoteSaveStatus, remoteSaveError }: {
  initialDocument?: PaperSheetDocument;
  onDocumentChange?: (document: PaperSheetDocument) => void;
  remoteSaveStatus?: string;
  remoteSaveError?: string;
} = {}) {
  const [initial] = useState(() => initialDocument ? { document: initialDocument, error: undefined } : loadPaperSheet());
  const [doc, setDoc] = useState(initial.document);
  const [saveError, setSaveError] = useState(initial.error ?? '');
  const [message, setMessage] = useState('');
  const [activePage, setActivePage] = useState('main');
  const [allPages, setAllPages] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [pendingImport, setPendingImport] = useState<ReturnType<typeof importPaperSheet> | null>(null);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [pdfBusy, setPdfBusy] = useState(false);
  const printSnapshot = useRef<HTMLElement | null>(null);
  const [zoom, setZoom] = useState(100);
  const [availableWidth, setAvailableWidth] = useState(880);
  const [itemCards, setItemCards] = useState<Map<string, Card>>(() => new Map());
  const [itemLoadError, setItemLoadError] = useState('');
  const [itemLoading, setItemLoading] = useState(false);
  const [itemReload, setItemReload] = useState(0);
  const [grantedEffects, setGrantedEffects] = useState<PaperGrantedEffectSnapshot | null>(null);
  const [effectLoadError, setEffectLoadError] = useState('');
  const [effectReload, setEffectReload] = useState(0);
  const lastSavedDocument = useRef(initial.document);
  const workspace = useRef<HTMLDivElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const spellImportInput = useRef<HTMLInputElement>(null);
  const itemIds = useMemo(() => referencedPaperItemIds(doc), [doc]);
  const itemIdsKey = itemIds.join('|');
  useEffect(() => {
    const missing = itemIds.filter(id => !itemCards.has(id));
    if (!missing.length) { setItemLoading(false); setItemLoadError(''); return; }
    let cancelled = false;
    setItemLoading(true);
    setItemLoadError('');
    Promise.allSettled(missing.map(id => cardsApi.getCard(id))).then(results => {
      if (cancelled) return;
      const loaded = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
      if (loaded.length) setItemCards(current => new Map([...current, ...loaded.map(card => [card.id, card] as const)]));
      setItemLoadError(results.some(result => result.status === 'rejected') ? 'Не удалось загрузить часть предметов. Их бонусы пока не учитываются.' : '');
      setItemLoading(false);
    });
    return () => { cancelled = true; };
  }, [itemIdsKey, itemReload]);
  const effectsKey = paperEquipmentEffectsKey(doc, itemCards);
  useEffect(() => {
    setEffectLoadError('');
    return startPaperEquipmentEffectLoad(doc, itemCards, setGrantedEffects,
      () => setEffectLoadError('Не удалось загрузить эффекты снаряжения. Их бонусы пока не учитываются.'));
  }, [effectsKey, effectReload]);
  const equipment = useMemo(() => projectPaperEquipment(doc, itemCards, grantedEffects), [doc, itemCards, grantedEffects]);
  const calculations = useMemo(() => calculateSheet(doc, equipment), [doc, equipment]);
  const setField = (key: string, value: string) => setDoc(current => ({ ...current, fields: { ...current.fields, [key]: value } }));
  useEffect(() => {
    if (lastSavedDocument.current === doc) return;
    lastSavedDocument.current = doc;
    if (onDocumentChange) onDocumentChange(doc);
    else setSaveError(savePaperSheet(doc).error ?? '');
  }, [doc, onDocumentChange]);
  useEffect(() => {
    const element = workspace.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => setAvailableWidth(entries[0].contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const scale = Math.min(1, availableWidth / 880) * zoom / 100;
  useEffect(() => {
    const clear = () => { printSnapshot.current?.remove(); printSnapshot.current = null; };
    const prepare = () => { clear(); if (workspace.current) printSnapshot.current = buildPrintSnapshot(workspace.current, doc); };
    window.addEventListener('beforeprint', prepare);
    window.addEventListener('afterprint', clear);
    return () => { clear(); window.removeEventListener('beforeprint', prepare); window.removeEventListener('afterprint', clear); };
  }, [doc]);
  const print = () => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); requestAnimationFrame(() => window.print()); };
  const pdf = async () => {
    if (!workspace.current || pdfBusy) return;
    setPdfBusy(true);
    let snapshot: HTMLElement | undefined;
    try {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      await document.fonts.ready;
      snapshot = buildPrintSnapshot(workspace.current, doc);
      await downloadPaperPDF(snapshot, doc.fields.name || 'Бумажный лист');
      setMessage('PDF сохранён. Неуместившиеся записи вынесены в приложение.');
    } catch (error) { setMessage(`Не удалось создать PDF: ${error instanceof Error ? error.message : 'повторите попытку'}. JSON сохраняет все данные.`); }
    finally { snapshot?.remove(); setPdfBusy(false); }
  };
  const extraSections = useMemo(() => paperExtraSections(doc), [doc]);
  const download = (format: 'boh' | 'lss' = 'boh') => {
    try {
      const url = URL.createObjectURL(new Blob([format === 'lss' ? exportLssSheet(doc) : exportPaperSheet(doc)], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `${(doc.fields.name || 'Бумажный лист').replace(/[<>:"/\\|?*]/g, '_')}${format === 'lss' ? ' — LSS' : ''}.json`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage('Лист сохранён в файл JSON.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Не удалось скачать лист.'); }
  };
  return <PaperSheetContext.Provider value={{ doc, setDoc, setField, calculations, equipment }}><div className="paper-sheet">
    <div className="ps-page-top"><div><h1>Бумажный лист персонажа</h1><p>Классический лист · D&D 2024</p></div><div className={`ps-save-state ${saveError || remoteSaveError ? 'ps-save-failed' : ''}`} role="status"><span />{remoteSaveStatus || (saveError ? 'Не сохранено' : 'Сохранено в этом браузере')}</div></div>
    <div className="ps-toolbar"><div className="ps-page-tabs" aria-label="Страницы листа"><button type="button" aria-pressed={allPages} onClick={() => setAllPages(true)}>Все</button>{PAGES.map((page, index) => <button type="button" key={page.id} aria-current={!allPages && activePage === page.id ? 'page' : undefined} onClick={() => { setAllPages(false); setActivePage(page.id); }}><span>{index + 1}</span>{page.name}</button>)}</div>
      <div className="ps-toolbar-actions"><button type="button" aria-label="Настройки листа" onClick={() => setSettingsOpen(true)}><Settings2 size={17} /></button><button type="button" aria-label="Справка по формулам" onClick={() => setHelpOpen(true)}><HelpCircle size={17} /></button><button type="button" onClick={print}><Printer size={16} /><span>Печать</span></button><button type="button" disabled={pdfBusy} onClick={() => void pdf()}><Download size={16} /><span>{pdfBusy ? 'Создаём PDF…' : 'Скачать PDF'}</span></button></div>
    </div>
    {(saveError || message) && <div className="ps-message" role={saveError ? 'alert' : 'status'}>{saveError || message}<button type="button" onClick={() => { setMessage(''); if (saveError) download(); }}>{saveError ? 'Скачать копию' : 'Закрыть'}</button></div>}
    {(itemLoading || itemLoadError) && <div className="ps-message" role={itemLoadError ? 'alert' : 'status'}>{itemLoadError || 'Загружаем бонусы снаряжения…'}{itemLoadError && <button type="button" onClick={() => setItemReload(value => value + 1)}>Повторить</button>}</div>}
    {effectLoadError && <div className="ps-message" role="alert">{effectLoadError}<button type="button" onClick={() => setEffectReload(value => value + 1)}>Повторить</button></div>}
    <div className="ps-workspace" ref={workspace}>{PAGES.map(({ id, name, Component }) => <div key={id} className={`ps-page-holder ${allPages || activePage === id ? '' : 'ps-page-hidden'}`} style={{ width: 880 * scale, height: 1272 * scale }}>
      <article className="paper-page" data-page={id} aria-label={`Страница: ${name}`} style={{ transform: `scale(${scale})` }}>{['tl', 'tr', 'bl', 'br'].map(corner => <span key={corner} className={`ps-corner ps-corner-${corner}`} aria-hidden="true" />)}<Component /></article>
    </div>)}</div>
    {extraSections.length > 0 && <details className="ps-lss-extra"><summary>Дополнительные данные LSS ({extraSections.length}) · включаются в PDF и печать</summary>{extraSections.map((section, i) => <section key={i}><h3>{section.title}</h3><pre>{section.text}</pre></section>)}</details>}
    <div className="ps-bottom-bar"><span>Нажмите на поле, чтобы ввести текст. Книга — добавить предмет или заклинание.</span><label>Масштаб <select aria-label="Масштаб листа" value={zoom} onChange={event => setZoom(Number(event.target.value))}>{[75, 90, 100, 110, 125, 150].map(value => <option key={value} value={value}>{value}%</option>)}</select></label></div>
    <input ref={importInput} type="file" accept="application/json,.json" hidden aria-label="Импорт листа JSON" onChange={async event => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; try { if (file.size > 10_000_000) throw new Error('Файл больше 10 МБ.'); const result = importSheetJSON(await file.text()); setPendingImport(result.document); setImportWarnings(result.warnings); setSettingsOpen(false); } catch (error) { setMessage(error instanceof Error ? error.message : 'Не удалось прочитать файл.'); } }} />
    <input ref={spellImportInput} type="file" accept="application/json,.json" hidden aria-label="Импорт гримуара LSS" onChange={async event => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; try { if (file.size > 10_000_000) throw new Error('Файл больше 10 МБ.'); const next = attachLssSpells(doc, await file.text()); setDoc(next); setSettingsOpen(false); setMessage('Гримуар загружен. Заклинания сопоставлены по исходным ID; описания сохранены.'); } catch (error) { setMessage(error instanceof Error ? error.message : 'Не удалось прочитать гримуар.'); } }} />
    {settingsOpen && <Dialog heading="Настройки бумажного листа" onClose={() => setSettingsOpen(false)}><div className="ps-settings">
      <label><input type="checkbox" checked={doc.settings.grid} onChange={event => setDoc(current => ({ ...current, settings: { ...current.settings, grid: event.target.checked } }))} /> Сетка в текстовых полях</label>
      <label><input type="checkbox" checked={allPages} onChange={event => setAllPages(event.target.checked)} /> Показывать все четыре страницы</label>
      <button type="button" onClick={() => download()}><Download size={17} /> Скачать лист JSON</button><button type="button" onClick={() => download('lss')}><Download size={17} /> Скачать для Long Story Short</button><button type="button" onClick={() => importInput.current?.click()}><Upload size={17} /> Загрузить лист JSON / LSS</button>{doc.exchange && <button type="button" onClick={() => spellImportInput.current?.click()}><Upload size={17} /> Добавить гримуар LSS</button>}<button type="button" onClick={() => { setSettingsOpen(false); setNewOpen(true); }}><FilePlus2 size={17} /> Новый пустой лист</button>
      <p className="ps-dialog-hint">JSON Bag of Holding сохраняет все ссылки и настройки. Для LSS новые заклинания и предметы передаются текстом; исходные ID LSS сохраняются. Гримуар LSS экспортируется отдельно на странице заклинаний.</p>
      <p className="ps-dialog-hint">{onDocumentChange ? 'Изменения сохраняются на сервере. Файл JSON — независимая резервная копия.' : 'Изменения сохраняются в этом браузере. Файл JSON переносит лист между устройствами.'} Печать включает все четыре страницы.</p>
    </div></Dialog>}
    {helpOpen && <Dialog heading="Поля и формулы" onClose={() => setHelpOpen(false)}><FormulaHelp /><p className="ps-dialog-hint">Кружок навыка переключает владение и компетентность. Пустое производное поле возвращается к автоматическому расчёту. Названия разделов тоже можно менять.</p><p className="ps-dialog-hint">Заметки редактируются прямо на листе. Нажмите на текст или карандаш; изменения сохраняются во время ввода. «Готово», Esc или переход к другому полю завершают редактирование.</p><p className="ps-dialog-hint">Значок книги добавляет предмет или заклинание из библиотеки. Наведите на жирное название для превью, нажмите для просмотра карточки. Ссылку в заметке можно переместить или удалить при редактировании текста.</p><p className="ps-dialog-hint">Предметы в снаряжении меняют расчёт характеристик по своим механикам. Обычная ссылка в заметке не считается надетым предметом. Этот лист не расходует ресурсы персонажа в боях.</p></Dialog>}
    {newOpen && <Dialog heading="Новый пустой лист" onClose={() => setNewOpen(false)}><p>Текущий лист будет заменён. Скачайте его, если хотите сохранить копию.</p><div className="ps-dialog-actions"><button type="button" onClick={() => download()}>Скачать текущий</button><button type="button" className="ps-primary" onClick={() => { setDoc(createPaperSheet()); setNewOpen(false); setActivePage('main'); }}>Создать пустой лист</button></div></Dialog>}
    {pendingImport && <Dialog heading="Загрузить лист" onClose={() => setPendingImport(null)}><p>Лист «{pendingImport.fields.name || 'Безымянный персонаж'}» заменит текущий. При необходимости сначала скачайте текущий лист.</p>{importWarnings.map(warning => <p key={warning} className="ps-dialog-hint">{warning}</p>)}<div className="ps-dialog-actions"><button type="button" onClick={() => download()}>Скачать текущий</button><button type="button" className="ps-primary" onClick={() => { setDoc(pendingImport); setPendingImport(null); setMessage(['Лист загружен.', ...importWarnings].join(' ')); }}>Загрузить</button></div></Dialog>}
  </div></PaperSheetContext.Provider>;
}
