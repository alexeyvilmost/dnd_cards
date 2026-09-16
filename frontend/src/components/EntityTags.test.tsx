// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import EntityTags from './EntityTags';
const state=vi.hoisted(()=>({playerMode:false}));
const api=vi.hoisted(()=>({get:vi.fn(),list:vi.fn(),set:vi.fn(),create:vi.fn()}));
vi.mock('../settings',()=>({useSiteSettings:()=>state}));
vi.mock('../api/entityTags',()=>({entityTagsApi:api,tagError:()=> 'Ошибка',merchantSettingsApi:{}}));
let root:Root;
async function renderNode(node:React.ReactNode){const container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);await act(async()=>{root.render(node)});return container;}
afterEach(async()=>{if(root)await act(async()=>root.unmount());document.body.replaceChildren();vi.clearAllMocks();state.playerMode=false});
describe('Entity tags',()=>{
 it('does not display or request metadata in player mode',async()=>{state.playerMode=true;const container=await renderNode(<MemoryRouter><EntityTags type="feat" id="f"/></MemoryRouter>);expect(container.querySelector('.entity-tags')).toBeNull();expect(api.get).not.toHaveBeenCalled()});
 it('renders registered tags with filter links and updates another entity through the same UI',async()=>{
  const a={id:'a',name:'Предмет забега',description:'Пул'},b={id:'b',name:'Другая группа',description:'Произвольный тег'};
  api.get.mockResolvedValue([a]);api.list.mockResolvedValue({tags:[a,b],can_manage:true});api.set.mockResolvedValue(undefined);
  const container=await renderNode(<MemoryRouter><EntityTags type="feat" id="second-entity"/></MemoryRouter>);
  expect(container.querySelector('a')?.getAttribute('href')).toBe('/?type=feats&tag=a');
  await act(async()=>{(container.querySelectorAll('input[type="checkbox"]')[1] as HTMLInputElement).click()});
  expect(api.set).toHaveBeenCalledWith('feat','second-entity',['a','b']);
  expect(container.querySelectorAll('a')).toHaveLength(2);
 });
});
