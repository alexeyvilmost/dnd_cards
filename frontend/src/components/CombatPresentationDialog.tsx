import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Shield, Swords } from 'lucide-react';
import type { SoloCombatState } from '../solo-combat/types';
import type { CombatBeat } from '../solo-combat/presentation';
import { combatActorDisplayName } from '../character/familiarLabels';
import CommittedD20, {CommittedDie, D20_ROLL_DURATION_MS} from '../dice/CommittedD20';
import SheetSettingsDialog from './SheetSettingsDialog';
import { combatRollModeFor, useSiteSettings, type CombatRollMode } from '../settings';
import { useCombatDialogFocus } from './useCombatDialogFocus';
import { getDamageLabel } from '../utils/damageTypes';
import '../dice/CombatPresentation.css';
import './CombatRollLayout.css';

export default function CombatPresentationDialog({initiative, beat, onClose, modeOverride}: {
  initiative?: SoloCombatState | null;
  beat?: CombatBeat;
  onClose: () => void;
  modeOverride?: CombatRollMode;
}) {
  const settings = useSiteSettings();
  const combatRollMode = modeOverride ?? combatRollModeFor(settings, beat?.audience);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const dialogRef = useCombatDialogFocus(!settingsOpen);
  const [rolled,setRolled]=useState(false);
  const [damageRolled,setDamageRolled]=useState(false);
  const buttonRef=useRef<HTMLButtonElement>(null);
  const reducedMotion=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const animate=!reducedMotion && (Boolean(initiative) || (combatRollMode==='standard' && beat?.rollPhase !== 'after-reaction'));
  const roll=beat?.roll;
  const isSave=beat?.rollKind==='save';
  const isCheck=beat?.rollKind==='check';
  const isUntargeted=(isSave || isCheck) && !roll?.target;
  const saveRows=beat?.saveRows;
  const success=isSave?roll?.outcome==='success':roll?.outcome==='hit'||roll?.outcome==='crit';
  const hasDamage=(isSave || success) && Boolean(saveRows?.some(row=>row.damage?.length) || beat?.damage?.length);
  const animateDamage=!initiative && !reducedMotion && combatRollMode==='standard' && hasDamage
    && beat?.rollPhase!=='before-reaction' && Boolean((saveRows ?? (beat ? [beat] : [])).some(row=>row.damage?.some(packet=>packet.roll?.dice.length)));
  const attackReady = !animate || rolled;
  const ready = attackReady && (!animateDamage || damageRolled);
  useEffect(()=>{
    setRolled(false);
    setDamageRolled(false);
    const attackDuration=animate?D20_ROLL_DURATION_MS:0;
    const timer=window.setTimeout(()=>setRolled(true),attackDuration);
    const damageTimer=window.setTimeout(()=>setDamageRolled(true),attackDuration+(animateDamage?D20_ROLL_DURATION_MS:0));
    return ()=>{window.clearTimeout(timer);window.clearTimeout(damageTimer);};
  },[initiative,beat?.id,animate,animateDamage]);
  useEffect(()=>{if (ready && !settingsOpen) buttonRef.current?.focus({preventScroll:true});},[ready,settingsOpen]);
  useEffect(()=>{
    if(!initiative && combatRollMode==='skip') onClose();
  },[initiative,combatRollMode,onClose]);
  const natural=roll?.dice.find(die=>die.sides===20&&!die.discarded)?.result;
  // Natural 1/20 do not automatically fail/succeed on ordinary saving throws.
  const critical=isSave||isCheck?undefined:natural===20?'success':natural===1?'failure':undefined;
  if (!initiative && combatRollMode==='skip') return null;
  return createPortal(<div className="combat-presentation-backdrop">
    <section ref={dialogRef} tabIndex={-1} className={`combat-presentation-dialog${saveRows ? ' is-mass-effect' : ''}`} role="dialog" aria-modal="true" aria-label={initiative?'Инициатива':isSave?'Спасбросок':isCheck?'Проверка':'Бросок атаки'}>
      <p className="combat-presentation-kicker">{initiative?'НАЧАЛО СРАЖЕНИЯ':isSave?'СПАСБРОСОК':isCheck?'ПРОВЕРКА':'БРОСОК АТАКИ'}</p>
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
      </> : saveRows ? <>
        <p className="combat-presentation-muted">{beat?.sourceName} · Целей: {saveRows.length}</p>
        <div className="combat-save-rows">{saveRows.map(row => <div className="combat-save-row" key={row.id}>
          <div className="combat-save-name"><b>{row.rollerName ?? row.targetName}</b><small>{row.rollLabel}</small></div>
          <div className="combat-save-dice">{row.roll?.dice.map((die,i)=><CommittedDie key={i} sides={die.sides} value={die.result} discarded={die.discarded} rolling={!attackReady}/>)}</div>
          <div className="combat-save-outcome">{attackReady ? <><strong>{row.roll?.total} / СЛ {row.roll?.target?.value}</strong><span>{row.roll?.outcome==='success'?'Успех':'Провал'}</span><small>{row.roll?.text}</small></> : 'Спасбросок…'}</div>
          <div className="combat-save-damage" aria-label={`Урон: ${row.targetName}`}>{attackReady ? row.damage?.length ? row.damage.map((packet,i)=><div key={i}>
            <div className="combat-save-dice">{packet.roll?.dice.map((die,j)=><CommittedDie key={j} sides={die.sides} value={die.result} discarded={die.discarded} rolling={animateDamage&&!damageRolled}/>)}</div>
            {ready ? <><strong>{packet.amount} · {getDamageLabel(packet.damageType)}</strong><small>{packet.roll?.text ?? `Фиксированный урон: ${packet.amount}`}</small>{packet.beforeResistance!==undefined&&packet.beforeResistance!==packet.amount&&<small>{packet.beforeResistance} → {packet.amount} после {packet.adjustment==='immunity'?'иммунитета':packet.adjustment==='vulnerability'?'уязвимости':'сопротивления'}</small>}</> : <small>Бросок урона…</small>}
          </div>) : <small>Без урона</small> : <small>Урон после спасброска</small>}</div>
        </div>)}</div>
      </> : <>
        {beat?.sourceName&&<p className="combat-attack-versus"><b>{beat.sourceName}</b>{beat.targetName&&<><Swords size={18}/><b>{beat.targetName}</b></>}</p>}
        {isSave&&beat?.rollerName&&<p className="combat-presentation-muted">Бросает: {beat.rollerName} · {beat.rollLabel}</p>}
        {roll&&<div className="combat-attack-dice">{roll.dice.map((die,i)=><CommittedDie key={`${beat?.id}:${i}`} sides={die.sides} value={die.result} discarded={die.discarded} rolling={!attackReady} critical={die.sides===20?critical:undefined} animateEffects={animate}/>)}</div>}
        {attackReady&&critical&&<p role="status" className={`combat-critical-banner is-${critical}${animate?' is-animated':''}`}>{critical==='success'?'НАТУРАЛЬНАЯ 20 · КРИТИЧЕСКИЙ УСПЕХ':'НАТУРАЛЬНАЯ 1 · КРИТИЧЕСКИЙ ПРОВАЛ'}</p>}
        {attackReady&&roll?<div className={`combat-roll-result ${success?'is-hit':'is-miss'}`}>
          <div className="combat-roll-equation"><strong>{roll.total}</strong>{!isUntargeted&&<span>{roll.total >= (roll.target?.value ?? 0)?'≥':'<'} <Shield size={18}/> {isSave||isCheck?'СЛ':'КД'} {roll.target?.value}</span>}</div>
          <h3>{isUntargeted?(isSave?'Результат спасброска':'Результат проверки'):isSave?(success?'Спасбросок успешен':'Спасбросок провален'):roll.outcome==='crit'?'Критическое попадание!':success?'Попадание':'Промах'}</h3>
          {!isSave && !isCheck && roll.dice.some(die=>die.sides===20 && !die.discarded && die.result===1) && <p>Натуральная 1 — автоматический промах, даже если сумма достигает КД.</p>}
          {beat?.rollPhase==='before-reaction'&&<p>Цель может применить защитную реакцию до получения урона.</p>}
          {beat?.rollPhase==='after-reaction'&&<p>Итог после защитной реакции. Сохранён исходный бросок.</p>}
          <p>{roll.text}</p>
          <ul className="combat-roll-modifiers">{roll.modifiers.map((modifier,i)=><li key={i}><span>{modifier.source}</span><b>{modifier.value>=0?'+':''}{modifier.value}</b></li>)}</ul>
          {roll.advantage!=='none'&&<small>{roll.advantage==='advantage'?'Преимущество — выбрана большая кость':'Помеха — выбрана меньшая кость'}</small>}
          {hasDamage && beat?.damage?.length ? <div className="combat-damage-breakdown" aria-label="Расчёт урона">
            <h4>Бросок урона</h4>
            {beat.damage.map((packet, packetIndex) => <div className="combat-damage-packet" key={`${packet.damageType}:${packetIndex}`}>
              {packet.roll?.dice.length ? <div className="combat-damage-rolls">{packet.roll.dice.map((die, dieIndex) => <div className="combat-damage-die" key={dieIndex}><CommittedDie sides={die.sides} value={die.result} discarded={die.discarded} rolling={animateDamage&&!damageRolled}/><small>к{die.sides}</small></div>)}</div> : null}
              {ready ? <><p>{packet.roll?.text ?? `Фиксированный урон: ${packet.amount}`}</p>
                <strong>{packet.amount} · {getDamageLabel(packet.damageType).toLocaleLowerCase('ru-RU')}</strong>
                {packet.beforeResistance !== undefined && packet.beforeResistance !== packet.amount && <small>{packet.beforeResistance} до {packet.adjustment === 'immunity' ? 'иммунитета' : packet.adjustment === 'vulnerability' ? 'уязвимости' : 'сопротивления'} → {packet.amount}</small>}</>
                : <p role="status">Бросок урона…</p>}
            </div>)}
          </div> : null}
        </div>:<p className="combat-rolling-label">Кубик летит…</p>}
      </>}
      {!ready && <button type="button" className="combat-reveal-result" onClick={()=>{setRolled(true);setDamageRolled(true);}}>Показать результат</button>}
      <div className="combat-presentation-actions"><button ref={buttonRef} type="button" className="combat-presentation-continue" disabled={!ready} onClick={onClose}>{initiative?'Начать сражение':'Продолжить'}</button><button type="button" className="combat-presentation-settings" onClick={()=>setSettingsOpen(true)}>Настройки</button></div>
      {settingsOpen&&<SheetSettingsDialog initialPage="combat-rolls" allowDiceTest={false} onClose={()=>setSettingsOpen(false)}/>}
    </section>
  </div>,document.body);
}
