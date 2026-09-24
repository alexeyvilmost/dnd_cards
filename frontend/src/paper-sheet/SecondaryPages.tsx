import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import { cardsApi } from '../api/client';
import { MAX_ATTUNED } from '../character/attunement';
import type { EquipmentSlotKey } from '../engine/equipment';
import { Check, Dialog, Field, Frame, Note, usePaperSheet } from './controls';
import { EntityField } from './EntityField';
import { AutofillEntityField } from './AutofillEntityField';
import { paperEntityToken, parsePaperEntityToken, type PaperLibraryEntity } from './references';
import { MAX_PAPER_INVENTORY_ROWS, equipPaperItem, paperInventoryQuantity, paperInventoryRows, unequipPaperItem } from './paperEquipment';
import './SecondaryPages.css';

const ABILITIES = [
  ['str', 'Сила'], ['dex', 'Ловкость'], ['con', 'Телосложение'],
  ['int', 'Интеллект'], ['wis', 'Мудрость'], ['cha', 'Харизма'],
] as const;

const COINS = [
  ['coinCp', 'ММ', 'Медные'], ['coinSp', 'СМ', 'Серебряные'],
  ['coinGp', 'ЗМ', 'Золотые'], ['coinEp', 'ЭМ', 'Электрумовые'], ['coinPp', 'ПМ', 'Платиновые'],
] as const;

function SpellSlots() {
  const { doc, setField, calculations } = usePaperSheet();
  const [editing, setEditing] = useState(false);
  const errorId = useId();
  const count = (key: string, limit: number) => {
    const value = calculations.values[key] ?? Number(doc.fields[key] ?? 0);
    const error = calculations.errors[key]
      || (!Number.isFinite(value) || !Number.isInteger(value) || value < 0 || value > limit
        ? `Введите целое число от 0 до ${limit} или формулу с таким результатом.` : '');
    return { value, error };
  };
  return <Frame heading="Ячейки заклинаний" className="ps-spell-slots">
    <button type="button" className="ps-slots-edit ps-paper-edit" aria-label="Настроить ячейки заклинаний" aria-expanded={editing} onClick={() => setEditing(!editing)}>⚙</button>
    <div className="ps-slot-columns">
      {[0, 1, 2].map(column => <div className="ps-slot-column" key={column}>
        <div className="ps-slot-column-labels"><span>Ур.</span><span>Ячейки</span></div>
        {[1, 2, 3].map(offset => {
          const level = column * 3 + offset;
          const maximum = count(`slot${level}Max`, 12);
          const used = count(`slot${level}Used`, maximum.error ? 12 : maximum.value);
          const error = maximum.error ? `Всего ячеек: ${maximum.error}` : used.error ? `Использовано: ${used.error}` : '';
          const descriptionId = `${errorId}-${level}`;
          return <div className="ps-slot-row" key={level}>
            <span>{level}-й</span>
            <div className="ps-slot-content" role="group" aria-label={`Ячейки ${level}-го уровня`} aria-invalid={!!error} aria-describedby={error ? descriptionId : undefined}>
              {editing ? <div className="ps-slot-settings"><Field field={`slot${level}Max`} label={`Ячейки ${level}-го уровня: всего`} /><span>/</span><Field field={`slot${level}Used`} label={`Ячейки ${level}-го уровня: использовано`} /></div> : !error && <div className="ps-slot-marks">
                {Array.from({ length: maximum.value }, (_, slot) => <button key={slot} type="button" className={`ps-slot-mark${slot < used.value ? ' is-used' : ''}`} aria-label={`Ячейка ${slot + 1}, ${level}-й уровень`} aria-pressed={slot < used.value} onClick={() => setField(`slot${level}Used`, String(slot < used.value ? slot : slot + 1))} />)}
              </div>}
              {error && <><button type="button" className="ps-slot-error-toggle" aria-label={`Исправить ячейки ${level}-го уровня`} aria-describedby={descriptionId} onClick={() => setEditing(true)}>{editing ? '!' : 'Ошибка'}</button><span id={descriptionId} className="ps-slot-error-detail" role="alert">{error}</span></>}
            </div>
          </div>;
        })}
      </div>)}
    </div>
  </Frame>;
}

