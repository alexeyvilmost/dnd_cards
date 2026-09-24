// @vitest-environment jsdom
import { act, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Card, Spell } from '../types';
import { AutofillEntityField } from './AutofillEntityField';
import { Weapons } from './Weapons';
import { Field, PaperSheetContext } from './controls';
import { calculateSheet, createPaperSheet, loadPaperSheet, savePaperSheet, type PaperSheetDocument } from './model';

const api = vi.hoisted(() => ({ card: vi.fn(), spell: vi.fn() }));
vi.mock('../api/client', () => ({ cardsApi: { getCard: api.card }, spellsApi: { getSpell: api.spell } }));
vi.mock('../components/EntityRefPreview', () => ({ default: () => <div>Каноничное превью</div> }));
vi.mock('./LibraryPicker', () => ({ LibraryPicker: ({ onSelect }: { onSelect: (value: { type: 'card' | 'spell'; id: string; name: string }) => void }) => <div role="dialog">
  <button onClick={() => onSelect({ type: 'card', id: 'blade-a', name: 'Клинок' })}>Выбрать клинок</button>
  <button onClick={() => onSelect({ type: 'card', id: 'bow-b', name: 'Лук' })}>Выбрать лук</button>
  <button onClick={() => onSelect({ type: 'spell', id: 'spell-a', name: 'Заклинание' })}>Выбрать заклинание</button>
</div> }));

