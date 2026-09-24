// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LibraryPicker } from './LibraryPicker';
import { PinModeProvider } from '../hooks/usePinMode';
import HoverCard from '../components/HoverCard';

const api = vi.hoisted(() => ({ cards: vi.fn(), spells: vi.fn(), preview: vi.fn() }));
vi.mock('../api/client', () => ({ cardsApi: { getCards: api.cards }, spellsApi: { getSpells: api.spells } }));
vi.mock('../components/EntityRefPreview', () => ({ default: (props: { type: string; id: string }) => { api.preview(props); return <div>Каноничное превью {props.id}</div>; } }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function cards(names: { id: string; name: string }[] = [], total = names.length) { return { cards: names, total, page: 1, limit: 20 }; }
function spells(names: { id: string; name: string }[] = [], total = names.length) { return { spells: names, total, page: 1, limit: 20 }; }

describe('paper sheet library picker', () => {
  let root: Root;
  let container: HTMLDivElement;
  let trigger: HTMLButtonElement;
  const select = vi.fn();
  const close = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    api.cards.mockResolvedValue(cards());
    api.spells.mockResolvedValue(spells());
    container = document.createElement('div');
    trigger = document.createElement('button');
    trigger.textContent = 'Открыть библиотеку';
    document.body.append(trigger, container);
    trigger.focus();
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    trigger.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  const dialog = () => document.querySelector<HTMLDivElement>('[role="dialog"]')!;
  const labelled = (label: string) => [...dialog().querySelectorAll<HTMLElement>('[aria-label]')].find(element => element.getAttribute('aria-label') === label)!;
  const button = (text: string) => [...dialog().querySelectorAll<HTMLButtonElement>('button')].find(element => element.textContent?.trim() === text)!;
  const click = async (element: HTMLElement) => { await act(async () => element.click()); };
  const render = async (initialType: 'card' | 'spell' = 'card') => { await act(async () => root.render(<LibraryPicker initialType={initialType} onSelect={select} onClose={close} />)); };
  const input = async (value: string) => {
    await act(async () => {
      const search = labelled('Поиск в библиотеке');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, value);
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const advance = async (time: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(time); }); };

  it('loads a lightweight empty-query page, previews only on hover, and selects by stable type/id', async () => {
    api.cards.mockResolvedValue(cards([{ id: 'sword-1', name: 'Меч' }, { id: 'sword-2', name: 'Меч' }]));
    await render();
    expect(api.cards).toHaveBeenCalledExactlyOnceWith({ page: 1, limit: 20, fields: 'list', search: '' });
    expect(api.preview).not.toHaveBeenCalled();
    const results = dialog().querySelectorAll<HTMLButtonElement>('.ps-library-result');
    expect(results[1].querySelector('strong')?.textContent).toBe('Меч');
    await act(async () => results[1].dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    expect(api.preview).toHaveBeenCalledWith({ type: 'card', id: 'sword-2' });
    await click(results[1]);
    expect(select).toHaveBeenCalledExactlyOnceWith({ type: 'card', id: 'sword-2', name: 'Меч' });
    expect(close).not.toHaveBeenCalled();
    expect(api.cards).toHaveBeenCalledTimes(1);
  });

  it('keeps picker previews passive and closes them on leave even when global pin mode is active', async () => {
    api.cards.mockResolvedValue(cards([{ id: 'sword', name: 'Меч' }]));
    await act(async () => root.render(<PinModeProvider><LibraryPicker onSelect={select} onClose={close} /></PinModeProvider>));
    const result = dialog().querySelector<HTMLButtonElement>('.ps-library-result')!;
    await act(async () => {
      result.focus();
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyT', key: 't', bubbles: true }));
      result.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    expect(document.body.textContent).toContain('Режим закрепления превью');
    expect(document.querySelector<HTMLElement>('.entity-preview-enter')?.style.pointerEvents).toBe('none');
    await act(async () => result.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })));
    await advance(100);
    expect(document.querySelector('.entity-preview-enter')).toBeNull();
    expect(dialog()).not.toBeNull();
  });

  it('preserves sticky and interactive previews for existing HoverCard callers by default', async () => {
    await act(async () => root.render(<PinModeProvider><HoverCard content={<a href="#detail">Связанная сущность</a>}><button type="button">Ссылка листа</button></HoverCard></PinModeProvider>));
    const reference = container.querySelector<HTMLButtonElement>('button')!;
    await act(async () => {
      reference.focus();
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyT', key: 't', bubbles: true }));
      reference.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    expect(document.querySelector<HTMLElement>('.entity-preview-enter')?.style.pointerEvents).toBe('auto');
    await act(async () => reference.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })));
    await advance(100);
    expect(document.querySelector('.entity-preview-enter')).not.toBeNull();
  });

  it('debounces typing and ignores stale requests from an earlier query or entity type', async () => {
    const initial = deferred<ReturnType<typeof cards>>();
    const searched = deferred<ReturnType<typeof cards>>();
    api.cards.mockReturnValueOnce(initial.promise).mockReturnValueOnce(searched.promise);
    api.spells.mockResolvedValue(spells([{ id: 'light', name: 'Свет' }]));
    await render();
    await input('М');
    await advance(150);
    await input('Меч');
    await advance(249);
    expect(api.cards).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(api.cards).toHaveBeenLastCalledWith({ page: 1, limit: 20, fields: 'list', search: 'Меч' });
    await click(button('Заклинания'));
    await advance(250);
    expect(dialog().textContent).toContain('Свет');
    await act(async () => { searched.resolve(cards([{ id: 'old-sword', name: 'Устаревший меч' }])); initial.resolve(cards([{ id: 'old-card', name: 'Старый результат' }])); });
    expect(dialog().textContent).toContain('Свет');
    expect(dialog().textContent).not.toContain('Устаревший меч');
    expect(dialog().textContent).not.toContain('Старый результат');
    expect(dialog().querySelector('[aria-busy]')?.getAttribute('aria-busy')).toBe('false');
  });

  it('paginates on the server and resets to page one when searching or switching tabs', async () => {
    api.cards.mockResolvedValue(cards([{ id: 'item', name: 'Предмет' }], 41));
    api.spells.mockResolvedValue(spells([{ id: 'spell', name: 'Заклинание' }], 22));
    await render();
    await click(labelled('Следующая страница библиотеки'));
    expect(api.cards).toHaveBeenLastCalledWith({ page: 2, limit: 20, fields: 'list', search: '' });
    expect(dialog().textContent).toContain('Страница 2 из 3');
    await input('щит');
    await advance(250);
    expect(api.cards).toHaveBeenLastCalledWith({ page: 1, limit: 20, fields: 'list', search: 'щит' });
    await click(button('Заклинания'));
    await advance(250);
    expect(api.spells).toHaveBeenLastCalledWith({ page: 1, limit: 20, fields: 'list', search: 'щит' });
    await click(dialog().querySelector<HTMLButtonElement>('.ps-library-result')!);
    expect(select).toHaveBeenLastCalledWith({ type: 'spell', id: 'spell', name: 'Заклинание' });
  });

  it('provides an explicit retry after errors and distinguishes an empty library', async () => {
    api.cards.mockRejectedValueOnce(new Error('Библиотека временно недоступна')).mockResolvedValueOnce(cards());
    await render();
    expect(dialog().querySelector('[role="alert"]')?.textContent).toBe('Библиотека временно недоступна');
    expect((labelled('Следующая страница библиотеки') as HTMLButtonElement).disabled).toBe(true);
    await click(button('Повторить'));
    expect(api.cards).toHaveBeenCalledTimes(2);
    expect(dialog().textContent).toContain('В этом разделе пока нет записей.');
    expect(dialog().querySelector('[role="alert"]')).toBeNull();
  });

  it.each([
    [Object.assign(new Error('Network Error'), { name: 'Error' }), 'Не удалось загрузить библиотеку. Проверьте, что локальный сервер запущен.'],
    [Object.assign(new Error('Произошла ошибка при выполнении запроса'), { name: 'ApiRequestError' }), 'Не удалось загрузить библиотеку. Проверьте, что локальный сервер запущен.'],
    [Object.assign(new Error('Сеанс истёк. Войдите снова.'), { status: 401 }), 'Сеанс истёк. Войдите снова.'],
    [Object.assign(new Error('Библиотека недоступна вашему аккаунту.'), { status: 403 }), 'Библиотека недоступна вашему аккаунту.'],
  ])('explains transport errors and preserves authentication details: %s', async (error, message) => {
    api.cards.mockRejectedValueOnce(error);
    await render();
    expect(dialog().querySelector('[role="alert"]')?.textContent).toBe(message);
  });

  it('does not steal focus from a replacement editor while the picker unmounts', async () => {
    await render();
    const editor = document.createElement('textarea');
    document.body.append(editor);
    editor.focus();
    await act(async () => root.render(null));
    expect(document.activeElement).toBe(editor);
    editor.remove();
  });

  it('keeps keyboard focus in the portal, closes on Escape, restores focus and ignores completion after unmount', async () => {
    const pending = deferred<ReturnType<typeof spells>>();
    api.spells.mockReturnValue(pending.promise);
    const originalOverflow = document.body.style.overflow;
    await render('spell');
    expect(document.activeElement).toBe(labelled('Поиск в библиотеке'));
    expect(document.body.style.overflow).toBe('hidden');
    await act(async () => labelled('Поиск в библиотеке').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(labelled('Закрыть библиотеку'));
    await act(async () => labelled('Закрыть библиотеку').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(labelled('Поиск в библиотеке'));
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(close).toHaveBeenCalledOnce();
    await act(async () => root.render(null));
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).toBe(originalOverflow);
    await act(async () => pending.resolve(spells([{ id: 'late', name: 'Поздний результат' }])));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