function SpellStatistics() {
  const { doc, setField } = usePaperSheet();
  return <Frame className="ps-spell-statistics">
    <label className="ps-spell-ability"><select aria-label="Заклинательная характеристика" value={doc.fields.spellAbility ?? ''} onChange={event => setField('spellAbility', event.target.value)}>
      <option value=""> </option>
      {ABILITIES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
    </select><span>Характеристика</span></label>
    <div className="ps-spell-stat"><Field field="spellMod" label="Заклинательный модификатор" signed /><span className="ps-spell-stat-description">Заклинательный<br />модификатор</span></div>
    <div className="ps-spell-stat"><Field field="spellDC" label="Сложность спасброска заклинаний" /><span className="ps-spell-stat-description">Сложность<br />спасброска</span></div>
    <div className="ps-spell-stat"><Field field="spellAttack" label="Бонус атаки заклинаниями" signed /><span className="ps-spell-stat-description">Бонус атаки<br />заклинаниями</span></div>
  </Frame>;
}

function PreparedSpells() {
  const { doc, setDoc } = usePaperSheet();
  const rows = Math.max(1, doc.spellRows);
  return <Frame heading="Заговоры и подготовленные заклинания" className="ps-prepared-spells">
    <div className="ps-spell-table" role="table" aria-label="Заговоры и подготовленные заклинания">
      <div className="ps-spell-table-head" role="row">
        <span role="columnheader">Ур.</span><span role="columnheader">Название</span><span role="columnheader">Время<br />сотворения</span><span role="columnheader">Дистанция</span><span role="columnheader">Концентрация, Ритуал,<br />Материальный компонент</span><span role="columnheader">Заметки</span>
      </div>
      <div className="ps-spell-table-body">
        {Array.from({ length: rows }, (_, index) => <div className="ps-spell-table-row" role="row" key={index}>
          <div role="cell"><Field field={`spellRow${index}Level`} label={`Заклинание ${index + 1}: уровень`} /></div>
          <div role="cell"><AutofillEntityField kind="preparedSpell" row={index} field={`spellRow${index}Name`} label={`Заклинание ${index + 1}: название`} initialType="spell" /></div>
          <div role="cell"><Field field={`spellRow${index}Time`} label={`Заклинание ${index + 1}: время сотворения`} /></div>
          <div role="cell"><Field field={`spellRow${index}Range`} label={`Заклинание ${index + 1}: дистанция`} /></div>
          <div role="cell" className="ps-spell-components">
            <label><Check field={`spellRow${index}Concentration`} label={`Заклинание ${index + 1}: концентрация`} diamond /><span>К</span></label>
            <label><Check field={`spellRow${index}Ritual`} label={`Заклинание ${index + 1}: ритуал`} diamond /><span>Р</span></label>
            <label><Check field={`spellRow${index}Material`} label={`Заклинание ${index + 1}: материальный компонент`} diamond /><span>М</span></label>
          </div>
          <div role="cell"><Field field={`spellRow${index}Notes`} label={`Заклинание ${index + 1}: заметки`} /></div>
        </div>)}
      </div>
    </div>
    <div className="ps-table-row-tools">
      <button type="button" aria-label="Добавить строку заклинания" onClick={() => setDoc(current => ({ ...current, spellRows: Math.min(100, current.spellRows + 1) }))}>+</button>
      <button type="button" aria-label="Убрать последнюю строку заклинания" disabled={rows <= 1} onClick={() => setDoc(current => ({ ...current, spellRows: Math.max(1, current.spellRows - 1) }))}>−</button>
    </div>
  </Frame>;
}

function Attunement() {
  const { doc, setField } = usePaperSheet();
  const count = Math.max(1, Math.min(MAX_ATTUNED, Math.floor(Number(doc.fields.attunementSlots) || 1)));
  return <div className="ps-attunement">
    <div className="ps-attunement-label"><span>Настройка на магические предметы</span><button type="button" aria-label="Добавить место настройки" disabled={count >= MAX_ATTUNED} onClick={() => setField('attunementSlots', String(count + 1))}>+</button><button type="button" aria-label="Убрать место настройки" disabled={count <= 1} onClick={() => setField('attunementSlots', String(count - 1))}>−</button></div>
    {Array.from({ length: count }, (_, index) => <div className="ps-attunement-row" key={index}><Check field={`attunement${index}`} label={`Настройка на предмет ${index + 1}`} diamond /><EntityField field={`attunementName${index}`} label={`Магический предмет ${index + 1}`} /></div>)}
  </div>;
}

function Coins() {
  const { setField, calculations } = usePaperSheet();
  const [managing, setManaging] = useState(false);
  const [coin, setCoin] = useState('coinGp');
  const [amount, setAmount] = useState('1');
  const [error, setError] = useState('');
  const apply = (sign: number) => {
    if (calculations.errors[coin]) { setError(calculations.errors[coin]); return; }
    const value = Number(amount);
    const current = calculations.values[coin] ?? 0;
    if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) { setError('Введите целое неотрицательное число.'); return; }
    if (current + sign * value < 0) { setError('Недостаточно монет.'); return; }
    setField(coin, String(current + sign * value));
    setError('');
    setManaging(false);
  };
  return <Frame heading="Монеты" className="ps-coins">
    <div className="ps-coin-fields">{COINS.map(([key, short, full]) => <label key={key}><span>{short}</span><Field field={key} label={`${full} монеты`} /></label>)}</div>
    <button type="button" className="ps-manage-coins" aria-expanded={managing} onClick={() => { setError(''); setManaging(!managing); }}>Управлять</button>
    {managing && <Dialog heading="Управление монетами" onClose={() => setManaging(false)}><div className="ps-coin-manager">
      <label>Монеты<select value={coin} onChange={event => setCoin(event.target.value)}>{COINS.map(([key, , full]) => <option key={key} value={key}>{full}</option>)}</select></label>
      <label>Количество<input aria-label="Количество монет" type="number" min="0" step="1" value={amount} onChange={event => setAmount(event.target.value)} /></label>
      {error && <p role="alert">{error}</p>}
      <div className="ps-coin-actions"><button type="button" onClick={() => apply(1)}>Добавить</button><button type="button" onClick={() => apply(-1)}>Потратить</button></div>
    </div></Dialog>}
  </Frame>;
}

