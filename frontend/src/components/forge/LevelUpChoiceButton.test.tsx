// @vitest-environment jsdom
import {act, useState} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {ChoiceDialogProvider, useChoiceDialog} from '../../contexts/ChoiceDialogContext';
import {levelUpChoiceSelectionLabels, levelUpDialogChoice} from '../../character/levelUpChoices';
import {featForChoiceOption} from '../../character/components';
import type {PendingChoice} from '../../mechanics/collectChoices';
import type {Feat, Spell} from '../../types';
import {getSpellLevelLabel} from '../../types';
import LevelUpChoiceButton from './LevelUpChoiceButton';

(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const displayModes=vi.hoisted(()=>({effects:'row' as 'row'|'icon',spells:'row' as 'row'|'icon',actions:'row' as 'row'|'icon'}));
vi.mock('../../settings',()=>({useSiteSettings:()=>({entityDisplay:displayModes,showVerificationStatus:false})}));
const feats=[{id:'feat',card_number:'FEAT-one',name:'Feat one',description:'One',category:'general',rarity:'common'},
  {id:'style',card_number:'STYLE-one',name:'Style one',description:'Two',category:'fighting_style',rarity:'common'},
  {id:'other',card_number:'FEAT-other',name:'Feat two',description:'Other',category:'general',rarity:'common'}] as Feat[];

function Harness({choice,onCommit,spells=[]}:{choice:PendingChoice;onCommit:(values:string[])=>void;spells?:Spell[]}) {
  const dialog=useChoiceDialog();
  const [selected,setSelected]=useState<string[]>([]);
  return <LevelUpChoiceButton choice={choice} selectedLabels={levelUpChoiceSelectionLabels(choice,selected,feats,spells)}
    selectedFeats={choice.source==='feat'?selected.flatMap(id=>{const feat=featForChoiceOption(choice,id,feats);return feat?[feat]:[];}):[]}
    selectedSpells={choice.source==='spell'?spells.filter(spell=>selected.includes(spell.id)):[]}
    onActivate={()=>{void (async()=>{
    const request=levelUpDialogChoice(choice,spells,1,selected,feats);
    const picked=await dialog.request([request],choice.prompt,{feats,presentation:'levelup',canApply:values=>(values[choice.id]?.length??0)===choice.count});
    if(picked){setSelected(picked[choice.id]);onCommit(picked[choice.id]);}
  })();}}/>;
}

describe('level-up choice dialog buttons',()=>{
  let root:Root,container:HTMLDivElement;
  beforeEach(()=>{displayModes.effects='row';displayModes.spells='row';container=document.createElement('div');document.body.append(container);root=createRoot(container);});
  afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
  const click=async(text:string)=>{const button=[...document.body.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.getAttribute('aria-label')===text||button.textContent?.trim()===text);expect(button).toBeDefined();await act(async()=>button!.click());};
  it.each([['general','feat','Feat one'],['fighting_style','style','Style one']])('selects %s through the shared canonical feat resolver, while cancellation preserves draft',async(filter,id,label)=>{
    displayModes.effects='icon';
    const choice={id:'choice',source:'feat',filter,count:1,prompt:'Choose '+filter,origin:{kind:'class',id:'class',name:'Class'}} as PendingChoice;
    const commit=vi.fn();
    await act(async()=>root.render(<ChoiceDialogProvider><Harness choice={choice} onCommit={commit}/></ChoiceDialogProvider>));
    expect(container.textContent).toContain('Выбрано 0 из 1');
    await click(choice.prompt);
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    await click('Отмена');
    expect(commit).not.toHaveBeenCalled();
    await click(choice.prompt);
    const tile=[...document.body.querySelectorAll<HTMLButtonElement>('.forge-square-card')].find(button=>button.textContent?.includes(label))!;
    expect(tile).toBeDefined();
    await act(async()=>tile.click());
    expect(commit).not.toHaveBeenCalled();
    expect(container.querySelector('.choice-count')?.textContent?.trim()).toBe('Выбрано 0 из 1');
    await click('Применить');
    expect(commit).toHaveBeenCalledExactlyOnceWith([id]);
    expect(container.textContent).toContain('Выбрано 1 из 1');
    expect(container.textContent).toContain(label);
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    await click('Изменить: '+label);
    const selected=[...document.body.querySelectorAll<HTMLButtonElement>('.forge-choice-dialog .forge-square-card.selected')];
    expect(selected.some(button=>button.textContent?.includes(label))).toBe(true);
    await click('Отмена');
    expect(commit).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain(label);
  });
  it('learns spells through the canonical spell row with count and commits only confirmed choices',async()=>{
    const spells=[{id:'spell',card_number:'SPELL-renamed',name:'Ordinary spell',description:'Spell',level:1,classes:[]},
      {id:'child',card_number:'SPELL-child',name:'Child spell',description:'Child',level:1,classes:[],mechanics:{variant_of_spell_id:'spell'}}] as unknown as Spell[];
    const choice={id:'learn',source:'spell',count:1,prompt:'Learn a spell',origin:{kind:'class',id:'class',name:'Class'},options:{filter:{only_available_slots:true}}} as PendingChoice;
    const commit=vi.fn();
    await act(async()=>root.render(<ChoiceDialogProvider><Harness choice={choice} onCommit={commit} spells={spells}/></ChoiceDialogProvider>));
    await click(choice.prompt);
    expect(document.body.textContent).not.toContain('Child spell');
    const row=document.body.querySelector<HTMLButtonElement>('.choice-spell-entities .sheet-item-row');
    expect(row?.textContent).toContain('Ordinary spell');
    await act(async()=>row!.click());
    expect(commit).not.toHaveBeenCalled();
    await click('Применить');
    expect(commit).toHaveBeenCalledExactlyOnceWith(['spell']);
    expect(container.textContent).toContain('Выбрано 1 из 1');
    expect(container.textContent).toContain('Ordinary spell');
    expect(container.querySelector('.levelup-choice-selected-spells .sheet-item-row')?.textContent).toContain('Ordinary spell');
    await click('Изменить: '+choice.prompt);
    expect(document.body.querySelector('.forge-choice-dialog .sheet-item-row.is-selected')?.textContent).toContain('Ordinary spell');
    await click('Отмена');
    expect(commit).toHaveBeenCalledTimes(1);
  });
  it('keeps multi-spell counts and blocks confirmation until all choices are selected',async()=>{
    const spells=[{id:'one',card_number:'SPELL-one',name:'Spell one',description:'One',level:2,classes:[]},
      {id:'two',card_number:'SPELL-two',name:'Spell two',description:'Two',level:0,classes:[]}] as unknown as Spell[];
    const choice={id:'learn-two',source:'spell',count:2,prompt:'Learn two spells',origin:{kind:'class',id:'class',name:'Class'},filter:'all'} as PendingChoice;
    const commit=vi.fn();
    await act(async()=>root.render(<ChoiceDialogProvider><Harness choice={choice} onCommit={commit} spells={spells}/></ChoiceDialogProvider>));
    await click(choice.prompt);
    expect([...document.body.querySelectorAll('.forge-choice-dialog .choice-spell-level')].map(heading=>heading.textContent)).toEqual([getSpellLevelLabel(0),getSpellLevelLabel(2)]);
    const rows=[...document.body.querySelectorAll<HTMLButtonElement>('.forge-choice-dialog .choice-spell-entities .sheet-item-row')];
    expect(rows.map(row=>row.textContent?.split('Выбрано')[0])).toEqual(expect.arrayContaining([expect.stringContaining('Spell two'),expect.stringContaining('Spell one')]));
    await act(async()=>rows[0].click());
    expect([...document.body.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent?.trim()==='Применить')?.disabled).toBe(true);
    expect(commit).not.toHaveBeenCalled();
    await act(async()=>rows[1].click());
    await click('Применить');
    expect(commit).toHaveBeenCalledExactlyOnceWith(['two','one']);
    expect(container.textContent).toContain('Выбрано 2 из 2');
    expect(container.querySelectorAll('.levelup-choice-selected-spells .sheet-item-row')).toHaveLength(2);
  });
  it('uses canonical feat cards and previews in icon mode and retains confirmed choices when editing is canceled',async()=>{
    displayModes.effects='icon';
    const choice={id:'icon-feat',source:'feat',filter:'general',count:1,prompt:'Choose a feat',origin:{kind:'class',id:'class',name:'Class'}} as PendingChoice;
    const commit=vi.fn();
    await act(async()=>root.render(<ChoiceDialogProvider><Harness choice={choice} onCommit={commit}/></ChoiceDialogProvider>));
    await click(choice.prompt);
    const tile=[...document.body.querySelectorAll<HTMLButtonElement>('.forge-choice-dialog .forge-square-card')].find(button=>button.textContent?.includes('Feat one'))!;
    await act(async()=>tile.click());
    await click('Применить');
    const selected=container.querySelector<HTMLButtonElement>('.levelup-selected-feat .forge-square-card');
    expect(selected?.textContent).toContain('Feat one');
    await act(async()=>selected!.dispatchEvent(new MouseEvent('mouseover',{bubbles:true})));
    expect(document.body.querySelector('.entity-preview-enter')?.textContent).toContain('One');
    await act(async()=>selected!.dispatchEvent(new MouseEvent('mouseout',{bubbles:true})));
    await click('Изменить: Feat one');
    const other=[...document.body.querySelectorAll<HTMLButtonElement>('.forge-choice-dialog .forge-square-card')].find(button=>button.textContent?.includes('Feat two'))!;
    await act(async()=>other.click());
    await click('Отмена');
    expect(commit).toHaveBeenCalledExactlyOnceWith(['feat']);
    expect(container.querySelector('.levelup-selected-feat')?.textContent).toContain('Feat one');
  });
  it.each([
    ['value', {id:'pick-first',name:'First offered feat',value:'FEAT-one'}, 'Feat one'],
    ['grant', {id:'pick-second',name:'Other offered feat',grants:[{kind:'grant_feat',value:'other'}]}, 'Feat two'],
  ])('uses canonical feat rows for explicit %s payloads while persisting the original option id',async(_kind,item,label)=>{
    const choice={id:'explicit-feat',source:'feat',count:1,prompt:'Pick declared feat',items:[item],origin:{kind:'class',id:'class',name:'Class'}} as PendingChoice;
    const commit=vi.fn();
    await act(async()=>root.render(<ChoiceDialogProvider><Harness choice={choice} onCommit={commit}/></ChoiceDialogProvider>));
    await click(choice.prompt);
    expect(document.activeElement).toBe(document.body.querySelector('.forge-choice-dialog'));
    const row=document.body.querySelector<HTMLButtonElement>('.forge-choice-dialog .choice-feat-rows .sheet-item-row');
    expect(row?.textContent).toContain(label);
    expect(document.body.querySelector('.forge-choice-dialog .forge-square-card')).toBeNull();
    await act(async()=>row!.click());
    await click('Применить');
    expect(commit).toHaveBeenCalledExactlyOnceWith([item.id]);
    expect(container.querySelector('.levelup-selected-feat .sheet-item-row')?.textContent).toContain(label);
    expect(container.querySelector('.levelup-choice-labels')).toBeNull();
    await click('Изменить: '+label);
    expect(document.body.querySelector('.forge-choice-dialog .sheet-item-row.is-selected')?.textContent).toContain(label);
    await click('Отмена');
    expect(commit).toHaveBeenCalledTimes(1);
  });
  it('waits for the canonical catalog before opening a choice and becomes available once loaded',async()=>{
    const choice={id:'loading',source:'feat',count:1,prompt:'Pick feat',origin:{kind:'class',id:'class',name:'Class'}} as PendingChoice;
    const activate=vi.fn();
    const render=(loading:boolean)=><LevelUpChoiceButton choice={choice} selectedLabels={[]} loading={loading} onActivate={activate}/>;
    await act(async()=>root.render(render(true)));
    expect(container.querySelector('.levelup-choice')?.getAttribute('aria-busy')).toBe('true');
    await click(choice.prompt);
    expect(activate).not.toHaveBeenCalled();
    await act(async()=>root.render(render(false)));
    await click(choice.prompt);
    expect(activate).toHaveBeenCalledTimes(1);
  });
  it('keeps a declared unknown payload selectable instead of losing it beside resolved feat rows',async()=>{
    const choice={id:'mixed',source:'feat',count:1,prompt:'Mixed domain',items:[{id:'first',name:'First',value:'FEAT-one'},{id:'unknown',name:'Other declared option'}],origin:{kind:'class',id:'class',name:'Class'}} as PendingChoice;
    const commit=vi.fn();
    await act(async()=>root.render(<ChoiceDialogProvider><Harness choice={choice} onCommit={commit}/></ChoiceDialogProvider>));
    await click(choice.prompt);
    expect(document.body.querySelector('.choice-feat-rows .sheet-item-row')?.textContent).toContain('Feat one');
    await click('Other declared option');
    await click('Применить');
    expect(commit).toHaveBeenCalledExactlyOnceWith(['unknown']);
    expect(container.querySelector('.levelup-choice-labels')?.textContent).toContain('Other declared option');
  });
});
