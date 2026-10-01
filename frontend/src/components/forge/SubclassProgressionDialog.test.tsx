// @vitest-environment jsdom
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,describe,expect,it,vi} from 'vitest';
import type {Action,CharacterClass,PassiveEffect} from '../../types';
import type {AssembledCharacter} from '../../character/assemble';
import SubclassProgressionDialog from './SubclassProgressionDialog';
import LevelUpSubclassAbilities from './LevelUpSubclassAbilities';

(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const api=vi.hoisted(()=>({getClass:vi.fn(),getEffect:vi.fn(),getAction:vi.fn()}));
const mode=vi.hoisted(()=>({effects:'row' as 'row'|'icon',actions:'row' as 'row'|'icon'}));
vi.mock('../../api/client',()=>({classesApi:{getClass:api.getClass},effectsApi:{getEffect:api.getEffect},actionsApi:{getAction:api.getAction}}));
vi.mock('../../settings',()=>({useSiteSettings:()=>({entityDisplay:mode,showVerificationStatus:false})}));
const commonClass={rarity:'common' as const,created_at:'2026-10-01',updated_at:'2026-10-01'};
const subclasses:CharacterClass[]=[{...commonClass,id:'one',card_number:'CLASS-one',name:'Первый путь',description:'Первое описание',level_progression:{'3':{effects:['first']},'7':{actions:['later-action']}}},
  {...commonClass,id:'two',card_number:'CLASS-two',name:'Другой путь',description:'Другое описание',related_effects:['second'],level_progression:{'6':{effects:['later-effect']}}}];
const effects=[{id:'first',name:'Первый дар',description:'Первый дар описание',mechanics:{}}, {id:'second',name:'Другой дар',description:'Другой дар описание',mechanics:{}},
  {id:'later-effect',name:'Поздний дар',description:'Поздний дар описание',mechanics:{}}] as PassiveEffect[];
const actions=[{id:'later-action',name:'Новое действие',description:'Действие описание',mechanics:{}}] as Action[];

describe('level-up canonical subclass presentation',()=>{
  let container:HTMLDivElement,root:Root;
  beforeEach(()=>{
    mode.effects='row';mode.actions='row';
    api.getClass.mockImplementation(async(id:string)=>subclasses.find(subclass=>subclass.id===id));
    api.getEffect.mockImplementation(async(id:string)=>effects.find(effect=>effect.id===id));
    api.getAction.mockImplementation(async(id:string)=>actions.find(action=>action.id===id));
    container=document.createElement('div');document.body.append(container);root=createRoot(container);
  });
  afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.clearAllMocks();});
  it('compares two distinct subclasses with canonical entity headers and level-specific rows',async()=>{
    const close=vi.fn();
    await act(async()=>root.render(<SubclassProgressionDialog subclasses={subclasses} className="Класс" unlockLevel={3} selectedId="one" onClose={close}/>));
    expect(document.body.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Подклассы: Класс');
    expect(container.querySelectorAll('thead .forge-square-card')).toHaveLength(2);
    const rows=[...container.querySelectorAll('tbody tr')];
    expect(rows.map(row=>row.querySelector('th b')?.textContent)).toEqual(['3','6','7']);
    expect(rows[0].querySelectorAll('.sheet-item-row')).toHaveLength(2);
    expect(rows[1].textContent).toContain('Поздний дар');
    expect(rows[2].textContent).toContain('Новое действие');
    const button=[...container.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='Закрыть')!;
    await act(async()=>button.click());
    expect(close).toHaveBeenCalledTimes(1);
  });
  it('preserves the action/effect display setting when showing the selected subclass',async()=>{
    const assembled:Pick<AssembledCharacter,'effects'|'actions'>={effects:[{effect:effects[0],origin:{kind:'class',id:'one',name:'Первый путь',progressionLevel:3}},
      {effect:effects[2],origin:{kind:'class',id:'one',name:'Первый путь',progressionLevel:6}},
      {effect:effects[1],origin:{kind:'class',id:'two',name:'Другой путь',progressionLevel:3}}],actions:[]};
    await act(async()=>root.render(<LevelUpSubclassAbilities assembled={assembled} subclassId="one" classLevel={3}/>));
    expect(container.querySelectorAll('.sheet-item-row')).toHaveLength(1);
    expect(container.textContent).toContain('Новая способность');
    expect(container.textContent).not.toContain('Поздний дар');
    expect(container.textContent).not.toContain('Другой дар');
    mode.effects='icon';
    await act(async()=>root.render(<LevelUpSubclassAbilities assembled={assembled} subclassId="one" classLevel={3}/>));
    expect(container.querySelectorAll('.cs-action-tile')).toHaveLength(1);
    expect(container.querySelector('.sheet-item-row')).toBeNull();
  });
});
