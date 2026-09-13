import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Shield, Swords } from 'lucide-react';
import type { SoloCombatState } from '../solo-combat/types';
import type { CombatBeat } from '../solo-combat/presentation';
import { combatActorDisplayName } from '../character/familiarLabels';
import CommittedD20 from '../dice/CommittedD20';
import CombatRollModeSelect from './CombatRollModeSelect';
import { useSiteSettings } from '../settings';
import { useCombatDialogFocus } from './useCombatDialogFocus';
import '../dice/CombatPresentation.css';

export default function CombatPresentationDialog({initiative, beat, onClose}: {
  initiative?: SoloCombatState | null;
  beat?: CombatBeat;
  onClose: () => void;
}) {
  const {combatRollMode} = useSiteSettings();
  const dialogRef = useCombatDialogFocus();
  const [rolled,setRolled]=useState(false);
  const buttonRef=useRef<HTMLButtonElement>(null);
  const animate=Boolean(initiative) || (combatRollMode==='standard' && beat?.rollPhase !== 'after-reaction');
  const ready = !animate || rolled;
  useEffect(()=>{
    setRolled(false);
    const timer=window.setTimeout(()=>{setRolled(true);buttonRef.current?.focus();},animate?1450:0);
    return ()=>window.clearTimeout(timer);
  },[initiative,beat?.id,animate]);
  useEffect(()=>{
    if(!initiative && combatRollMode==='skip') onClose();
  },[initiative,combatRollMode,onClose]);
  const roll=beat?.roll;
  const success=roll?.outcome==='hit'||roll?.outcome==='crit';
  return createPortal(<div className="combat-presentation-backdrop">
    <section ref={dialogRef} tabIndex={-1} className="combat-presentation-dialog" role="dialog" aria-modal="true" aria-label={initiative?'Инициатива':'Бросок атаки'}>
      <p className="combat-presentation-kicker">{initiative?'НАЧАЛО СРАЖЕНИЯ':'БРОСОК АТАКИ'}</p>
      <h2>{initiative?'Инициатива':beat?.actionName}</h2>
      {initiative ? <>
        <p className="combat-presentation-muted">Участники бросают к20. Сражение начнётся в порядке инициативы.</p>
        <div className="combat-initiative-list">{initiative.initiative.map(entry=>{
          const actor=initiative.world.actors[entry.actorId];
          const dice=entry.roll?.dice.filter(die=>die.sides===20)??[{sides:20,result:entry.die}];
          return <div className="combat-initiative-row" key={entry.actorId}>
            <span className="combat-participant-portrait">{initiative.tokens[entry.actorId]?.tokenUrl?<img src={initiative.tokens[entry.actorId].tokenUrl} alt=""/>:<Swords/>}</span>
            <span className="combat-initiative-name"><b>{combatActorDisplayName(actor)}</b><small>{rolled?(entry.roll?.text??`${entry.die} ${entry.bonus>=0?'+':''}${entry.bonus} = ${entry.total}`):'Бросок инициативы…'}</small></span>
            <div className="combat-initiative-dice">{dice.map((die,i)=><CommittedD20 key={i} value={die.result} discarded={die.discarded} rolling={!rolled}/>)}</div>
            <strong className="combat-initiative-total">{rolled?entry.total:'…'}</strong>
          </div>;
        })}</div>
      </> : <>
        <p className="combat-attack-versus"><b>{beat?.sourceName}</b><Swords size={18}/><b>{beat?.targetName}</b></p>
        {animate&&<div className="combat-attack-dice">{roll?.dice.filter(die=>die.sides===20).map((die,i)=><CommittedD20 key={i} value={die.result} discarded={die.discarded} rolling={!rolled}/>)}</div>}
        {ready&&roll?<div className={`combat-roll-result ${success?'is-hit':'is-miss'}`}>
          <div className="combat-roll-equation"><strong>{roll.total}</strong><span>{roll.total >= (roll.target?.value ?? 0)?'≥':'<'} <Shield size={18}/> КД {roll.target?.value}</span></div>
          <h3>{roll.outcome==='crit'?'Критическое попадание!':success?'Попадание':'Промах'}</h3>
          {beat?.rollPhase==='before-reaction'&&<p>Цель может применить защитную реакцию до получения урона.</p>}
          {beat?.rollPhase==='after-reaction'&&<p>Итог после защитной реакции. Сохранён исходный бросок.</p>}
          <p>{roll.text}</p>
          <ul className="combat-roll-modifiers">{roll.modifiers.map((modifier,i)=><li key={i}><span>{modifier.source}</span><b>{modifier.value>=0?'+':''}{modifier.value}</b></li>)}</ul>
          {roll.advantage!=='none'&&<small>{roll.advantage==='advantage'?'Преимущество — выбрана большая кость':'Помеха — выбрана меньшая кость'}</small>}
        </div>:<p className="combat-rolling-label">Кубик летит…</p>}
        <CombatRollModeSelect/>
      </>}
      <button ref={buttonRef} type="button" className="combat-presentation-continue" disabled={!ready} onClick={onClose}>{initiative?'Начать сражение':'Продолжить'}</button>
    </section>
  </div>,document.body);
}
