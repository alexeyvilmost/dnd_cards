// @vitest-environment jsdom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
import type {AssembledCharacter} from '../../character/assemble';
import ForgeOriginAbilities from './ForgeOriginAbilities';
vi.mock('../../settings',()=>({useSiteSettings:()=>({entityDisplay:{effects:'row',actions:'row'},hideTechnicalAbilities:true})}));
vi.mock('./ForgeAbilityDisplay',()=>({default:({entries}:{entries:Array<{name:string}>})=><>{entries.map(entry=><span key={entry.name}>{entry.name}</span>)}</>}));
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
it.each(['race','class'] as const)('hides both child features and actions while preserving the main %s',async kind=>{
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  const origin=(id:string)=>({kind,id,name:id});
  const assembled={effects:[{origin:origin('parent'),effect:{id:'base',name:'Основная особенность'}},{origin:origin('child'),effect:{id:'extra',name:'Особенность варианта'}}],actions:[{origin:origin('parent'),action:{id:'base-action',name:'Основное действие'}},{origin:origin('child'),action:{id:'child-action',name:'Действие варианта'}}]} as unknown as AssembledCharacter;
  await act(async()=>root.render(<ForgeOriginAbilities assembled={assembled} kind={kind}/>));
  expect(host.textContent).toContain('Особенность варианта');expect(host.textContent).toContain('Действие варианта');
  await act(async()=>root.render(<ForgeOriginAbilities assembled={assembled} kind={kind} hiddenOriginIds={['child']}/>));
  expect(host.textContent).toContain('Основная особенность');expect(host.textContent).toContain('Основное действие');
  expect(host.textContent).not.toContain('Особенность варианта');expect(host.textContent).not.toContain('Действие варианта');
  await act(async()=>root.render(<ForgeOriginAbilities assembled={assembled} kind={kind} hiddenOriginIds={['child','parent']}/>));
  expect(host.textContent).toBe('');
  await act(async()=>root.unmount());host.remove();
});
