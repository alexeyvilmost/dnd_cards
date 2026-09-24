// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import LibrarySidebar, { LIBRARY_SIDEBAR_STORAGE_KEY } from './LibrarySidebar';
import LibrarySearch, { LIBRARY_SEARCH_DELAY } from './LibrarySearch';
import LibrarySectionHero from './LibrarySectionHero';
import { LIBRARY_CATALOG, librarySectionPath } from './libraryCatalog';
import { libraryHeroArt } from './libraryHeroArt';

const chromeCSS = readFileSync(new NodeURL('./LibraryChrome.css', import.meta.url), 'utf8');
const filtersCSS = readFileSync(new NodeURL('../../pages/CardLibrary.css', import.meta.url), 'utf8');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function HistoryProbe() {
  const location = useLocation(), navigate = useNavigate();
  return <><output data-location>{location.pathname}{location.search}</output>
    <button onClick={() => navigate(-1)}>Назад</button><button onClick={() => navigate(1)}>Вперёд</button></>;
}
function SearchHarness() {
  const [params, setParams] = useSearchParams();
  return <LibrarySearch value={params.get('q') ?? ''} onSearch={value => setParams(previous => {
    const next = new URLSearchParams(previous);
    if (value) next.set('q', value); else next.delete('q');
    return next;
  })} />;
}