export function SpellPage() {
  const { doc, setField } = usePaperSheet();
  return <div className="ps-secondary-page ps-spells-page">
    <div className="ps-spells-left">
      <div className="ps-spells-top"><SpellStatistics /><div className="ps-spells-top-right">
        <div className="ps-movement-stats">
          <Frame heading="Размер" className="ps-size"><select aria-label="Размер персонажа" value={doc.fields.size ?? ''} onChange={event => setField('size', event.target.value)}><option value=""></option>{[['tiny', 'Крошечный'], ['small', 'Маленький'], ['medium', 'Средний'], ['large', 'Большой'], ['huge', 'Огромный'], ['gargantuan', 'Громадный']].map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Frame>
          <Frame heading="Грузоподъёмность" className="ps-capacity"><Field field="capacity" label="Грузоподъёмность" /></Frame>
          <Frame heading="Прыжок в." className="ps-jump"><div><Field field="jumpHigh" label="Прыжок в высоту" /><span>фут.</span></div></Frame>
          <Frame heading="Прыжок д." className="ps-jump"><div><Field field="jumpLong" label="Прыжок в длину" /><span>фут.</span></div></Frame>
        </div><SpellSlots />
      </div></div>
      <PreparedSpells />
    </div>
    <div className="ps-spells-right">
      <Note section="appearance" heading="Внешность" className="ps-appearance" />
      <Note section="backstory" heading="Предыстория и личные качества" className="ps-backstory"><label className="ps-alignment"><span>Мировоззрение</span><Field field="alignment" label="Мировоззрение" /></label></Note>
      <Note section="equipment" heading="Снаряжение" className="ps-equipment"><Attunement /></Note>
      <Coins />
    </div>
  </div>;
}

function Portrait() {
  const { doc, setDoc } = usePaperSheet();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const upload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) { setError('Выберите изображение PNG, JPG, WebP или GIF.'); return; }
    if (file.size > 2 * 1024 * 1024) { setError('Изображение должно быть не больше 2 МБ.'); return; }
    const reader = new FileReader();
    reader.onload = () => { if (typeof reader.result === 'string') { const portrait = reader.result; setDoc(current => ({ ...current, portrait })); setError(''); } };
    reader.onerror = () => setError('Не удалось прочитать изображение.');
    reader.readAsDataURL(file);
  };
  return <Frame heading="Портрет" className="ps-portrait">
    <button type="button" className="ps-portrait-upload" aria-label={doc.portrait ? 'Изменить портрет персонажа' : 'Загрузить портрет персонажа'} onClick={() => input.current?.click()}>
      {doc.portrait ? <img src={doc.portrait} alt="Портрет персонажа" /> : <svg className="ps-wizard" viewBox="0 0 140 220" aria-hidden="true">
        <path d="M82 3c4-4 7-3 5 2L76 32l11 35c1 3 0 4-3 4H42c-3 0-3-2-2-4l12-36zM40 83h51l5 9h29c3 0 3 3 1 6-5 8-14 12-25 15-1 18-13 32-31 32-20 0-31-14-32-32C25 110 16 106 12 98c-2-3-1-6 2-6h23zM44 76h40l2 4H42zM69 156c35 0 64 12 64 37v20H6v-20c0-25 27-37 63-37z" />
      </svg>}
    </button>
    <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="ps-portrait-file" aria-label="Файл портрета" onChange={upload} />
    {doc.portrait && <button type="button" className="ps-portrait-remove" aria-label="Удалить портрет" onClick={() => setDoc(current => ({ ...current, portrait: '' }))}>×</button>}
    {error && <p role="alert" className="ps-portrait-error">{error}</p>}
  </Frame>;
}

