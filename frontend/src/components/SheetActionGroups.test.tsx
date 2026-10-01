// @vitest-environment jsdom
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import type {SheetAction} from '../character/actionSheet';
import {ACTION_PRESENTATION_GROUPS,actionPresentationGroup} from '../character/actionPresentationGroups';
import SheetActionGroups,{sheetActionGroups} from './SheetActionGroups';

(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const actions:SheetAction[]=[
  {id:'item-cast',name:'Item cast',group:'spell',mechanics:{requires_item_source:'wand'}},
  {id:'class',name:'Class',group:'class',mechanics:{}},
  {id:'basic',name:'Basic',group:'basic',mechanics:{}},
  {id:'race',name:'Race',group:'race',mechanics:{}},
  {id:'spell',name:'Spell',group:'spell',mechanics:{}},
  {id:'item-grant',name:'Item grant',group:'class',mechanics:{requires_any_item_source:['amulet','cloak']}},
  {id:'item',name:'Item',group:'item',mechanics:{}},
];

describe('shared sheet and combat action groups',()=>{
  let root:Root,container:HTMLDivElement;
  beforeEach(()=>{container=document.createElement('div');document.body.append(container);root=createRoot(container);});
  afterEach(async()=>{await act(async()=>root.unmount());container.remove();});

  it('orders four semantic groups and combines species/classes while item-owned spells remain with their provider',()=>{
    const grouped=sheetActionGroups(actions);
    expect(grouped.map(group=>group.key)).toEqual(ACTION_PRESENTATION_GROUPS.map(group=>group.id));
    expect(grouped.map(group=>group.items.map(action=>action.id))).toEqual([
      ['basic'],['class','race'],['spell'],['item-cast','item-grant','item'],
    ]);
    expect(actions.map(action=>actionPresentationGroup(action.group,action.mechanics))).toEqual(['items','features','basic','features','spells','items','items']);
  });

  it.each([true,false])('retains the supplied entity renderer and accessible groups in icon mode %s',async icons=>{
    await act(async()=>root.render(<SheetActionGroups groups={sheetActionGroups(actions)} icons={icons}
      renderAction={action=><button key={action.id} data-entity-id={action.id}>{action.name}</button>}/>));
    expect([...container.querySelectorAll('[data-action-group]')].map(node=>node.getAttribute('data-action-group')))
      .toEqual(['basic','features','spells','items']);
    expect([...container.querySelectorAll('[role="group"]')].map(node=>node.getAttribute('aria-label')))
      .toEqual(ACTION_PRESENTATION_GROUPS.map(group=>group.label));
    expect(container.querySelectorAll('[data-entity-id]')).toHaveLength(actions.length);
    expect(container.querySelectorAll(icons?'.cs-action-tiles':'.sheet-item-cols')).toHaveLength(4);
    expect(container.querySelector('h3')).toBeNull();
  });

  it('keeps headings and authored ordering in the separate spell-level catalog, omitting empty groups',async()=>{
    await act(async()=>root.render(<SheetActionGroups groups={[
      {key:'lvl-0',label:'Заговоры',items:[actions[4]]},
      {key:'lvl-1',label:'1 уровень',items:[]},
      {key:'lvl-9',label:'9 уровень',items:[{...actions[4],id:'ninth'}]},
    ]} icons={false} bySpellLevel renderAction={action=><span key={action.id}>{action.name}</span>}/>));
    expect([...container.querySelectorAll('h3')].map(node=>node.textContent)).toEqual(['Заговоры','9 уровень']);
    expect(container.querySelectorAll('[data-action-group]')).toHaveLength(2);
    expect(container.querySelector('.sheet-actions-layout')?.classList.contains('is-spell-catalog')).toBe(true);
  });
});
