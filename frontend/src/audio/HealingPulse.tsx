import {useEffect,useRef,useState} from 'react';
import './healing.css';
/** The first loaded HP is not an event. Only accepted subsequent gains animate. */
export default function HealingPulse({id,hp}:{id:string;hp:number}){
 const previous=useRef({id,hp}),[amount,setAmount]=useState(0);
 useEffect(()=>{const old=previous.current;previous.current={id,hp};if(old.id!==id||hp<=old.hp){setAmount(0);return;}setAmount(hp-old.hp);const timer=setTimeout(()=>setAmount(0),1600);return()=>clearTimeout(timer);},[id,hp]);
 return amount>0?<span key={`${id}:${hp}`} className="healing-pulse" role="status" aria-label={`Восстановлено ${amount} хитов`}><i/><b>+{amount}</b><i/><i/></span>:null;
}
