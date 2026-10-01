import type {ReactNode} from 'react';
import BattleMapCellPreview from './BattleMapCellPreview';

/** Shared map hover shell: the enemy summary and attack preview are one card. */
export default function CombatActorHoverPreview({name,hp,children}: {name:string;hp:{current:number;max:number};children?:ReactNode}) {
  const percent = hp.max > 0 ? Math.max(0,Math.min(100,hp.current/hp.max*100)) : 0;
  return <BattleMapCellPreview title={name} lines={[]} className="combat-actor-hover-preview">
    <div className="combat-actor-hover-preview__hp" role="progressbar" aria-label="Хиты"
      aria-valuemin={0} aria-valuemax={hp.max} aria-valuenow={Math.max(0,hp.current)}>
      <span style={{width:`${percent}%`}}/><b>{Math.max(0,hp.current)} / {hp.max}</b>
    </div>
    {children}
    <p className="combat-actor-hover-preview__hint">Нажмите I, чтобы узнать подробнее</p>
  </BattleMapCellPreview>;
}
