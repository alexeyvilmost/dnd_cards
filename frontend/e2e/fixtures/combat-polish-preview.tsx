import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ChoiceResolver} from '../../src/character/components';
import SheetActionLine from '../../src/components/SheetActionLine';
import type {Action,Card} from '../../src/types';
import '../../src/pages/CharacterForge.css';
import '../../src/pages/CharacterSheetV2.css';
const potion={id:'potion',name:'Зелье лечения',type:'potion',description:'Восстанавливает здоровье.',rarity:'common'} as Card;
const breath={id:'breath',card_number:'ACT-breath',name:'Дыхание дракона',description:'Выдохните огонь конусом. Цели совершают спасбросок Ловкости.',mechanics:{activation:{cost:[{resource:'action'},{resource:'self_uses'}]},effects:[{resolution:'save',ability:'dex',dc:13,on_fail:[{kind:'damage',dice:'2d6',type:'fire'}]}]}} as Action;
function Preview(){
 const [chosen,setChosen]=useState<string[]>([]),[remaining,setRemaining]=useState(1);
 return <main className="forge" style={{minHeight:'100vh',padding:32}}><h1>Локальная проверка интерфейса</h1>
  <ChoiceResolver choice={{id:'mastery',prompt:'Искусность: выберите 3 вида оружия',source:'weapon',count:3,grantKind:'weapon_mastery',origin:{kind:'class',id:'fighter',name:'Воин'}}} value={chosen} onChange={setChosen}/>
  <div style={{display:'flex',gap:24,marginTop:50}}>
   <SheetActionLine name={potion.name} itemRef={potion} imageUrl={potion.image_url} variant="icon" onActivate={()=>{}}/>
   <SheetActionLine name={breath.name} actionRef={breath} runtime={{resources:{'uses_ACT-breath':remaining},maxResources:{'uses_ACT-breath':2}}} variant="icon" disabled={remaining===0} disabledTitle="Нет использований" onActivate={()=>setRemaining(Math.max(0,remaining-1))}/>
  </div>
 </main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
