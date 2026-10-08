// @vitest-environment jsdom
import {act,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it} from 'vitest';
import {AbilityAssigner} from './components';
import {emptyBonuses,type AbilityBonuses,type AbilityKey} from './types';
import {pointsRemaining} from './pointBuy';
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
it('shows marginal costs, keeps background bonuses outside the budget and prevents overspending',async()=>{
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 let snapshot:{abilities:Partial<Record<AbilityKey,number>>;bonuses:AbilityBonuses};
 function Controlled(){const [abilities,setAbilities]=useState<Partial<Record<AbilityKey,number>>>({str:13});const [bonuses,setBonuses]=useState(emptyBonuses());snapshot={abilities,bonuses};
 return <AbilityAssigner abilities={abilities} method="point_buy" bonuses={bonuses} recommended={{str:15,dex:15,con:15,int:8,wis:8,cha:8}} backgroundAbilities={['str','dex','con']}
 onSet={()=>{}} onSetAll={setAbilities} onBonusesChange={setBonuses} onMethodChange={()=>{}}/>;}
 await act(async()=>root.render(<Controlled/>));
 expect(pointsRemaining(snapshot!.abilities,snapshot!.bonuses)).toBe(22);
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Увеличить: Сила"]')!.click());
 expect(snapshot!.abilities.str).toBe(14);expect(pointsRemaining(snapshot!.abilities,snapshot!.bonuses)).toBe(20);expect(Object.keys(snapshot!.abilities)).toHaveLength(6);
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Бонус +2: Сила"]')!.click());
 expect(snapshot!.abilities.str).toBe(16);expect(pointsRemaining(snapshot!.abilities,snapshot!.bonuses)).toBe(20);
 expect(host.querySelector<HTMLInputElement>('[aria-label="База: Сила"]')!.value).toBe('14');
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='Рекомендация класса')!.click());
 expect(pointsRemaining(snapshot!.abilities,snapshot!.bonuses)).toBe(0);
 expect(host.querySelector<HTMLButtonElement>('[aria-label="Увеличить: Интеллект"]')!.disabled).toBe(true);
 expect(host.querySelector<HTMLButtonElement>('[aria-label="Уменьшить: Сила"]')!.disabled).toBe(false);
 await act(async()=>root.unmount());host.remove();
});

it('offers valid bonus patterns in the table and preserves purchased bases when switching them',async()=>{
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 let snapshot:{abilities:Partial<Record<AbilityKey,number>>;bonuses:AbilityBonuses};
 function Controlled(){const[abilities,setAbilities]=useState<Partial<Record<AbilityKey,number>>>({str:10,dex:10,con:10,int:10,wis:10,cha:10});const[bonuses,setBonuses]=useState(emptyBonuses());snapshot={abilities,bonuses};
 return <AbilityAssigner abilities={abilities} method="point_buy" bonuses={bonuses} recommended={{}} backgroundAbilities={['dex','int','wis']}
 onSet={()=>{}} onSetAll={setAbilities} onBonusesChange={setBonuses} onMethodChange={()=>{}}/>;}
 await act(async()=>root.render(<Controlled/>));
 const button=(value:number,name:string)=>host.querySelector<HTMLButtonElement>(`[aria-label="Бонус +${value}: ${name}"]`)!;
 expect(button(1,'Сила').disabled).toBe(true);expect(button(2,'Интеллект').disabled).toBe(false);
 expect(host.querySelector('.forge-ability-heading')!.textContent).not.toContain('Цена');
 expect(host.querySelector('.forge-background-bonuses')).toBeNull();
 await act(async()=>button(2,'Интеллект').click());
 expect(button(2,'Мудрость').disabled).toBe(true);expect(button(1,'Мудрость').disabled).toBe(false);
 await act(async()=>button(1,'Мудрость').click());
 expect(button(1,'Ловкость').disabled).toBe(true);expect(snapshot!.abilities.int).toBe(12);expect(snapshot!.abilities.wis).toBe(11);
 await act(async()=>button(2,'Интеллект').click());
 await act(async()=>button(1,'Интеллект').click());
 await act(async()=>button(1,'Ловкость').click());
 expect(snapshot!.bonuses.mode).toBe('one_one_one');expect(Object.values(snapshot!.bonuses.assignments)).toEqual([1,1,1]);
 expect(button(2,'Интеллект').disabled).toBe(true);expect(pointsRemaining(snapshot!.abilities,snapshot!.bonuses)).toBe(15);
 const checkbox=host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
 await act(async()=>checkbox.click());
 expect(button(2,'Сила').disabled).toBe(false);
 await act(async()=>button(2,'Сила').click());
 expect(snapshot!.abilities.str).toBe(12);
 await act(async()=>checkbox.click());
 expect(button(2,'Сила').disabled).toBe(true);expect(snapshot!.abilities.str).toBe(10);
 await act(async()=>root.unmount());host.remove();
});

it('commits direct text input on blur and rejects out-of-range and unaffordable values',async()=>{
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 let abilities:Partial<Record<AbilityKey,number>>={};
 function Controlled(){const[value,setValue]=useState<Partial<Record<AbilityKey,number>>>({str:15,dex:15,con:15,int:8,wis:8,cha:8});abilities=value;
 return <AbilityAssigner abilities={value} method="point_buy" bonuses={emptyBonuses()} recommended={{}} backgroundAbilities={[]}
 onSet={()=>{}} onSetAll={setValue} onBonusesChange={()=>{}} onMethodChange={()=>{}}/>;}
 await act(async()=>root.render(<Controlled/>));
 const input=host.querySelector<HTMLInputElement>('[aria-label="База: Интеллект"]')!;
 const edit=async(value:string)=>{await act(async()=>{input.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});await act(async()=>input.blur());};
 expect(input.type).toBe('text');expect(input.inputMode).toBe('numeric');
 await edit('15');expect(abilities.int).toBe(8);expect(input.value).toBe('8');expect(host.textContent).toContain('Не хватает очков.');
 await edit('16');expect(abilities.int).toBe(8);expect(host.textContent).toContain('Введите число от 8 до 15.');
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Уменьшить: Сила"]')!.click());
 await edit('10');expect(abilities.int).toBe(10);expect(input.value).toBe('10');
 await act(async()=>root.unmount());host.remove();
});
