// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MonsterLibrary from '../../pages/MonsterLibrary';
import type { Monster } from '../../monsters/types';
import { LIBRARY_SIDEBAR_STORAGE_KEY } from './LibrarySidebar';

const mocks=vi.hoisted(()=>({list:vi.fn()}));
vi.mock('../../monsters/api',()=>({monstersApi:{list:mocks.list}}));
vi.mock('../../hooks/useContentPermissions',()=>({useContentPermissions:()=>({admin:false,canEdit:()=>false})}));
vi.mock('../LibraryTagFilter',()=>({default:({value,onChange}:{value:string;onChange:(value:string)=>void})=><select aria-label="Фильтр по тегу" value={value} onChange={e=>onChange(e.target.value)}><option value="">Все теги</option><option value="stable">Общий тег</option><option value="second">Второй тег</option></select>}));
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const monster:Monster={id:'wolf',slug:'wolf',name:'Волк',description:'Каноническое описание',size:'medium',creature_type:'beast',alignment:'unaligned',challenge_rating:'1/4',armor_class:13,max_hp:11,speed:40,initiative_bonus:2,proficiency_bonus:2,abilities:{str:12,dex:15,con:12,int:3,wis:12,cha:6},action_ids:['bite'],effect_ids:[],ai:{},token_url:'',source:'test',created_at:'',updated_at:''};
function Probe(){const location=useLocation(),navigate=useNavigate();return <><output data-location>{location.pathname}{location.search}</output><button onClick={()=>navigate(-1)}>Назад</button><button onClick={()=>navigate(1)}>Вперёд</button></>}

describe('monster library shared shell',()=>{
  let container:HTMLDivElement,root:Root;
  beforeEach(()=>{vi.clearAllMocks();vi.useFakeTimers();localStorage.clear();mocks.list.mockResolvedValue({monsters:[monster],total:1});container=document.createElement('div');document.body.append(container);root=createRoot(container)});
  afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.useRealTimers()});
  const location=()=>container.querySelector('[data-location]')!.textContent!;
  const input=()=>container.querySelector<HTMLInputElement>('.library-search__input')!;
  async function render(path='/monsters'){await act(async()=>root.render(<MemoryRouter initialEntries={[path]}><Probe/><MonsterLibrary/></MemoryRouter>))}
  async function click(name:string){const button=[...container.querySelectorAll('button')].find(el=>(el.getAttribute('aria-label')??el.textContent)===name)!;await act(async()=>button.click())}
  async function type(value:string){await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input(),value);input().dispatchEvent(new Event('input',{bubbles:true}))})}
  async function tick(){await act(async()=>{vi.advanceTimersByTime(250)})}

  it('loads URL search/tag, preserves real canonical previews and shows the same saved sidebar',async()=>{
    localStorage.setItem(LIBRARY_SIDEBAR_STORAGE_KEY,'true');
    await render('/monsters?q=wolf&tag=stable');
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith({search:'wolf',tag:'stable',limit:100});
    expect(input().value).toBe('wolf');
    expect(container.querySelectorAll('nav button')).toHaveLength(13);
    expect(container.querySelector('nav [aria-current=page]')?.getAttribute('aria-label')).toBe('Монстры');
    expect(container.querySelector('[data-library-section=monsters] h1')?.textContent).toBe('Монстры');
    const preview=container.querySelector('.monster-card')!;
    const canonical=preview.outerHTML;
    expect(preview.textContent).toContain('КД 13');expect(preview.textContent).toContain('Каноническое описание');
    expect(preview.getAttribute('href')).toBe('/entity/monsters/wolf');
    await click('Развернуть разделы библиотеки');expect(preview.outerHTML).toBe(canonical);
    await click('Заклинания');expect(location()).toBe('/library?type=spells');
  });

  it('debounces search, preserves tags/unknown parameters, and restores both filters through history',async()=>{
    await render('/monsters?q=old&tag=stable&keep=value');
    await type('dra');await type('dragon');
    expect(mocks.list).toHaveBeenCalledTimes(1);await tick();
    expect(mocks.list).toHaveBeenLastCalledWith({search:'dragon',tag:'stable',limit:100});
    expect(location()).toContain('keep=value');
    const tag=container.querySelector<HTMLSelectElement>('[aria-label="Фильтр по тегу"]')!;
    await act(async()=>{tag.value='second';tag.dispatchEvent(new Event('change',{bubbles:true}))});
    expect(mocks.list).toHaveBeenLastCalledWith({search:'dragon',tag:'second',limit:100});
    await click('Назад');expect(tag.value).toBe('stable');
    await click('Назад');expect(input().value).toBe('old');
    await click('Вперёд');expect(input().value).toBe('dragon');
    await click('Очистить поиск');expect(location()).not.toContain('q=');expect(location()).toContain('tag=stable');
  });

  it('clears a failed query error after a successful search',async()=>{
    mocks.list.mockRejectedValueOnce(new Error('temporary failure'));
    await render();expect(container.querySelector('[role=alert]')?.textContent).toBe('temporary failure');
    await type('wolf');await tick();
    expect(container.querySelector('[role=alert]')).toBeNull();expect(container.querySelector('.monster-card')).not.toBeNull();
  });

  it('does not lose a pending search when a tag changes during the debounce',async()=>{
    await render('/monsters?tag=stable');
    await type('dragon');
    const tag=container.querySelector<HTMLSelectElement>('[aria-label="Фильтр по тегу"]')!;
    await act(async()=>{tag.value='second';tag.dispatchEvent(new Event('change',{bubbles:true}))});
    expect(input().value).toBe('dragon');await tick();
    expect(mocks.list).toHaveBeenLastCalledWith({search:'dragon',tag:'second',limit:100});
    expect(location()).toContain('q=dragon');
  });

  it('ignores a slow response from an obsolete query',async()=>{
    await render();
    let finish!:(value:unknown)=>void;
    mocks.list.mockReturnValueOnce(new Promise(resolve=>{finish=resolve}));
    await type('slow');await tick();
    mocks.list.mockResolvedValueOnce({monsters:[{...monster,name:'Дракон',id:'dragon',slug:'dragon'}],total:1});
    await type('dragon');await tick();
    await act(async()=>finish({monsters:[monster],total:1}));
    expect(container.querySelector('.monster-card h3')?.textContent).toBe('Дракон');
  });
});