describe('shared library chrome', () => {
  let container: HTMLDivElement, root: Root;
  beforeEach(() => {
    localStorage.clear(); vi.useFakeTimers();
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); });
  const button = (name: string) => [...container.querySelectorAll('button')].find(el => (el.getAttribute('aria-label') ?? el.textContent) === name)!;
  const input = () => container.querySelector<HTMLInputElement>('input[type=search]')!;
  const query = () => new URLSearchParams(container.querySelector('[data-location]')!.textContent!.split('?')[1]);
  async function click(name: string) { await act(async () => button(name).click()); }
  async function type(value: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), value);
      input().dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  async function tick(ms = LIBRARY_SEARCH_DELAY) { await act(async () => { vi.advanceTimersByTime(ms); }); }

  it('shares the original 13 sections, accessible icon-only navigation and persistent collapse across routes', async () => {
    await act(async () => root.render(<MemoryRouter initialEntries={['/library']}><HistoryProbe />
      <Routes><Route path="/library" element={<LibrarySidebar key="cards" active="cards" />} /><Route path="/monsters" element={<LibrarySidebar key="monsters" active="monsters" />} /></Routes>
    </MemoryRouter>));
    expect(container.querySelectorAll('nav button')).toHaveLength(13);
    expect(button('Свернуть разделы библиотеки').getAttribute('aria-expanded')).toBe('true');
    expect(button('Свернуть разделы библиотеки').textContent).toBe('Свернуть');
    await click('Свернуть разделы библиотеки');
    expect(localStorage.getItem(LIBRARY_SIDEBAR_STORAGE_KEY)).toBe('true');
    expect(container.querySelector('.library-sidebar')?.getAttribute('data-collapsed')).toBe('true');
    for (const item of LIBRARY_CATALOG) expect(button(item.label).getAttribute('aria-label')).toBe(item.label);
    expect(container.querySelector('[title]')).toBeNull();
    await click('Монстры');
    expect(container.querySelector('[data-location]')?.textContent).toBe('/monsters');
    expect(button('Монстры').getAttribute('aria-current')).toBe('page');
    expect(button('Развернуть разделы библиотеки').getAttribute('aria-expanded')).toBe('false');
    await click('Развернуть разделы библиотеки');
    await click('Предметы');
    expect(container.querySelector('[data-location]')?.textContent).toBe('/library');
    expect(button('Свернуть разделы библиотеки').getAttribute('aria-expanded')).toBe('true');
  });

  it('tolerates unavailable local storage and still toggles', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    await act(async () => root.render(<MemoryRouter><LibrarySidebar active="monsters" /></MemoryRouter>));
    await click('Свернуть разделы библиотеки');
    expect(button('Развернуть разделы библиотеки').getAttribute('aria-expanded')).toBe('false');
  });

  it('routes all non-monster sections to /library and keeps category changes in the existing page handler', async () => {
    const change = vi.fn();
    await act(async () => root.render(<MemoryRouter><LibrarySidebar active="cards" onSelectContent={change} /></MemoryRouter>));
    await click('Заклинания');
    expect(change).toHaveBeenCalledExactlyOnceWith('spells');
    for (const { id } of LIBRARY_CATALOG) expect(librarySectionPath(id)).toMatch(id === 'monsters' ? /^\/monsters$/ : /^\/library(?:\?|$)/);
  });

  it('debounces a burst, retains filters and restores input with back/forward history', async () => {
    await act(async () => root.render(<MemoryRouter initialEntries={['/monsters?tag=stable&q=old']}><HistoryProbe /><SearchHarness /></MemoryRouter>));
    expect(input().value).toBe('old');
    await type('ske'); await tick(100); await type('skeleton'); await tick(249);
    expect(query().get('q')).toBe('old');
    await tick(1);
    expect(query().get('q')).toBe('skeleton'); expect(query().get('tag')).toBe('stable');
    await click('Назад'); expect(input().value).toBe('old');
    await click('Вперёд'); expect(input().value).toBe('skeleton');
    await click('Очистить поиск'); expect(query().has('q')).toBe(false); expect(query().get('tag')).toBe('stable');
  });

  it('cancels a pending draft on history navigation even when committed q is unchanged', async () => {
    await act(async () => root.render(<MemoryRouter initialEntries={['/monsters?q=same&tag=first', '/monsters?q=same&tag=second']} initialIndex={1}><HistoryProbe /><SearchHarness /></MemoryRouter>));
    await type('must not reappear'); await click('Назад'); await tick();
    expect(input().value).toBe('same'); expect(query().get('tag')).toBe('first'); expect(query().get('q')).toBe('same');
  });

  it('commits Enter immediately, waits for composition, and cancels timers on unmount', async () => {
    const commit = vi.fn();
    await act(async () => root.render(<MemoryRouter><LibrarySearch value="" onSearch={commit} /></MemoryRouter>));
    await act(async () => input().dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
    await type('дракон'); await tick(); expect(commit).not.toHaveBeenCalled();
    await act(async () => input().dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
    await tick(); expect(commit).toHaveBeenLastCalledWith('дракон');
    await type('волк');
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(commit).toHaveBeenLastCalledWith('волк');
    await type('cancelled');
    await act(async () => root.render(<MemoryRouter />)); await tick();
    expect(commit).toHaveBeenCalledTimes(2);
  });

  it('provides every individual banner path and semantic heading/action slots', async () => {
    await act(async () => root.render(<>{LIBRARY_CATALOG.map(({ id }) => <LibrarySectionHero key={id} type={id} />)}
      <LibrarySectionHero type="monsters" heading="Свой заголовок" subtitle="Бестиарий" action={<a href="/monster-forge">Создать</a>} /></>));
    for (const item of LIBRARY_CATALOG) {
      const hero = container.querySelector<HTMLElement>(`[data-library-section="${item.id}"]`)!;
      expect(hero.querySelector('h1')?.textContent).toBe(item.label);
      expect(libraryHeroArt[item.id]).toBe(`/images/library/${item.id}.jpg`);
      expect(hero.style.getPropertyValue('--library-hero-art')).toContain(libraryHeroArt[item.id]);
    }
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/monster-forge');
    expect(container.textContent).toContain('Свой заголовок');
  });

  it('limits styles to chrome and includes reduced-motion and bounded mobile rail rules', () => {
    expect(chromeCSS).toContain('@media (prefers-reduced-motion: reduce)');
    expect(chromeCSS).toContain('transition: none;');
    expect(chromeCSS).toContain('overflow-x: hidden;');
    expect(chromeCSS).toContain('scrollbar-width: none;');
    expect(chromeCSS).not.toMatch(/\.monster-card|\.card-preview|\.item-preview/);
    expect(chromeCSS).toContain("font-family: Georgia, 'Times New Roman', serif !important");
    expect(chromeCSS).toContain('background-position: center;');
    expect(chromeCSS).toContain('transparent 65%');
  });

  it('removes collapsed labels from layout so invisible wrapped text cannot inflate icon rows', () => {
    const labels = chromeCSS.match(/\.library-sidebar\[data-collapsed=true\] \.navrail-txt\s*\{([^}]+)\}/)?.[1];
    const rows = chromeCSS.match(/\.library-sidebar\[data-collapsed=true\] \.navrail-item\s*\{([^}]+)\}/)?.[1];
    expect(labels).toMatch(/display:\s*none;/);
    expect(rows).toMatch(/height:\s*50px;/);
    expect(rows).toMatch(/flex-shrink:\s*0;/);
  });

  it('scopes dark filter/drawer and tag controls without a descendant-wide entity theme',()=>{
    expect(filtersCSS).toMatch(/\.library-chrome-filters\s*\{[^}]*background-color: var\(--site-panel/);
    expect(filtersCSS).toMatch(/\.library-chrome-filters\.lib-filters-sheet,[\s\S]*?\.lib-filters-foot\s*\{[^}]*background-color: var\(--site-panel/);
    expect(filtersCSS).toMatch(/\.library-chrome-filters \.input-field\s*\{[^}]*color-scheme: dark/);
    expect(chromeCSS).toMatch(/\.library-chrome-tag-control > \.tag-filter > label > select\s*\{[^}]*background-color: var\(--site-bg/);
    expect(chromeCSS).not.toMatch(/\.library-shell\s+(?:input|select|button|\.bg-white|\.entity-tag-form)\b/);
  });
});
