// @vitest-environment jsdom
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import type {ReactNode} from 'react';
import type {ForgeCharacter} from '../character/types';
import type {RoguelikeRun} from '../roguelike/api';
import RunShopInventory from './RunShopInventory';

const mocks=vi.hoisted(()=>({getCard:vi.fn(),getRun:vi.fn(),command:vi.fn(),getCharacter:vi.fn(),sell:vi.fn(),updated:vi.fn()}));
vi.mock('../api/client',()=>({cardsApi:{getCard:mocks.getCard}}));
vi.mock('../roguelike/api',()=>({roguelikeApi:{get:mocks.getRun,command:mocks.command}}));
vi.mock('../character/api',()=>({charactersV3Api:{get:mocks.getCharacter,sellItem:mocks.sell}}));
vi.mock('../roguelike/navigation',()=>({notifyRunUpdated:vi.fn(),runCharacters:(run:RoguelikeRun)=>run.characters??[run.character]}));
vi.mock('../settings',()=>({useSiteSettings:()=>({entityDisplay:{items:'row'},itemPreview:'interface'})}));
vi.mock('./SheetActionLine',()=>({default:({name,detail,disabled,onActivate}:{name:string;detail:string;disabled:boolean;onActivate:()=>void})=><button disabled={disabled} onClick={onActivate}>{name} {detail}</button>}));
vi.mock('./ItemPreview',()=>({default:()=> <div>Canonical item preview</div>}));
vi.mock('./CardPreview',()=>({default:()=> <div>Canonical card preview</div>}));
vi.mock('./EntityDetailShell',()=>({EntityDetailShell:({children,preview,onClose}:{children:ReactNode;preview:ReactNode;onClose:()=>void})=><div role="dialog"><button onClick={onClose}>Закрыть</button>{preview}{children}</div>}));

const hero={id:'hero',name:'Hero',runtime_revision:7,inventory_items:[{card_id:'item',qty:2}],equipment:{},turn_state:{}} as unknown as ForgeCharacter;
const run={id:'run',character_id:hero.id,character:hero,characters:[hero],revision:4,status:'active',phase:'camp'} as RoguelikeRun;
let root:Root,host:HTMLDivElement;
async function render(regular=false){await act(async()=>root.render(regular?<RunShopInventory character={hero} onCharacterUpdated={mocks.updated}/>:<RunShopInventory run={run} onUpdated={mocks.updated}/>));}
async function click(text:string){const button=[...host.querySelectorAll('button')].find(button=>button.textContent===text||button.textContent?.startsWith(text));if(!button)throw Error(`Missing ${text}`);await act(async()=>button.click());}
beforeEach(()=>{
 (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
 vi.resetAllMocks();localStorage.clear();mocks.getCard.mockResolvedValue({id:'item',name:'Fractional item',price:2.5,price_currency:'silver'});mocks.getRun.mockResolvedValue(run);mocks.getCharacter.mockResolvedValue(hero);mocks.command.mockResolvedValue({...run,revision:5});mocks.sell.mockResolvedValue({...hero,runtime_revision:8});
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();});
describe('shared owned merchant inventory',()=>{
 it('uses canonical item display and cancel does not create a sale',async()=>{await render();await click('Fractional item');expect(host.textContent).toContain('Canonical item preview');expect(host.textContent).toContain('Получите:');await click('Закрыть');expect(mocks.command).not.toHaveBeenCalled();expect(mocks.sell).not.toHaveBeenCalled();});
 it('preserves the same sale request after an unknown response and reload',async()=>{
  mocks.command.mockRejectedValueOnce(Error('Connection interrupted'));
  await render();await click('Fractional item');const quantity=host.querySelector('input')!;await act(async()=>{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;setter.call(quantity,'2');quantity.dispatchEvent(new Event('input',{bubbles:true}));});await click('Продать');
  const first=mocks.command.mock.calls[0];expect(first[3]).toEqual({actor_id:'hero',card_id:'item',quantity:2});expect(mocks.updated).not.toHaveBeenCalled();expect(localStorage.getItem('boh:shop-sale:run')).toContain(first[4]);
  await act(async()=>root.unmount());root=createRoot(host);await render();mocks.getRun.mockResolvedValue({...run,revision:9,character:{...hero,current_hp:3}});await click('Повторить продажу');expect(mocks.command.mock.calls[1]).toEqual(first);expect(mocks.getRun).toHaveBeenCalledTimes(2);expect(mocks.updated).toHaveBeenCalledWith(expect.objectContaining({revision:9,character:expect.objectContaining({current_hp:3})}));expect(localStorage.getItem('boh:shop-sale:run')).toBeNull();
 });
 it('updates ordinary inventory even when browser storage is unavailable',async()=>{
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('Storage blocked')});vi.spyOn(Storage.prototype,'removeItem').mockImplementation(()=>{throw Error('Storage blocked')});await render(true);await click('Fractional item');await click('Продать');
  expect(mocks.sell).toHaveBeenCalledWith('hero',expect.objectContaining({expected_runtime_revision:7,card_id:'item',quantity:1}));expect(mocks.updated).toHaveBeenCalledTimes(1);expect(host.textContent).toContain('Монеты добавлены в кошелёк');expect(mocks.command).not.toHaveBeenCalled();
 });
 it('clears a definitively rejected command so another selection remains available',async()=>{
  mocks.command.mockRejectedValueOnce(Object.assign(Error('State changed'),{status:409}));await render();await click('Fractional item');await click('Продать');expect(localStorage.getItem('boh:shop-sale:run')).toBeNull();expect(host.textContent).not.toContain('ожидает подтверждения');
  await click('Закрыть');await click('Fractional item');await click('Продать');expect(mocks.command.mock.calls[1][4]).not.toBe(mocks.command.mock.calls[0][4]);expect(mocks.updated).toHaveBeenCalledTimes(1);
 });
});
