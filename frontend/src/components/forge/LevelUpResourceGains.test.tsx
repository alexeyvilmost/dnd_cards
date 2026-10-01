// @vitest-environment jsdom
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,describe,expect,it,vi} from 'vitest';
import type {ResourceOption} from '../../utils/resources';
import LevelUpResourceGains from './LevelUpResourceGains';

(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
vi.mock('../../settings',()=>({useSiteSettings:()=>({showVerificationStatus:false})}));
const options:ResourceOption[]=[{id:'pool-a',entityId:'entity-a',label:'Первый ресурс',description:'Первое описание',category:'class_resource',recharge:'short_rest'},
  {id:'pool-b',entityId:'entity-b',label:'Другой ресурс',description:'Другое описание',category:'character_resource',recharge:'long_rest'}];

describe('new resource canonical previews',()=>{
  let container:HTMLDivElement,root:Root;
  beforeEach(()=>{container=document.createElement('div');document.body.append(container);root=createRoot(container);});
  afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
  it.each([['pool-a','Первый ресурс','Первое описание','Короткий отдых'],['pool-b','Другой ресурс','Другое описание','Длинный отдых']])('previews %s definition and projected maximum without displaying future capacity as unspent charges',async(key,name,description,recharge)=>{
    await act(async()=>root.render(<LevelUpResourceGains gains={[{key,before:1,after:3,delta:2}]} options={options}
      sources={{[key]:[{value:3,source:'Источник роста',reason:'На новом уровне'}]}}/>));
    const button=container.querySelector<HTMLButtonElement>('button')!;
    expect(button.getAttribute('aria-label')).toBe(`${name}: максимум 1 → 3`);
    expect(button.textContent).toContain('1 → 3');
    await act(async()=>button.focus());
    const preview=document.body.querySelector('[role="tooltip"]');
    expect(preview?.textContent).toContain(description);
    expect(preview?.textContent).toContain(recharge);
    expect(preview?.textContent).toContain('Источник роста');
    expect(preview?.textContent).not.toContain('Осталось:');
  });
});
