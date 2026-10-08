// @vitest-environment jsdom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
import {SummaryPanel} from './components';
import {emptyDraft} from './types';
import type {AssembledCharacter} from './assemble';
const settings=vi.hoisted(()=>({hideTechnicalAbilities:true,entityDisplay:{effects:'icon',actions:'row'}}));
vi.mock('../settings',()=>({useSiteSettings:()=>settings}));
vi.mock('../components/forge/ForgeAbilityDisplay',()=>({default:({entries,mode}:{entries:{name:string}[];mode:string})=><div data-mode={mode}>{entries.map(entry=><span key={entry.name}>{entry.name}</span>)}</div>}));
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
it('uses each entity display preference and excludes cancelled sources from the summary',async()=>{
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 const origin={kind:'race',id:'race',name:'Вид'};
 const assembled={race:{id:'race',name:'Вид'},background:{id:'bg',name:'Предыстория'},effects:[{effect:{id:'effect',name:'Особенность'},origin}],actions:[{action:{id:'action',name:'Действие'},origin}],feats:[],derived:{maxHP:8,ac:10,proficiencyBonus:2}} as unknown as AssembledCharacter;
 await act(async()=>root.render(<SummaryPanel draft={{...emptyDraft(),raceId:'race',backgroundId:'bg'}} assembled={assembled} spells={[]} />));
 expect(host.querySelector('[data-mode="icon"]')?.textContent).toContain('Особенность');expect(host.querySelector('[data-mode="row"]')?.textContent).toContain('Действие');
 await act(async()=>root.render(<SummaryPanel draft={emptyDraft()} assembled={assembled} spells={[]} />));
 expect(host.textContent).not.toContain('Особенность');expect(host.textContent).not.toContain('Действие');expect(host.textContent).toContain('Предыстория: —');
 await act(async()=>root.unmount());host.remove();
});
