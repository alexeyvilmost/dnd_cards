// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CardLibrary from '../../pages/CardLibrary';

const mocks = vi.hoisted(() => ({ token: 'admin' as string | null, canManage: true, mobile: false, showReviewStatus: false, list: vi.fn(), detail: vi.fn(), bulk: vi.fn(), catalog: vi.fn() }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ token: mocks.token }) }));
vi.mock('../../hooks/useContentPermissions', () => ({ useContentPermissions: () => ({ admin: mocks.canManage, canEdit: (entity: {author?: string}) => mocks.canManage || entity.author === 'player', canCreate: (kind: string) => Boolean(mocks.token && (mocks.canManage || kind === 'cards' || kind === 'spells')) }) }));
vi.mock('../../settings', () => ({ useSiteSettings: () => ({ itemPreview: 'interface', showReviewStatus: mocks.showReviewStatus }) }));
vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => mocks.mobile }));
vi.mock('../../hooks/usePinMode', () => ({ usePinMode: () => ({ pinModeActive: false }) }));
vi.mock('../../utils/resources', () => ({ useResourceOptions: () => [], resourceIcon: () => '', resourceLabel: () => '' }));
vi.mock('../../api/client', () => ({ cardsApi: {}, effectsApi: {}, actionsApi: {}, spellsApi: {}, featsApi: {}, backgroundsApi: {}, racesApi: {}, classesApi: {}, resourcesApi: {}, variablesApi: {}, conceptsApi: {} }));
vi.mock('../../api/entityTags', () => ({ entityTagsApi: { list: mocks.catalog, bulk: mocks.bulk }, tagError: (e: Error) => e.message }));
vi.mock('./itemLibraryApi', () => ({ itemLibraryApi: { list: mocks.list, detail: mocks.detail } }));
vi.mock('../LibraryTagFilter', () => ({ default: ({value,onChange}:{value:string;onChange:(v:string)=>void}) => <select aria-label="Фильтр по тегу" value={value} onChange={e=>onChange(e.target.value)}><option value="">Все теги</option><option value="d2620000-0000-4000-8000-000000000001">Available for Players</option></select> }));
vi.mock('../CardDetailModal', () => ({ default: ({isOpen,card}:{isOpen:boolean;card?:{name:string;support?:{status:string}}}) => isOpen ? <div role="dialog" data-support-status={card?.support?.status}>{card?.name}</div> : null }));
vi.mock('../CardPreview', () => ({ default: ({card}:{card:{name:string}}) => <div>{card.name}</div> }));
vi.mock('../ItemPreview', () => ({ default: ({card,onClick}:{card:{name:string};onClick:()=>void}) => <button onClick={onClick}>{card.name}</button> }));
vi.mock('../EffectPreview', () => ({ default: () => null }));
vi.mock('../ActionPreview', () => ({ default: () => null }));
vi.mock('../SpellPreview', () => ({ default: () => null }));
vi.mock('../FeatPreview', () => ({ default: () => null }));
vi.mock('../BackgroundPreview', () => ({ default: () => null }));
vi.mock('../RacePreview', () => ({ default: () => null }));
vi.mock('../ClassPreview', () => ({ default: () => null }));
vi.mock('../ConceptPreview', () => ({ default: () => null }));
vi.mock('../ResourcePreview', () => ({ default: () => null, resourceCategoryLabel: () => '', resourceRechargeLabel: () => '' }));
vi.mock('../VariablePreview', () => ({ default: () => null, variableTypeLabel: () => '' }));
vi.mock('../EffectDetailModal', () => ({ default: () => null }));
vi.mock('../ActionDetailModal', () => ({ default: () => null }));
vi.mock('../SpellDetailModal', () => ({ default: () => null }));
vi.mock('../FeatDetailModal', () => ({ default: () => null }));
vi.mock('../BackgroundDetailModal', () => ({ default: () => null }));
vi.mock('../RaceDetailModal', () => ({ default: () => null }));
vi.mock('../ClassDetailModal', () => ({ default: () => null }));
vi.mock('../ConceptDetailModal', () => ({ default: () => null }));
vi.mock('../ResourceDetailModal', () => ({ default: () => null }));
vi.mock('../VariableDetailModal', () => ({ default: () => null }));
vi.mock('../PassiveLibrary', () => ({ default: () => null }));
vi.mock('../EntityRefRegistry', () => ({ evictEntity: () => {} }));
vi.mock('../../utils/formattedText', () => ({ FormattedText: () => null }));

