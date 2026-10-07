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
async function render(equipment:ForgeCharacter['equipment'],inventory_items:ForgeCharacter['inventory_items']=[]){await act(async()=>root.render(<ChoiceDialogProvider><SheetEquipmentPanel character={{...character,equipment,inventory_items}} ruleState={rules} onUpdated={()=>{}} /></ChoiceDialogProvider>));}
async function showEmpty(){const toggle=host.querySelector<HTMLButtonElement>('.sheet-empty-slots-toggle');expect(toggle).not.toBeNull();await act(async()=>toggle!.click());}

it('announces every shown empty slot and keeps empty slots hidden by default',async()=>{
 const get=vi.spyOn(cardsApi,'getDisplayCardsByIds');await render({});expect(host.querySelector('.sheet-slot-tile')).toBeNull();await showEmpty();
 const slots=host.querySelectorAll<HTMLButtonElement>('.sheet-slot-tile');expect(slots).toHaveLength(10);
 for(const slot of slots)expect(slot.getAttribute('aria-label')).toBe(slot.querySelector('.sheet-slot-tile-label')!.textContent+': свободно');
 expect(get).not.toHaveBeenCalled();
});

it('keeps an occupied loading slot distinct from empty slots and announces the loaded item',async()=>{
 let resolve!:(cards:Card[])=>void;const response=new Promise<Card[]>(done=>{resolve=done;});
 const get=vi.spyOn(cardsApi,'getDisplayCardsByIds').mockReturnValue(response);await render({body:'armor-fixture'});await showEmpty();
 const body=()=>Array.from(host.querySelectorAll<HTMLButtonElement>('.sheet-slot-tile')).find(slot=>slot.querySelector('.sheet-slot-tile-label')?.textContent==='Тело')!;
 expect(body().getAttribute('aria-label')).toBe('Тело: занято');expect(host.querySelector('[aria-label="Голова: свободно"]')).not.toBeNull();
 await act(async()=>resolve([{id:'armor-fixture',name:'Кожаный доспех',type:'chest',description:'',rarity:'common',weight:10,properties:[],card_number:'fixture-chest',is_template:'false',created_at:character.created_at,updated_at:character.updated_at}]));
 expect(body().getAttribute('aria-label')).toBe('Тело: Кожаный доспех');expect(body().querySelector('.sheet-slot-item')?.getAttribute('alt')).toBe('Кожаный доспех');expect(get).toHaveBeenCalledExactlyOnceWith(['armor-fixture']);
});

it('does not announce an occupied slot as free when its item cannot be loaded',async()=>{
 vi.spyOn(cardsApi,'getDisplayCardsByIds').mockRejectedValue(new Error('offline'));vi.spyOn(cardsApi,'getCard').mockRejectedValue(new Error('offline'));await render({body:'armor-fixture'});await showEmpty();
 expect(host.querySelector('[aria-label="Тело: занято"]')).not.toBeNull();expect(host.querySelector('[aria-label="Тело: свободно"]')).toBeNull();
});

it('keeps visible entries when an unavailable inventory item rejects the strict display batch',async()=>{
 const visible:Card={id:'visible-item',name:'Доступный предмет',type:'ring',description:'',rarity:'common',weight:1,properties:[],card_number:'visible',is_template:'false',created_at:character.created_at,updated_at:character.updated_at};
 const batch=vi.spyOn(cardsApi,'getDisplayCardsByIds').mockRejectedValue(new Error('cards unavailable'));
 const detail=vi.spyOn(cardsApi,'getCard').mockImplementation(async id=>{if(id===visible.id)return visible;throw Error('unavailable');});
 await render({body:'unavailable-item'},[{card_id:visible.id,qty:1},{card_id:'unavailable-item',qty:1}]);await showEmpty();
 expect(batch).toHaveBeenCalledExactlyOnceWith(['unavailable-item','visible-item']);
 expect(detail.mock.calls.map(([id])=>id).sort()).toEqual(['unavailable-item','visible-item']);
 expect(host.querySelector('[aria-label="Доступный предмет"]')).not.toBeNull();expect(host.querySelector('[aria-label="Тело: занято"]')).not.toBeNull();
});

it('keeps hydrated details through inventory reordering and reloads a changed membership',async()=>{
 const cards:Card[]=['a','b','c'].map(id=>({id,name:'Предмет '+id,type:'ring',description:'',rarity:'common',weight:1,properties:[],card_number:id,is_template:'false',created_at:character.created_at,updated_at:character.updated_at}));
 const batch=vi.spyOn(cardsApi,'getDisplayCardsByIds').mockImplementation(async ids=>ids.map(id=>cards.find(card=>card.id===id)!));
 await render({},[{card_id:'a',qty:1},{card_id:'b',qty:1}]);
 expect(batch).toHaveBeenCalledExactlyOnceWith(['a','b']);
 await render({},[{card_id:'b',qty:2},{card_id:'a',qty:1}]);
 expect(batch).toHaveBeenCalledTimes(1);
 for(const id of ['a','b'])expect(host.querySelector('[aria-label="Предмет '+id+'"]')).not.toBeNull();
 await render({},[{card_id:'c',qty:1},{card_id:'b',qty:2},{card_id:'a',qty:1}]);
 expect(batch).toHaveBeenCalledTimes(2);expect(batch).toHaveBeenLastCalledWith(['a','b','c']);
 expect(host.querySelector('[aria-label="Предмет c"]')).not.toBeNull();
});
