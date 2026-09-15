// @vitest-environment jsdom
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {setSetting, getSettings} from '../settings';
import {ChoiceResolver} from '../character/components';
import RollInfluenceActions from './RollInfluenceActions';
import type {Spell} from '../types';
import {availableRollInfluences} from '../engine/rollInfluence';
import {rollD20} from '../engine/roll';

vi.mock('./ActionPreview',()=>({default:({action}:{action:{name:string}})=><article data-testid="action-preview">{action.name}</article>}));
vi.mock('./SpellPreview',()=>({default:({spell}:{spell:{name:string}})=><article data-testid="spell-preview">{spell.name}</article>}));
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
describe('canonical entity choices respect per-type display settings',()=>{
  let root:Root,container:HTMLDivElement;
  beforeEach(()=>{localStorage.clear();container=document.createElement('div');document.body.append(container);root=createRoot(container);});
  afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
  it.each(['row','icon'] as const)('renders roll influence as an action in %s mode, with the action preview',async mode=>{
    setSetting('entityDisplay',{...getSettings().entityDisplay,actions:mode});
    const actions=availableRollInfluences({resources:{heroic_inspiration:1},maxResources:{},hp:{current:10,max:10,temp:0},inventory:[],equipment:{},activeEffects:[]},[],'check',rollD20({rng:()=>.1}));
    const use=vi.fn();
    await act(async()=>root.render(<RollInfluenceActions actions={actions} onUse={use}/>));
    const button=container.querySelector<HTMLButtonElement>('button')!;
    expect(button.classList.contains(mode==='icon'?'cs-action-tile':'sheet-item-row')).toBe(true);
    await act(async()=>button.focus());
    expect(document.querySelector('[data-testid="action-preview"]')?.textContent).toBe('Героическое вдохновение');
    await act(async()=>button.click());expect(use).toHaveBeenCalledWith('core.heroic-inspiration');
  });
  it.each(['row','icon'] as const)('renders prepared spells in %s mode, preserving choice IDs and selected state',async mode=>{
    setSetting('entityDisplay',{...getSettings().entityDisplay,spells:mode,actions:mode==='row'?'icon':'row'});
    const change=vi.fn();
    const spell={id:'spell-id',name:'Щит',level:1,description:'Реакция'} as Spell;
    await act(async()=>root.render(<ChoiceResolver choice={{id:'prepare',prompt:'Подготовить',source:'prepared_spell',count:1,
      origin:{id:'class',kind:'class',name:'Волшебник'},items:[{id:'SPELL-REFERENCE',name:spell.name,previewSpell:spell}]}}
      value={['SPELL-REFERENCE']} onChange={change}/>));
    const button=container.querySelector<HTMLButtonElement>('button')!;
    expect(button.classList.contains(mode==='icon'?'cs-action-tile':'sheet-item-row')).toBe(true);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    await act(async()=>button.focus());expect(document.querySelector('[data-testid="spell-preview"]')?.textContent).toBe('Щит');
    await act(async()=>button.click());expect(change).toHaveBeenCalledWith([]);
  });
});