(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT = true;
const cards = [{id:'first',name:'Первый предмет',rarity:'common',card_number:'A'}, {id:'second',name:'Второй предмет',rarity:'rare',card_number:'B'}];
function NavigationProbe() {
  const location = useLocation(), navigate = useNavigate();
  return <><output data-location>{location.pathname}{location.search}</output><button onClick={() => navigate(-1)}>Назад в тесте</button><button onClick={() => navigate(1)}>Вперёд в тесте</button><button onClick={() => navigate('/library?rarity=rare')}>Внешняя ссылка</button></>;
}

describe('item library interactions', () => {
  let container: HTMLDivElement, root: Root;
  beforeEach(() => {
    vi.clearAllMocks(); mocks.token='admin'; mocks.canManage=true; mocks.mobile=false; mocks.showReviewStatus=false;
    mocks.catalog.mockImplementation(async () => ({tags:[], can_manage:mocks.canManage}));
    mocks.list.mockResolvedValue({cards,total:2}); mocks.detail.mockResolvedValue(cards[0]); mocks.bulk.mockResolvedValue(undefined);
    container=document.createElement('div'); document.body.append(container); root=createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });
  async function render(path='/library', previous='/library') {
    await act(async () => root.render(<MemoryRouter initialEntries={[previous,path]} initialIndex={1}><NavigationProbe/><CardLibrary/></MemoryRouter>));
  }
  function button(label:string) {
    const result=[...container.querySelectorAll('button')].find(el => el.textContent?.includes(label) || el.getAttribute('aria-label')===label);
    if (!result) throw new Error(`Missing button ${label}`); return result;
  }
  async function click(label:string) { await act(async () => button(label).click()); }
  const location=()=>container.querySelector('[data-location]')!.textContent!;

  it('ORs checkbox rarities, preserves tag/deep links and navigates from the legacy root to /library', async () => {
    await render('/?rarity=common&tag=stable');
    await click('Фильтры');
    const rare=[...container.querySelectorAll('.library-rarities label')].find(el=>el.textContent==='Редкое')?.querySelector('input');
    expect(rare).toBeTruthy();
    await act(async () => (rare as HTMLInputElement).click());
    expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({rarity:'common,rare',tag:'stable'}));
    expect(location()).toContain('/library?');
    expect(new URLSearchParams(location().split('?')[1]).get('rarity')).toBe('common,rare');
    await click('Внешняя ссылка');
    expect(location()).toBe('/library?rarity=rare');
    expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({rarity:'rare'}));
    await click('Назад в тесте');
    expect(new URLSearchParams(location().split('?')[1]).get('rarity')).toBe('common,rare');
  });

  it.each(['list','grid','interface'])('selects canonical items in %s view and sends stable tag IDs once', async view => {
    await render(`/library?view=${view}`); await click('Выбрать предметы');
    const checks=[...container.querySelectorAll<HTMLInputElement>('.library-selection-checkbox input')];
    expect(checks).toHaveLength(2);
    await act(async () => checks[0].click());
    expect(container.querySelector('[role=dialog]')).toBeNull();
    await click('Выбрать загруженные');
    const select=container.querySelector<HTMLSelectElement>('.library-bulk-tags select')!;
    await act(async () => {select.value='d2620000-0000-4000-8000-000000000001';select.dispatchEvent(new Event('change',{bubbles:true}));});
    await click('Добавить тег');
    expect(mocks.bulk).toHaveBeenCalledExactlyOnceWith('card',['first','second'],['d2620000-0000-4000-8000-000000000001'],'add');
    expect(container.textContent).toContain('Тег добавлен ко всем');
  });

  it('retains selection on server rejection and clears it when filters change', async () => {
    mocks.bulk.mockRejectedValue(new Error('Нет прав администратора'));
    await render(); await click('Выбрать предметы'); await click('Выбрать загруженные');
    const select=container.querySelector<HTMLSelectElement>('.library-bulk-tags select')!;
    await act(async () => {select.value='d2620000-0000-4000-8000-000000000001';select.dispatchEvent(new Event('change',{bubbles:true}));});
    await click('Добавить тег');
    expect(container.querySelector('[role=alert]')?.textContent).toBe('Нет прав администратора');
    expect(container.textContent).toContain('Выбрано: 2 / 500');
    await click('Внешняя ссылка');
    expect(container.textContent).toContain('Выбрано: 0 / 500');
  });

  it('hides selection controls for non-admins and provides Monsters navigation', async () => {
    mocks.canManage=false; mocks.token='player'; await render();
    expect(container.querySelector('.library-bulk-tags')).toBeNull();
    await click('Монстры'); expect(location()).toBe('/monsters');
  });

  it('opens the detail dialog for an editor, but the full entity page for a reader', async () => {
    await render('/library?view=list');
    await click('Первый предмет');
    expect(container.querySelector('[role=dialog]')?.textContent).toContain('Первый предмет');
    expect(location()).toBe('/library?view=list');
    mocks.canManage = false;
    await act(async () => root.render(<MemoryRouter initialEntries={['/library?view=list']}><NavigationProbe/><CardLibrary/></MemoryRouter>));
    await click('Первый предмет');
    expect(location()).toBe('/entity/cards/first');
  });

  it('drops administrator data and selection on logout even when the guest read fails', async () => {
    await render(); await click('Выбрать предметы'); await click('Выбрать загруженные');
    mocks.token=null; mocks.canManage=false; mocks.list.mockRejectedValue(new Error('Network failure'));
    await render();
    expect(container.querySelector('.library-bulk-tags')).toBeNull();
    expect(container.textContent).not.toContain('Первый предмет');
    expect(container.textContent).not.toContain('Второй предмет');
  });


  it('loads all filtered pages for status counts, combines statuses, and patches counts and filtered rows without fetching again', async () => {
    mocks.showReviewStatus = true;
    const rows = [
      {...cards[0], support:{status:'verified'}},
      {...cards[1], support:{status:'not_verified'}},
      {...cards[1], id:'third', name:'Третий предмет', support:{status:'narrative'}},
    ];
    mocks.list.mockImplementation(async ({page}: {page:number}) => ({cards:[rows[page-1]], total:3}));
    await render('/library?tag=stable&status=not_verified,narrative');
    expect(mocks.list).toHaveBeenCalledTimes(3);
    expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({page:3,tag:'stable'}));
    expect(container.querySelectorAll('.library-item-row')).toHaveLength(2);
    expect(container.querySelector('.library-review-summary p')?.textContent).toContain('3 сущностей');
    expect(container.querySelector('.library-review-summary [data-status=verified] strong')?.textContent).toBe('1');
    expect(container.querySelectorAll('.library-item-row .review-status-corner')).toHaveLength(2);
    await act(async()=>{window.dispatchEvent(new CustomEvent('entity-review-status-changed',{detail:{entity_type:'card',entity_id:rows[1].id,support:{status:'partial_narrative_verified_partial'}}}));});
    expect(mocks.list).toHaveBeenCalledTimes(3);
    expect(container.querySelectorAll('.library-item-row')).toHaveLength(1);
    expect(container.querySelector('.library-review-summary [data-status=verified] strong')?.textContent).toBe('1');
    expect(container.querySelector('.library-review-summary [data-status=partial_narrative_verified_partial] strong')?.textContent).toBe('1');
    expect(new URLSearchParams(location().split('?')[1]).get('status')).toBe('not_verified,narrative');
  });


  it.each(['verified', 'partial_narrative_verified_partial'])('keeps the open detail and scroll position while saving %s without a catalog reload', async status => {
    mocks.showReviewStatus=true;
    const card={...cards[0],support:{status:'not_verified'}};
    mocks.list.mockResolvedValue({cards:[card],total:1});
    mocks.detail.mockResolvedValue(card);
    await render();
    await click('Первый предмет');
    expect(container.querySelector('[role=dialog]')?.getAttribute('data-support-status')).toBe('not_verified');
    const dialog=container.querySelector('[role=dialog]')!;
    const row=container.querySelector('.library-item-row')!;
    container.scrollTop=480;
    dialog.scrollTop=125;
    const url=location();
    await act(async()=>window.dispatchEvent(new CustomEvent('entity-review-status-changed', {detail:{entity_type:'card',entity_id:card.id,support:{status}}})));
    expect(container.querySelector('[role=dialog]')).toBe(dialog);
    expect(container.querySelector('.library-item-row')).toBe(row);
    expect(container.scrollTop).toBe(480);
    expect(dialog.scrollTop).toBe(125);
    expect(location()).toBe(url);
    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role=dialog]')?.getAttribute('data-support-status')).toBe(status);
    expect(container.querySelector('.library-item-row .review-status-corner')?.getAttribute('data-review-status')).toBe(status);
  });

  it('ignores a saved status filter and hides its UI while the setting is off', async () => {
    await render('/library?status=verified');
    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll('.library-item-row')).toHaveLength(2);
    expect(container.querySelector('.library-review-summary')).toBeNull();
    expect(container.querySelector('.review-status-corner')).toBeNull();
  });

  it('commits shared search after debounce and preserves rarity/tag filters across back and forward', async () => {
    vi.useFakeTimers();
    await render('/library?q=old&rarity=common,rare&tag=stable');
    const input=container.querySelector<HTMLInputElement>('.library-search__input')!;
    expect(input.value).toBe('old');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'new query');
      input.dispatchEvent(new Event('input',{bubbles:true}));
    });
    expect(mocks.list).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(250); });
    expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({search:'new query',rarity:'common,rare',tag:'stable'}));
    expect(container.querySelector('.library-chrome-status')?.textContent).toContain('Показано:');
    expect(new URLSearchParams(location().split('?')[1]).get('q')).toBe('new query');
    await click('Назад в тесте');
    expect(input.value).toBe('old');
    expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({search:'old',rarity:'common,rare',tag:'stable'}));
    await click('Вперёд в тесте');
    expect(input.value).toBe('new query');
    await click('Очистить поиск');
    expect(new URLSearchParams(location().split('?')[1]).has('q')).toBe(false);
    expect(new URLSearchParams(location().split('?')[1]).get('tag')).toBe('stable');
  });

  it.each([false,true])('keeps filters and bulk controls inside dark chrome without enclosing white entity cards (mobile=%s)',async mobile=>{
    mocks.mobile=mobile;
    await render('/library?view=list');
    await click('Фильтры');
    const filters=container.querySelector('.library-chrome-filters')!;
    expect(filters.classList.contains('lib-filters-sheet')).toBe(mobile);
    expect(filters.querySelector('.library-chrome-tag-control')).not.toBeNull();
    if(mobile){
      expect(button('Сбросить').classList.contains('library-chrome-button')).toBe(true);
      expect(button('Показать').classList.contains('library-chrome-button--primary')).toBe(true);
      expect(button('Закрыть фильтры').classList.contains('library-chrome-button')).toBe(true);
    }
    await click('Выбрать предметы');
    const bulk=container.querySelector('.library-bulk-tags')!;
    expect(bulk.classList.contains('library-chrome-panel')).toBe(true);
    expect(bulk.querySelector('.library-chrome-tag-control')).not.toBeNull();
    for(const control of bulk.querySelectorAll('button')) expect(control.classList.contains('library-chrome-button')).toBe(true);
    const items=container.querySelectorAll('.library-selectable');
    expect(items).toHaveLength(2);
    for(const item of items){
      expect(item.closest('.library-chrome-panel,.library-chrome-filters')).toBeNull();
      expect(item.querySelector('.library-item-row')).not.toBeNull();
    }
  });
});
