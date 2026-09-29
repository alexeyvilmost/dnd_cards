import {useEffect,useState} from 'react';
import type {CombatBeat} from '../solo-combat/presentation';
import {CommittedDie} from '../dice/CommittedD20';
import D20RollTray from '../dice/D20RollTray';
import DiceStage from '../dice/DiceStage';

/** Plays saved combat dice over the map; this component never determines a result. */
export default function FieldDice({beat}:{beat:CombatBeat}) {
  const attack=beat.roll?.target?.type==='ac' ? beat.roll : null;
  const packets=beat.saveRows?.flatMap(row=>row.damage??[])??beat.damage??[];
  const damage=packets.flatMap(packet=>packet.roll?.dice??[]);
  // A confirmed result after an influence window is the same d20. Show it
  // settled; only newly committed damage dice may tumble.
  const offset=beat.rollPhase==='after-reaction'?1850:0;
  const [elapsed,setElapsed]=useState(offset);
  useEffect(()=>{
    setElapsed(offset);
    const started=performance.now();
    const timer=window.setInterval(()=>setElapsed(offset+performance.now()-started),80);
    return ()=>window.clearInterval(timer);
  },[beat.id,offset]);
  if(!attack&&!damage.length)return null;
  const showDamage=damage.length>0&&(!attack||elapsed>=1650);
  return <div className="battle-scene-3d__field-dice" role="status" aria-label={`Бросок: ${beat.actionName}`}>
    {attack&&!showDamage&&<div className="battle-scene-3d__field-dice-row">
      <strong>Атака · {beat.actionName}</strong>
      <D20RollTray roll={attack} rolling={elapsed<1450} selecting={elapsed<1850} animate={true}/>
      {elapsed>=1850&&<span>{attack.total} против КД</span>}
    </div>}
    {showDamage&&<div className="battle-scene-3d__field-dice-row">
      <strong>Урон · {beat.actionName}</strong>
      <DiceStage rollKey={JSON.stringify(damage)} diceCount={damage.length}><div className="battle-scene-3d__field-damage">{damage.map((die,index)=><CommittedDie
        key={`${beat.id}:${index}`} sides={die.sides} value={die.result} discarded={die.discarded}
        rolling={elapsed<(attack?3100:1450)}/>)}</div></DiceStage>
      {elapsed>=(attack?3100:1450)&&<span>{packets.reduce((sum,packet)=>sum+packet.amount,0)} урона</span>}
    </div>}
  </div>;
}