const BLADE = { id: 'blade-a', name: 'Клинок', type: 'weapon', mechanics: { weapon_profile: {
  weapon_type: 'longsword', proficiency_category: 'martial', attack_ability: 'str',
  damage_lines: [{ dice: '1d8', type: 'slashing' }], default_attack_mode: 'melee', attack_modes: [{ kind: 'melee', reach_ft: 5 }], properties: [],
  mastery_effect_id: 'effect:mastery:sap', ammo: null, enchantment: { attack_bonus: 1, damage_bonus: 1, extra_damage_lines: [] }, attunement: { required: false },
} } } as unknown as Card;
const BOW = { ...BLADE, id: 'bow-b', name: 'Лук', mechanics: { weapon_profile: { ...BLADE.mechanics!.weapon_profile as object, attack_ability: 'dex', default_attack_mode: 'ranged', attack_modes: [{ kind: 'ranged', normal_ft: 80, long_ft: 320 }], properties: ['ammunition'], ammo: { card_id: 'arrows' } } } } as Card;
const SPELL = { id: 'spell-a', name: 'Заклинание', level: 2, casting_time: 'Бонусное действие', range: 'На себя', concentration: true, ritual: false, component_material: true, material_text: 'Кристалл', duration: '1 минута' } as Spell;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('autofilling a paper library row', () => {
  let container: HTMLDivElement;
  let root: Root;
  let documentState: PaperSheetDocument;
  let setDocument: Dispatch<SetStateAction<PaperSheetDocument>>;
  beforeEach(() => {
    localStorage.clear();
    api.card.mockReset().mockResolvedValue(BLADE);
    api.spell.mockReset().mockResolvedValue(SPELL);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });
  async function render(children: ReactNode, initial = createPaperSheet()) {
    function Harness() {
      const [doc, setDoc] = useState(initial);
      documentState = doc;
      setDocument = setDoc;
      const calculations = useMemo(() => calculateSheet(doc), [doc]);
      return <PaperSheetContext.Provider value={{ doc, setDoc, calculations, setField: (key, value) => setDoc(current => ({ ...current, fields: { ...current.fields, [key]: value } })) }}>{children}</PaperSheetContext.Provider>;
    }
    await act(async () => root.render(<Harness />));
  }
  function label<T extends HTMLElement = HTMLInputElement>(name: string): T {
    const element = [...container.querySelectorAll<HTMLElement>('[aria-label]')].find(item => item.getAttribute('aria-label') === name);
    expect(element, name).toBeTruthy();
    return element as T;
  }
  async function choose(name: string, action: string) {
    await act(async () => label<HTMLButtonElement>(`Из библиотеки: ${name}`).click());
    const selected = [...container.querySelectorAll('button')].find(item => item.textContent === action)!;
    await act(async () => selected.click());
  }
  async function input(element: HTMLInputElement, value: string) {
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); });
  }

  it('fills an entire weapon row once, recalculates modifiers, allows manual damage edits and persists the source', async () => {
    const sheet = createPaperSheet();
    sheet.checks['proficiency.martialWeapons'] = true;
    await render(<><Weapons /><Field field="str" label="Сила" /><Field field="dex" label="Ловкость" /></>, sheet);
    await choose('Название оружия 1', 'Выбрать клинок');
    expect(api.card).toHaveBeenCalledExactlyOnceWith('blade-a');
    expect(documentState.fields['weapon.0.name']).toBe('[[Клинок|card:blade-a]]');
    expect(label('Бонус оружия 1').value).toBe('3');
    expect(label('Урон и вид 1').value).toBe('1d8 + 1 рубящий');
    await input(label('Сила'), '18');
    expect(label('Бонус оружия 1').value).toBe('7');
    expect(label('Урон и вид 1').value).toBe('1d8 + 5 рубящий');
    const damage = label('Урон и вид 1');
    await act(async () => damage.focus());
    expect(damage.value).toBe('1d8 + {{[STR] + 1}} рубящий');
    await input(damage, '2d6 + {{[DEX]}} холод');
    await act(async () => damage.blur());
    await input(label('Ловкость'), '16');
    expect(damage.value).toBe('2d6 + 3 холод');
    savePaperSheet(documentState);
    expect(loadPaperSheet().document.fields['weapon.0.damage']).toBe('2d6 + {{[DEX]}} холод');
    expect(api.card).toHaveBeenCalledTimes(1);
  });

  it('fills prepared spell metadata and checks with the name in the same document update', async () => {
    await render(<AutofillEntityField kind="preparedSpell" row={3} field="spellRow3Name" label="Четвёртое заклинание" initialType="spell" />);
    await choose('Четвёртое заклинание', 'Выбрать заклинание');
    expect(api.spell).toHaveBeenCalledExactlyOnceWith('spell-a');
    expect(documentState.fields).toMatchObject({ spellRow3Name: '[[Заклинание|spell:spell-a]]', spellRow3Level: '2', spellRow3Time: 'Бонусное действие', spellRow3Range: 'На себя', spellRow3Notes: 'Длительность: 1 минута; М: Кристалл' });
    expect(documentState.checks).toMatchObject({ spellRow3Concentration: true, spellRow3Ritual: false, spellRow3Material: true });
  });

  it('keeps the previous row intact after a failed request', async () => {
    const sheet = createPaperSheet();
    sheet.fields['weapon.0.name'] = 'Старое оружие';
    sheet.fields['weapon.0.damage'] = '1d4';
    api.card.mockRejectedValue(new Error('offline'));
    await render(<Weapons />, sheet);
    await choose('Название оружия 1', 'Выбрать клинок');
    expect(documentState).toEqual(sheet);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Не удалось загрузить');
  });

  it('does not overwrite a manual row edit made while its full record is loading', async () => {
    let resolve!: (card: Card) => void;
    api.card.mockReturnValue(new Promise<Card>(done => { resolve = done; }));
    await render(<Weapons />);
    await choose('Название оружия 1', 'Выбрать клинок');
    expect(documentState.fields['weapon.0.name']).toBeUndefined();
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Заполнение…');
    await input(label('Урон и вид 1'), 'Моя правка');
    await act(async () => resolve(BLADE));
    expect(documentState.fields['weapon.0.name']).toBeUndefined();
    expect(documentState.fields['weapon.0.bonus']).toBeUndefined();
    expect(documentState.fields['weapon.0.damage']).toBe('Моя правка');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Строка изменена');
  });

  it('applies the newest selection and discards an older response without touching other edits', async () => {
    let first!: (card: Card) => void;
    let second!: (card: Card) => void;
    api.card.mockImplementationOnce(() => new Promise<Card>(done => { first = done; })).mockImplementationOnce(() => new Promise<Card>(done => { second = done; }));
    await render(<Weapons />);
    await choose('Название оружия 1', 'Выбрать клинок');
    await choose('Название оружия 1', 'Выбрать лук');
    await act(async () => setDocument(current => ({ ...current, fields: { ...current.fields, name: 'Сохранить имя' } })));
    await act(async () => second(BOW));
    expect(documentState.fields['weapon.0.name']).toBe('[[Лук|card:bow-b]]');
    await act(async () => first(BLADE));
    expect(documentState.fields['weapon.0.name']).toBe('[[Лук|card:bow-b]]');
    expect(documentState.fields.name).toBe('Сохранить имя');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('leaves a prepared spell row untouched when a non-spell is selected', async () => {
    const initial = createPaperSheet();
    initial.fields.spellRow0Name = 'Ручная запись';
    await render(<AutofillEntityField kind="preparedSpell" row={0} field="spellRow0Name" label="Первое заклинание" initialType="spell" />, initial);
    await choose('Первое заклинание', 'Выбрать клинок');
    expect(documentState).toEqual(initial);
    expect(api.card).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('выберите заклинание');
  });
});