const EQUIPMENT_SLOTS = [
  ['head', 'Голова'], ['body', 'Тело'], ['cloak', 'Плащ'], ['gloves', 'Руки'],
  ['boots', 'Ноги'], ['main_hand', 'Рука 1'], ['off_hand', 'Рука 2'], ['necklace', 'Ожерелье'], ['ring_1', 'Кольцо'],
] as const;

function PreviousNotes({ section, label }: { section: string; label: string }) {
  const { doc } = usePaperSheet();
  if (!doc.sections[section]?.text) return null;
  return <details className="ps-previous-notes"><summary>Прежние записи: {label}</summary><Note section={section} heading={label} /></details>;
}

function Inventory({ busy, transferError, onEquip }: { busy: boolean; transferError: string; onEquip: (entity: PaperLibraryEntity, slot: EquipmentSlotKey, row: number) => void }) {
  const { doc, setDoc, setField } = usePaperSheet();
  const [error, setError] = useState('');
  const rows = paperInventoryRows(doc.fields.inventoryRows);
  const lastEmpty = rows > 0 && !doc.fields[`inventory.${rows - 1}.item`] && !doc.fields[`inventory.${rows - 1}.quantity`];
  const selectItem = (index: number, entity: PaperLibraryEntity) => {
    if (entity.type !== 'card') { setError('Для инвентаря выберите предмет во вкладке «Предметы».'); return; }
    setError('');
    setDoc(current => {
      const quantity = current.fields[`inventory.${index}.quantity`];
      return { ...current, fields: { ...current.fields, [`inventory.${index}.item`]: paperEntityToken(entity), [`inventory.${index}.quantity`]: quantity?.trim() ? String(paperInventoryQuantity(quantity)) : '1' } };
    });
  };
  const clearRow = (index: number) => setDoc(current => ({ ...current, fields: { ...current.fields, [`inventory.${index}.item`]: '', [`inventory.${index}.quantity`]: '' } }));
  return <Frame heading="Инвентарь" className="ps-inventory">
    <div className="ps-inventory-header" aria-hidden="true"><span>Предмет</span><span>Кол.</span><span></span><span></span></div>
    <div className="ps-inventory-rows">
      {Array.from({ length: rows }, (_, index) => {
        const itemKey = `inventory.${index}.item`;
        const quantityKey = `inventory.${index}.quantity`;
        const entity = parsePaperEntityToken(doc.fields[itemKey] ?? '');
        const quantity = doc.fields[quantityKey] ?? (doc.fields[itemKey] ? '1' : '');
        return <div className="ps-inventory-row" key={index}>
          <EntityField field={itemKey} label={`Инвентарь, предмет ${index + 1}`} onSelect={selected => selectItem(index, selected)} />
          <input className="ps-inventory-quantity" type="number" inputMode="numeric" min="0" step="1" aria-label={`Инвентарь, количество ${index + 1}`} disabled={busy} value={quantity} onChange={event => setField(quantityKey, String(paperInventoryQuantity(event.target.value)))} />
          <select className="ps-inventory-equip" aria-label={`Надеть предмет из строки ${index + 1}`} value="" disabled={busy || entity?.type !== 'card' || paperInventoryQuantity(quantity) <= 0} onChange={event => { const slot = EQUIPMENT_SLOTS.find(([key]) => key === event.target.value)?.[0]; if (slot && entity?.type === 'card') onEquip(entity, slot, index); }}>
            <option value="">Надеть</option>{EQUIPMENT_SLOTS.map(([slot, label]) => <option value={slot} key={slot}>{label}</option>)}
          </select>
          <button type="button" className="ps-inventory-clear" aria-label={`Очистить строку инвентаря ${index + 1}`} disabled={busy || (!doc.fields[itemKey] && !doc.fields[quantityKey])} onClick={() => clearRow(index)}>×</button>
        </div>;
      })}
    </div>
    {(error || transferError) && <p className="ps-equipment-error" role="alert">{error || transferError}</p>}
    <div className="ps-inventory-controls"><button type="button" aria-label="Добавить строку инвентаря" disabled={busy || rows >= MAX_PAPER_INVENTORY_ROWS} onClick={() => setDoc(current => ({ ...current, fields: { ...current.fields, inventoryRows: String(Math.min(MAX_PAPER_INVENTORY_ROWS, paperInventoryRows(current.fields.inventoryRows) + 1)) } }))}>+ Строка</button><button type="button" aria-label="Убрать пустую строку инвентаря" disabled={busy || !lastEmpty} onClick={() => setField('inventoryRows', String(Math.max(0, rows - 1)))}>−</button></div>
    <PreviousNotes section="goals" label="Цели и задачи" />
  </Frame>;
}

