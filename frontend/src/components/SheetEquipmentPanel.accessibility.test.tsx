// @vitest-environment jsdom
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import SheetEquipmentPanel from './SheetEquipmentPanel';
import {ChoiceDialogProvider} from '../contexts/ChoiceDialogContext';
import {cardsApi} from '../api/client';
import {setEntityDisplay} from '../settings';
import type {ForgeCharacter} from '../character/types';
import type {CharacterRuleState} from '../character/rules/types';
import type {Card} from '../types';

(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let host:HTMLDivElement,root:Root;
const character:ForgeCharacter={id:'sheet-accessibility',user_id:'fixture-owner',name:'Персонаж',system_id:'dnd5e-2024',ruleset_version:'2024',character_type:'free',character_schema_version:1,level:1,max_hp:10,current_hp:10,speed:30,proficiency_bonus:2,access_mode:'owner',created_at:'2026-10-06T00:00:00Z',updated_at:'2026-10-06T00:00:00Z',inventory_items:[],equipment:{}};
const rules={carryingCapacity:150,size:2} as CharacterRuleState;
beforeEach(()=>{localStorage.clear();setEntityDisplay('items','icon');host=document.createElement('div');root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());vi.restoreAllMocks();localStorage.clear();});
async function render(equipment:ForgeCharacter['equipment']){await act(async()=>root.render(<ChoiceDialogProvider><SheetEquipmentPanel character={{...character,equipment}} ruleState={rules} onUpdated={()=>{}} /></ChoiceDialogProvider>));}
async function showEmpty(){const toggle=host.querySelector<HTMLButtonElement>('.sheet-empty-slots-toggle');expect(toggle).not.toBeNull();await act(async()=>toggle!.click());}

it('announces every shown empty slot and keeps empty slots hidden by default',async()=>{
 const get=vi.spyOn(cardsApi,'getCard');await render({});expect(host.querySelector('.sheet-slot-tile')).toBeNull();await showEmpty();
 const slots=host.querySelectorAll<HTMLButtonElement>('.sheet-slot-tile');expect(slots).toHaveLength(10);
 for(const slot of slots)expect(slot.getAttribute('aria-label')).toBe(slot.querySelector('.sheet-slot-tile-label')!.textContent+': свободно');
 expect(get).not.toHaveBeenCalled();
});

it('keeps an occupied loading slot distinct from empty slots and announces the loaded item',async()=>{
 let resolve!:(card:Card)=>void;const response=new Promise<Card>(done=>{resolve=done;});
 const get=vi.spyOn(cardsApi,'getCard').mockReturnValue(response);await render({body:'armor-fixture'});await showEmpty();
 const body=()=>Array.from(host.querySelectorAll<HTMLButtonElement>('.sheet-slot-tile')).find(slot=>slot.querySelector('.sheet-slot-tile-label')?.textContent==='Тело')!;
 expect(body().getAttribute('aria-label')).toBe('Тело: занято');expect(host.querySelector('[aria-label="Голова: свободно"]')).not.toBeNull();
 await act(async()=>resolve({id:'armor-fixture',name:'Кожаный доспех',type:'chest',description:'',rarity:'common',weight:10,properties:[],card_number:'fixture-chest',is_template:'false',created_at:character.created_at,updated_at:character.updated_at}));
 expect(body().getAttribute('aria-label')).toBe('Тело: Кожаный доспех');expect(body().querySelector('.sheet-slot-item')?.getAttribute('alt')).toBe('Кожаный доспех');expect(get).toHaveBeenCalledExactlyOnceWith('armor-fixture');
});

it('does not announce an occupied slot as free when its item cannot be loaded',async()=>{
 vi.spyOn(cardsApi,'getCard').mockRejectedValue(new Error('offline'));await render({body:'armor-fixture'});await showEmpty();
 expect(host.querySelector('[aria-label="Тело: занято"]')).not.toBeNull();expect(host.querySelector('[aria-label="Тело: свободно"]')).toBeNull();
});
