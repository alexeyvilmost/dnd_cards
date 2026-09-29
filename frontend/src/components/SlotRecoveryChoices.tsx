import {useState} from 'react';
import type {SlotRecoveryDecisionRequest} from '../rules-core/domain';

/** Uses the same slot counts and budget interpretation as the rest picker. */
export default function SlotRecoveryChoices({request,disabled=false,onChoose}:{request:SlotRecoveryDecisionRequest;disabled?:boolean;onChoose:(levels:number[]|null)=>void}){
  const [selected,setSelected]=useState<number[]>([]);
  const total=selected.reduce((sum,level)=>sum+level,0);
  return <section className="sheet-group" aria-label="Восстановление ячеек">
    <h3 className="sheet-h3">Восстановление ячеек</h3>
    <p>Бюджет уровней: {total} из {request.budget}. Ресурсы расходуются после подтверждения.</p>
    <div className="chips">{Object.entries(request.recoverableByLevel).map(([rawLevel,count])=>{
      const level=Number(rawLevel),used=selected.filter(value=>value===level).length;
      return <button className="chip" type="button" key={level} disabled={disabled||used>=count||total+level>request.budget}
        onClick={()=>setSelected([...selected,level])}>Ячейка {level} ур. · доступно {count-used}</button>;
    })}</div>
    <div className="chips">{selected.map((level,index)=><button className="chip on" type="button" key={`${level}:${index}`} disabled={disabled}
      onClick={()=>setSelected(selected.filter((_,i)=>i!==index))}>Восстановить {level} ур. ×</button>)}</div>
    <button className="forge-btn" type="button" disabled={disabled||selected.length===0} onClick={()=>onChoose(selected)}>Подтвердить</button>
    <button className="forge-btn ghost" type="button" disabled={disabled} onClick={()=>onChoose(null)}>Отмена</button>
  </section>;
}
