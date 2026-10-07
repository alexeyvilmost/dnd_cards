// @vitest-environment jsdom
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import CharactersForgeList from './CharactersForgeList';

(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const fixture=vi.hoisted(()=>({authenticated:true, rows:[
  {id:'standard',name:'Standard hero',character_type:'free',access_mode:'owner',level:1,max_hp:10,current_hp:10},
  {id:'run',name:'Run hero',character_type:'dungeon_crawl',access_mode:'owner',roguelike_run_id:'run-id',level:1,max_hp:10,current_hp:10},
],list:vi.fn(),remove:vi.fn()}));
vi.mock('../contexts/AuthContext',()=>({useAuth:()=>({isAuthenticated:fixture.authenticated})}));
vi.mock('../character/api',()=>({charactersV3Api:{listPreviews:fixture.list,remove:fixture.remove},characterV3ErrorMessage:()=> 'Error'}));
vi.mock('../api/client',()=>({racesApi:{getRaces:async()=>({races:[]})},classesApi:{getClasses:async()=>({classes:[]})}}));
vi.mock('../components/CharacterAccessBadge',()=>({default:()=>null}));
vi.mock('../components/CharacterTemplateLibrary',()=>({default:()=> <p>Template catalog</p>}));
vi.mock('./PaperSheetEntry',()=>({default:()=> <p>Paper collection</p>}));
let root:Root,host:HTMLDivElement;
const render=(route='/characters-forge')=>act(async()=>root.render(<MemoryRouter initialEntries={[route]}><CharactersForgeList/></MemoryRouter>));
const tab=(name:string)=>[...host.querySelectorAll<HTMLButtonElement>('[role=tab]')].find(row=>row.textContent===name)!;
beforeEach(()=>{vi.clearAllMocks();fixture.authenticated=true;fixture.list.mockResolvedValue(fixture.rows);fixture.remove.mockResolvedValue(undefined);host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
it('defaults to standard sheets, separates runs and unifies all and paper collections',async()=>{
  await render();expect(host.textContent).toContain('Standard hero');expect(host.textContent).not.toContain('Run hero');
  await act(async()=>tab('Забеги').click());expect(host.textContent).toContain('Run hero');expect(host.textContent).not.toContain('Standard hero');
  expect(host.querySelector('[href="/characters-v3/run?roguelike=run-id"]')).not.toBeNull();
  await act(async()=>tab('Все').click());expect(host.textContent).toContain('Standard hero');expect(host.textContent).toContain('Run hero');expect(host.textContent).toContain('Paper collection');
  await act(async()=>tab('Бумажные').click());expect(host.textContent).not.toContain('Standard hero');expect(host.textContent).toContain('Paper collection');
  await act(async()=>tab('Шаблоны').click());expect(host.textContent).toContain('Template catalog');
});
it('supports keyboard tabs with one tab stop and a labelled panel',async()=>{
  await render();await act(async()=>tab('Стандартные').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true})));
  expect(tab('Забеги').getAttribute('aria-selected')).toBe('true');expect(document.activeElement).toBe(tab('Забеги'));
  expect(host.querySelectorAll('[role=tab][tabindex="0"]')).toHaveLength(1);expect(host.querySelector('[role=tabpanel]')?.getAttribute('aria-labelledby')).toBe('roster-tab-runs');
});
it('warns about the whole run and reloads its collection after deleting a run sheet',async()=>{
  await render('/characters-forge?tab=runs');await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Удалить персонажа"]')!.click());
  expect(host.textContent).toContain('Исходные персонажи сохранятся');fixture.list.mockResolvedValueOnce([fixture.rows[0]]);
  await act(async()=>[...host.querySelectorAll('button')].find(row=>row.textContent==='Удалить персонажа и забег')!.click());
  expect(fixture.remove).toHaveBeenCalledExactlyOnceWith('run');expect(host.textContent).not.toContain('Run hero');expect(host.textContent).toContain('Персонажей забегов пока нет');
});
it('keeps anonymous paper sheets available without requesting private character data',async()=>{
  fixture.authenticated=false;await render('/characters-forge?tab=paper');expect(fixture.list).not.toHaveBeenCalled();expect(host.textContent).toContain('Paper collection');
});
