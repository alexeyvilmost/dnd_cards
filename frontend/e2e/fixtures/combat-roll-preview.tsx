// Dev-only visual acceptance fixture; not an application route or build entry.
import React from 'react';
import {createRoot} from 'react-dom/client';
import CombatPresentationDialog from '../../src/components/CombatPresentationDialog';
import {CommittedDie} from '../../src/dice/CommittedD20';
import {supportedDieSides} from '../../src/dice/polyhedralGeometry';
import type {CombatBeat} from '../../src/solo-combat/presentation';
import SheetCheckRollDialog from '../../src/components/SheetCheckRollDialog';

const params=new URLSearchParams(location.search);
const value=Number(params.get('value')??20);
const gallery=params.has('gallery'), large=params.has('large');
const weaponDice=Array.from({length:large?24:2},(_,i)=>({sides:8,result:i%2?5:8}));
const weaponTotal=weaponDice.reduce((sum,die)=>sum+die.result,3);
localStorage.setItem('site-settings',JSON.stringify({combatRollMode:params.get('mode')??'standard',enemyCombatRollMode:'skip'}));
const beat:CombatBeat={id:'visual',sourceId:'hero',targetId:'enemy',sourceName:'Грэз',targetName:'Стражник · 2',actionName:'Длинный меч',audience:params.has('enemy')?'enemy':'own',cues:[],
  roll:{kind:'d20',dice:[{sides:20,result:value}],modifiers:[{source:'Сила и владение',value:5}],advantage:'none',total:value+5,target:{type:'ac',value:16},outcome:value===20?'crit':value===1?'miss':'hit',text:`к20: ${value} + 5 = ${value+5}`},
  damage:value===1?[]:[{amount:weaponTotal,damageType:'slashing',roll:{kind:'damage',dice:weaponDice,modifiers:[{source:'Сила',value:3}],advantage:'none',total:weaponTotal,text:large?`24к8 + 3 = ${weaponTotal}`:'2к8: 8 + 5 + 3 [Сила] = 16'}},
    {amount:4,damageType:'fire',roll:{kind:'damage',dice:[{sides:4,result:1},{sides:6,result:3}],modifiers:[],advantage:'none',total:4,text:'к4: 1 + к6: 3 = 4'}}]};
if(params.has('save')) {
 beat.rollKind='save';beat.actionName='Дыхание дракона';beat.rollerName=beat.targetName;beat.rollLabel='Спасбросок Ловкости';
 beat.roll={...beat.roll!,kind:'save',outcome:'success',target:{type:'dc',value:15}};
 beat.damage=[{amount:5,damageType:'fire',roll:{kind:'damage',dice:[{sides:6,result:4},{sides:6,result:6}],total:10,modifiers:[],advantage:'none',text:'2к6: 4 + 6 = 10; половина при спасброске: 5'}}];
}
if(params.has('mass')) {
 beat.rollKind='save';beat.actionName='Дыхание дракона';
 beat.saveRows=[1,2,3].map((n)=>({...beat,id:`save-${n}`,targetId:`enemy-${n}`,targetName:`Скелет · ${n}`,rollerName:`Скелет · ${n}`,rollLabel:'Спасбросок Ловкости',
 roll:{...beat.roll!,kind:'save',dice:[{sides:20,result:n===1?17:4+n}],total:n===1?19:6+n,target:{type:'dc',value:12},outcome:n===1?'success':'fail',text:`к20: ${n===1?17:4+n} + 2 = ${n===1?19:6+n}`},
 damage:[{amount:n===1?4:9,damageType:'fire',roll:{kind:'damage',dice:[{sides:10,result:9}],total:9,modifiers:[],advantage:'none',text:n===1?'к10: 9; половина при спасброске: 4':'к10: 9'}}]}));
}

createRoot(document.getElementById('root')!).render(params.has('check')?<SheetCheckRollDialog title="Акробатика" request={{kind:'check',roll:()=>({kind:'check',dice:[{sides:20,result:15}],modifiers:[{source:'Ловкость',value:3},{source:'Владение',value:2}],advantage:'none',total:20,text:'к20: 15 + 3 [Ловкость] + 2 [Владение] = 20'})}} onCancel={()=>document.body.dataset.closed='true'} onComplete={()=>document.body.dataset.closed='true'}/>:gallery?<div style={{display:'flex',flexWrap:'wrap',padding:40,gap:24,color:'#e8d4aa'}}>{supportedDieSides.map(sides=><div key={sides} style={{textAlign:'center'}}><CommittedDie sides={sides} value={sides} rolling={false}/><p>к{sides}</p></div>)}</div>:<CombatPresentationDialog beat={beat} onClose={()=>document.body.dataset.closed='true'}/>);
