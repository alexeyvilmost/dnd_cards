import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Shield, Swords } from 'lucide-react';
import type { SoloCombatState } from '../solo-combat/types';
import type { CombatBeat } from '../solo-combat/presentation';
import { combatActorDisplayName } from '../character/familiarLabels';
import {CommittedDie, D20_ROLL_DURATION_MS, D20_SELECTION_DURATION_MS} from '../dice/CommittedD20';
import D20RollTray from '../dice/D20RollTray';
import SheetSettingsDialog from './SheetSettingsDialog';
import { combatRollModeFor, useSiteSettings, type CombatRollMode } from '../settings';
import { useCombatDialogFocus } from './useCombatDialogFocus';
import { getDamageLabel } from '../utils/damageTypes';
import RollCalculationDetails from './RollCalculationDetails';
import RollInfluenceActions from './RollInfluenceActions';
import AttackRollEquation from './AttackRollEquation';
import type {RollInfluence} from '../engine/rollInfluence';
import '../dice/CombatPresentation.css';
import './CombatRollLayout.css';

export default function CombatPresentationDialog({initiative, beat, onClose, modeOverride, influences = [], onInfluence, busy, provisional = false}: {
  initiative?: SoloCombatState | null;
  beat?: CombatBeat;
  onClose: () => void;
  modeOverride?: CombatRollMode;
  influences?: RollInfluence[];
  onInfluence?: (id: string) => void;
  busy?: boolean;
  provisional?: boolean;
}) {
  const settings = useSiteSettings();
  const combatRollMode = modeOverride ?? combatRollModeFor(settings, beat?.audience);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const dialogRef = useCombatDialogFocus(!settingsOpen);
  const [rolled,setRolled]=useState(false);
  const [landed,setLanded]=useState(false);
  const [damageRolled,setDamageRolled]=useState(false);
  const revealKey=useRef<string | null>(null);
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
  // Held -> committed is the same throw. A replacement changes its provenance
  // or dice; adding damage must not remount or spin the attack die again.
  const rollKey = JSON.stringify(saveRows ? saveRows.map(row => [row.roll?.dice,row.roll?.total,row.roll?.modifiers]) : [roll?.dice, roll?.total, roll?.modifiers]);
  const hasSelection = (initiative?.initiative.map(entry => entry.roll) ?? saveRows?.map(row => row.roll) ?? [roll])
    .some(entry => entry && entry.advantage !== 'none');
  useEffect(()=>{
    setRolled(false); setLanded(false);
    const attackDuration=animate?D20_ROLL_DURATION_MS:0;
    const landing=window.setTimeout(()=>setLanded(true),attackDuration);
    const timer=window.setTimeout(()=>setRolled(true),attackDuration + (animate && hasSelection ? D20_SELECTION_DURATION_MS : 0));
    return ()=>{window.clearTimeout(timer);window.clearTimeout(landing);};
  },[initiative,rollKey,animate,hasSelection]);
  const damageKey = JSON.stringify(saveRows?.map(row=>row.damage) ?? beat?.damage);
  const revealResultKey = `${rollKey}:${damageKey}`;
  useEffect(()=>{
    if (revealKey.current === revealResultKey) {setDamageRolled(true); return;}
    setDamageRolled(false);
    if (!attackReady) return;
    const timer=window.setTimeout(()=>setDamageRolled(true),animateDamage?D20_ROLL_DURATION_MS:0);
    return ()=>window.clearTimeout(timer);
  },[attackReady,animateDamage,damageKey,revealResultKey]);
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
          const entryRoll=entry.roll ?? {kind:'d20' as const,dice:[{sides:20,result:entry.die}],advantage:'none' as const,total:entry.total,modifiers:[],text:''};
          return <div className="combat-initiative-row" key={entry.actorId}>
            <span className="combat-participant-portrait">{initiative.tokens[entry.actorId]?.tokenUrl?<img src={initiative.tokens[entry.actorId].tokenUrl} alt=""/>:<Swords/>}</span>
            <span className="combat-initiative-name"><b>{combatActorDisplayName(actor)}</b><small>{rolled?(entry.roll?.text??`${entry.die} ${entry.bonus>=0?'+':''}${entry.bonus} = ${entry.total}`):'Бросок инициативы…'}</small></span>
            <div className="combat-initiative-dice"><D20RollTray roll={entryRoll} rolling={animate&&!landed} selecting={!rolled} animate={animate}/></div>
            <strong className="combat-initiative-total">{rolled?entry.total:'…'}</strong>
          </div>;
        })}</div>
      </> : saveRows ? <>
        <p className="combat-presentation-muted">{beat?.sourceName} · Целей: {saveRows.length}</p>
        <div className="combat-save-rows">{saveRows.map(row => <div className="combat-save-row" key={row.id}>
          <div className="combat-save-name"><b>{row.rollerName ?? row.targetName}</b><small>{row.rollLabel}</small></div>
          {row.roll && <D20RollTray key={`${row.id}:${rollKey}`} roll={row.roll} rolling={animate&&!landed} selecting={!attackReady} animate={animate}/>}
          <div className="combat-save-outcome">{attackReady ? <><strong>{row.roll?.total} / СЛ {row.roll?.target?.value}</strong><span>{row.roll?.outcome==='success'?'Успех':'Провал'}</span><small>{row.roll?.text}</small></> : 'Спасбросок…'}</div>
          <div className="combat-save-damage" aria-label={`Урон: ${row.targetName}`}>{attackReady ? row.damage?.length ? row.damage.map((packet,i)=><div key={i}>
            <div className="combat-save-dice">{packet.roll?.dice.map((die,j)=><CommittedDie key={j} sides={die.sides} value={die.result} discarded={die.discarded} rolling={animateDamage&&!damageRolled}/>)}</div>
            {ready ? <><strong>{packet.amount} · {getDamageLabel(packet.damageType)}</strong><small>{packet.roll?.text ?? `Фиксированный урон: ${packet.amount}`}</small>{packet.beforeResistance!==undefined&&packet.beforeResistance!==packet.amount&&<small>{packet.beforeResistance} → {packet.amount} после {packet.adjustment==='immunity'?'иммунитета':packet.adjustment==='vulnerability'?'уязвимости':'сопротивления'}</small>}</> : <small>Бросок урона…</small>}
          </div>) : <small>Без урона</small> : <small>Урон после спасброска</small>}</div>
        </div>)}</div>
      </> : <>
        {beat?.sourceName&&<p className="combat-attack-versus"><b>{beat.sourceName}</b>{beat.targetName&&<><Swords size={18}/><b>{beat.targetName}</b></>}</p>}
        {isSave&&beat?.rollerName&&<p className="combat-presentation-muted">Бросает: {beat.rollerName} · {beat.rollLabel}</p>}
        {roll&&<div className="combat-attack-dice"><D20RollTray key={rollKey} roll={roll} rolling={animate&&!landed} selecting={!attackReady} critical={critical} animate={animate}/></div>}
        {attackReady&&critical&&!provisional&&<p role="status" className={`combat-critical-banner is-${critical}${animate?' is-animated':''}`}>{critical==='success'?'НАТУРАЛЬНАЯ 20 · КРИТИЧЕСКИЙ УСПЕХ':'НАТУРАЛЬНАЯ 1 · КРИТИЧЕСКИЙ ПРОВАЛ'}</p>}
        {attackReady&&roll?<div className={`combat-roll-result ${success?'is-hit':'is-miss'}`}>
          {!isSave && !isCheck ? <AttackRollEquation roll={roll}/> : <div className="combat-roll-equation"><strong>{roll.total}</strong>{!isUntargeted&&<span>{roll.total >= (roll.target?.value ?? 0)?'≥':'<'} <Shield size={18}/> СЛ {roll.target?.value}</span>}</div>}
          <h3>{provisional ? 'Результат ещё не подтверждён' : isUntargeted?(isSave?'Результат спасброска':'Результат проверки'):isSave?(success?'Спасбросок успешен':'Спасбросок провален'):roll.outcome==='crit'?'Критическое попадание!':success?'Попадание':'Промах'}</h3>
          {!isSave && !isCheck && roll.dice.some(die=>die.sides===20 && !die.discarded && die.result===1) && <p>Натуральная 1 — автоматический промах, даже если сумма достигает КД.</p>}
          {beat?.rollPhase==='before-reaction'&&<p>Цель может применить защитную реакцию до получения урона.</p>}
          {beat?.rollPhase==='after-reaction'&&<p>Итог после защитной реакции. Сохранён исходный бросок.</p>}
          <RollCalculationDetails roll={roll} provisional={provisional}/>
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
      {!ready && <button type="button" className="combat-reveal-result" onClick={()=>{revealKey.current=revealResultKey;setLanded(true);setRolled(true);setDamageRolled(true);}}>Показать результат</button>}
      {onInfluence && <RollInfluenceActions actions={influences} onUse={onInfluence} disabled={!ready || busy}/>}
      <div className="combat-presentation-actions"><button ref={buttonRef} type="button" className="combat-presentation-continue" disabled={!ready || busy} onClick={onClose}>{initiative?'Начать сражение':'Продолжить'}</button><button type="button" className="combat-presentation-settings" onClick={()=>setSettingsOpen(true)}>Настройки</button></div>
      {settingsOpen&&<SheetSettingsDialog initialPage="combat-rolls" allowDiceTest={false} onClose={()=>setSettingsOpen(false)}/>}
    </section>
  </div>,document.body);
}
