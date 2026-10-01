// @vitest-environment jsdom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {describe,it,expect,vi} from 'vitest';
import SheetFeatureSections from './SheetFeatureSections';
import type {AssembledCharacter} from '../character/assemblyFactory';
vi.mock('../settings',()=>({useSiteSettings:()=>({entityDisplay:{effects:'row',actions:'icon'}})}));
vi.mock('./forge/ForgeAbilityDisplay',()=>({default:({entries,mode}:{entries:{key:string;name:string;iconShape?:string}[];mode:string})=><div data-mode={mode}>{entries.map(e=><span key={e.key} data-shape={e.iconShape}>{e.name}</span>)}</div>}));
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
describe('canonical feature source sections',()=>{
 it('groups sources and styles without repeating the feat summary; preserves each entity display mode',async()=>{
   const assembled={feats:[{id:'tough',name:'Крепкий'},{id:'style',name:'Оборона',category:'fighting_style'}],
     effects:[{effect:{id:'tough-effect',name:'Крепкий'},origin:{kind:'feat',id:'tough',name:'Крепкий'}},
       {effect:{id:'style-effect',name:'Боевой стиль: Оборона'},origin:{kind:'feat',id:'style',name:'Оборона'}},
       {effect:{id:'race-effect',name:'Тёмное зрение'},origin:{kind:'race',id:'elf',name:'Эльф'}}],
     actions:[{action:{id:'other-action',name:'Действие предмета'},origin:{kind:'other',id:'item',name:'Предмет'}}]} as unknown as AssembledCharacter;
   const host=document.createElement('div'),root=createRoot(host);
   try {
     await act(async()=>root.render(<SheetFeatureSections assembled={assembled}/>));
     expect(host.querySelector('[aria-label="Способности вида"]')?.textContent).toContain('Тёмное зрение');
     expect(host.querySelector('[aria-label="Черты"]')?.textContent).toBe('ЧертыКрепкий');
     expect(host.querySelector('[aria-label="Способности класса"]')?.textContent).toContain('Оборона');
     expect(host.querySelector('[aria-label="Прочие способности"] [data-mode="icon"]')?.textContent).toBe('Действие предмета');
   }finally{await act(async()=>root.unmount());}
 });
 it('uses circular passive species/class icons while preserving active abilities and view modes',async()=>{
   const assembled={feats:[],effects:[
     {effect:{id:'senses',name:'Чувства',mechanics:{activation:{mode:'passive'}}},origin:{kind:'race',id:'species',name:'Вид'}},
     {effect:{id:'training',name:'Подготовка'},origin:{kind:'class',id:'class',name:'Класс'}},
     {effect:{id:'power',name:'Активная способность',mechanics:{activation:{mode:'active'}}},origin:{kind:'class',id:'class',name:'Класс'}},
   ],actions:[]} as unknown as AssembledCharacter;
   const host=document.createElement('div'),root=createRoot(host);
   try{
     await act(async()=>root.render(<SheetFeatureSections assembled={assembled}/>));
     const entities=[...host.querySelectorAll('[data-shape]')];
     expect(entities.map(node=>[node.textContent,node.getAttribute('data-shape')])).toEqual([
       ['Чувства','round'],['Подготовка','round'],['Активная способность','square'],
     ]);
     expect(host.querySelector('[aria-label="Способности класса"] [data-mode]')?.getAttribute('data-mode')).toBe('row');
   }finally{await act(async()=>root.unmount());}
 });
});
