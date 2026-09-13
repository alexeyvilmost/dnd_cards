import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Coins, Sparkles, Trophy } from 'lucide-react';
import type { RoguelikeRun } from '../roguelike/api';
import type { Card } from '../types';
import { getCardsIndex } from '../utils/cardsIndex';
import SheetItemRow from './SheetItemRow';
import HoverCard from './HoverCard';
import ItemPreview from './ItemPreview';
import { useCombatDialogFocus } from './useCombatDialogFocus';
import '../dice/CombatPresentation.css';

export default function CombatRewardDialog({run,onClose}: {run:RoguelikeRun;onClose:()=>void}) {
  const dialogRef = useCombatDialogFocus();
  const [cards,setCards]=useState<Map<string,Card>>(new Map());
  const [error,setError]=useState(false);
  useEffect(()=>{let active=true;void getCardsIndex().then(rows=>{if(active)setCards(rows);}).catch(()=>{if(active)setError(true);});return()=>{active=false;};},[]);
  const reward=run.last_reward;
  const items=reward.items??(reward.item?[reward.item]:[]);
  const won=run.status!=='defeat';
  return createPortal(<div className="combat-presentation-backdrop"><section ref={dialogRef} tabIndex={-1} className="combat-presentation-dialog forge" role="dialog" aria-modal="true" aria-label="Итоги сражения">
    <Trophy className="combat-reward-trophy" size={38}/><p className="combat-presentation-kicker">СРАЖЕНИЕ ЗАВЕРШЕНО</p>
    <h2>{won?'Награда за победу':'Поражение'}</h2>
    <div className="combat-reward-totals"><span><Sparkles/><strong>+{won?reward.experience??0:0}</strong><small>опыта</small></span>
      <span><Coins/><strong>+{won?reward.gold??0:0}</strong><small>золота</small></span></div>
    {won&&items.length>0&&<div className="combat-reward-items"><h3>Добыча</h3>{items.map(item=>{
      const card=cards.get(item.card_id);
      return card?<HoverCard key={item.card_id} content={<ItemPreview card={card} disableHover/>}><SheetItemRow card={card} qty={1}/></HoverCard>
        :<p key={item.card_id}>{error?item.name:'Загружаем предмет…'}</p>;
    })}</div>}
    <p className="combat-presentation-muted">{won?'Награда уже добавлена в лист персонажа.':'За поражение награда не начисляется.'}</p>
    <button autoFocus type="button" className="combat-presentation-continue" onClick={onClose}>{won?'Вернуться в лагерь':'К результату забега'}</button>
  </section></div>,document.body);
}