function Equipment({ busy, transferError, onEquip, onUnequip }: { busy: boolean; transferError: string; onEquip: (entity: PaperLibraryEntity, slot: EquipmentSlotKey) => void; onUnequip: (slot: EquipmentSlotKey) => void }) {
  const { doc } = usePaperSheet();
  const [error, setError] = useState('');
  const selectItem = (slot: EquipmentSlotKey, entity: PaperLibraryEntity) => {
    if (entity.type !== 'card') { setError('Для снаряжения выберите предмет во вкладке «Предметы».'); return; }
    setError('');
    onEquip(entity, slot);
  };
  return <Frame heading="Снаряжение" className="ps-equipped-items">
    <div className="ps-equipment-slots">{EQUIPMENT_SLOTS.map(([slot, label]) => <div className="ps-equipment-slot" key={slot}>
      <span className="ps-equipment-slot-label">{label}</span><EntityField field={`equipment.${slot}`} label={`Снаряжение: ${label}`} onSelect={selected => selectItem(slot, selected)} onUnlink={() => onUnequip(slot)} /><button type="button" aria-label={`Снять предмет: ${label}`} disabled={busy || !doc.fields[`equipment.${slot}`]} onClick={() => onUnequip(slot)}>×</button>
    </div>)}</div>
    {busy && <p className="ps-equipment-loading" role="status">Загрузка предмета…</p>}
    {(error || transferError) && <p className="ps-equipment-error" role="alert">{error || transferError}</p>}
    <PreviousNotes section="treasure" label="Сокровища" />
  </Frame>;
}

export function StoryPage() {
  const { doc, setDoc } = usePaperSheet();
  const latest = useRef(doc);
  latest.current = doc;
  const pending = useRef(false);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState({ area: '', message: '' });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const transfer = async (slot: EquipmentSlotKey, entity?: PaperLibraryEntity, sourceRow?: number) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError({ area: '', message: '' });
    const equipmentBefore = EQUIPMENT_SLOTS.map(([key]) => latest.current.fields[`equipment.${key}`] ?? '').join('\n');
    try {
      const ids = new Set(EQUIPMENT_SLOTS.map(([key]) => parsePaperEntityToken(latest.current.fields[`equipment.${key}`] ?? '')).filter(reference => reference?.type === 'card').map(reference => reference!.id));
      if (entity) ids.add(entity.id);
      const cards = new Map(await Promise.all([...ids].map(async id => [id, await cardsApi.getCard(id)] as const)));
      if (!mounted.current) return;
      if (equipmentBefore !== EQUIPMENT_SLOTS.map(([key]) => latest.current.fields[`equipment.${key}`] ?? '').join('\n')) throw new Error('Снаряжение изменилось. Повторите выбор.');
      const apply = (current: typeof doc) => entity ? equipPaperItem(current, cards.get(entity.id)!, slot, cards, sourceRow) : unequipPaperItem(current, slot, cards);
      const result = apply(latest.current);
      if (result.error) throw new Error(result.error);
      setDoc(current => apply(current).document);
    } catch (cause) {
      if (mounted.current) setError({ area: sourceRow === undefined ? 'equipment' : 'inventory', message: cause instanceof Error ? cause.message : 'Не удалось перенести предмет.' });
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return <div className="ps-secondary-page ps-story-page">
    <Portrait />
    <Equipment busy={busy} transferError={error.area === 'equipment' ? error.message : ''} onEquip={(entity, slot) => void transfer(slot, entity)} onUnequip={slot => void transfer(slot)} />
    <Inventory busy={busy} transferError={error.area === 'inventory' ? error.message : ''} onEquip={(entity, slot, row) => void transfer(slot, entity, row)} />
    <Note section="allies" heading="Союзники и организации" className="ps-allies" />
    <Note section="additional" heading="Дополнительные способности и умения" className="ps-additional" />
  </div>;
}

export function NotesPage() {
  return <div className="ps-secondary-page ps-notes-page">
    {Array.from({ length: 6 }, (_, index) => <Note key={index} section={`notes${index + 1}`} heading="Заметки" className={`ps-notes-section ps-notes-section-${index + 1}`} />)}
  </div>;
}
