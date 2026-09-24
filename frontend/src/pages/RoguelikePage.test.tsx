// @vitest-environment jsdom
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import RoguelikePage from './RoguelikePage';
import {roguelikeApi} from '../roguelike/api';
import {characterTemplatesApi} from '../character/templatesApi';

(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const fixtures=vi.hoisted(()=>{
 const characters=Array.from({length:9},(_,index)=>({id:`hero-${index}`,name:`Герой ${index}`,class_id:'fighter',race_id:'human',level:1,access_mode:'owner',character_type:'free',system_id:'dnd5e',ruleset_version:'2024'}));
 return {characters};
});
vi.mock('../character/api',()=>({charactersV3Api:{list:vi.fn(async()=>fixtures.characters)},characterV3ErrorMessage:()=> 'Ошибка'}));
vi.mock('../api/client',()=>({classesApi:{getClasses:vi.fn(async()=>({classes:[{id:'fighter',card_number:'CLASS-warrior'}]})),getClass:vi.fn(async()=>({name:'Воин'}))},racesApi:{getRace:vi.fn(async()=>({name:'Человек'}))}}));
vi.mock('../api/entityTags',()=>({merchantSettingsApi:{get:vi.fn(async()=>({can_manage:false}))}}));
vi.mock('../components/RunPartyCamp',()=>({default:()=>null}));
vi.mock('../components/MerchantSettingsDialog',()=>({default:()=>null}));
vi.mock('../roguelike/api',()=>({roguelikeApi:{create:vi.fn(async()=>({id:'new-run'})),listSelection:vi.fn(async()=>({unavailable_source_character_ids:['hero-6'],runs:[
  {id:'party-run',source_character_id:'hero-7',characters:fixtures.characters.slice(0,3),experience:150,encounters_won:2,attempt:1,status:'active',phase:'camp'},
  {id:'solo-run',character:fixtures.characters[3],experience:0,encounters_won:0,attempt:2,status:'defeat',phase:'ended'},
 ]}))}}));
vi.mock('../character/templatesApi',()=>({characterTemplatesApi:{copy:vi.fn(async(id:string)=>({id:`copy-${id}`})),list:vi.fn(async()=>({templates:[{id:'preset',name:'Мечник',preset_key:'swordsman',character:fixtures.characters[0]},{id:'archer',name:'Лучник',preset_key:'archer',character:fixtures.characters[1]}],can_manage:false}))}}));
let root:Root,container:HTMLDivElement;
beforeEach(async()=>{container=document.createElement('div');document.body.append(container);root=createRoot(container);await act(async()=>{root.render(<MemoryRouter><RoguelikePage/></MemoryRouter>);});});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.clearAllMocks();});
it('places presets then personal characters in the left column, with group participants on the right',()=>{
 const columns=container.querySelectorAll('.roguelike-start-columns > section');expect(columns).toHaveLength(2);
 expect(columns[0].querySelector('h2')?.textContent).toBe('Начать новый забег');
 expect(columns[1].querySelector('h2')?.textContent).toBe('Продолжить забег');
 expect(columns[0].querySelector('.run-preset-row')?.textContent).toContain('Мечник | Человек | Воин — 1');
 expect(columns[0].textContent!.indexOf('Мечник')).toBeLessThan(columns[0].textContent!.indexOf('Ваши персонажи'));
 expect(columns[0].textContent).not.toMatch(/КД|Хиты/);
 const party=columns[1].querySelector('[href="/roguelike/party-run"]')!;
 expect(party.querySelectorAll('.run-character-identity')).toHaveLength(3);
 expect(party.textContent).toContain('Герой 2');expect(party.textContent).toContain('В лагере');
 expect(columns[1].querySelector('[href="/roguelike/solo-run"]')?.textContent).toContain('Поражение');
});
it('creates a group entirely from presets through one naming dialog',async()=>{
 for(const box of container.querySelectorAll<HTMLInputElement>('.run-preset-row input')) await act(async()=>box.click());
 await act(async()=>container.querySelector<HTMLButtonElement>('.run-start-footer button')!.click());
 const dialog=container.querySelector('[role="dialog"]')!;expect(dialog).not.toBeNull();
 const launch=[...dialog.querySelectorAll('button')].find(button=>button.textContent==='Создать и начать забег');
 expect(launch).toBeDefined();expect(launch!.disabled).toBe(false);
 expect(dialog.querySelectorAll('input')).toHaveLength(2);
 await act(async()=>launch!.click());
 expect(characterTemplatesApi.copy).toHaveBeenCalledWith('preset','Мечник');
 expect(characterTemplatesApi.copy).toHaveBeenCalledWith('archer','Лучник');
 expect(roguelikeApi.create).toHaveBeenCalledWith(['copy-preset','copy-archer']);
});
it('keeps the six-member limit and submits selected personal characters',async()=>{
 const boxes=[...container.querySelectorAll<HTMLInputElement>('.run-party-selection input')];expect(boxes).toHaveLength(7);
 for(const box of boxes.slice(0,6)) await act(async()=>box.click());
 expect(boxes[6].disabled).toBe(true);
 const launch=[...container.querySelectorAll('button')].find(button=>button.textContent==='Начать забег · 6')!;
 await act(async()=>launch.click());
 expect(roguelikeApi.create).toHaveBeenCalledWith(fixtures.characters.slice(0,6).map(c=>c.id));
});
it('combines presets with a personal character and excludes occupied sources including those outside the displayed runs',async()=>{
 const personal=container.querySelector('.run-party-selection')!;
 expect(personal.textContent).not.toContain('Герой 6');expect(personal.textContent).not.toContain('Герой 7');
 await act(async()=>personal.querySelector<HTMLInputElement>('input')!.click());
 await act(async()=>container.querySelector<HTMLInputElement>('.run-preset-row input')!.click());
 await act(async()=>container.querySelector<HTMLButtonElement>('.run-start-footer button')!.click());
 const dialog=container.querySelector('[role="dialog"]')!;expect(dialog.textContent).toContain('Также в группе: Герой 0');
 await act(async()=>dialog.querySelector<HTMLButtonElement>('.roguelike-primary')!.click());
 expect(roguelikeApi.create).toHaveBeenCalledWith(['hero-0','copy-preset']);
});
it('puts selection instructions in the shared hover preview rather than the page text',async()=>{
 expect(container.textContent).not.toContain('Выберите от 1 до 6');
 const help=container.querySelector('[aria-label="Как собрать группу"]')!;
 await act(async()=>help.dispatchEvent(new MouseEvent('mouseover',{bubbles:true})));
 expect(document.querySelector('[role="tooltip"]')?.textContent).toContain('Можно сочетать пресеты и своих персонажей');
});
