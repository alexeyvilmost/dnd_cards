import {useState} from 'react';
import type {RollLog} from '../mvp/contracts';
import {CommittedDie} from './CommittedD20';
import {splitD20Dice} from './rollTray';
import './D20RollTray.css';

/** Only lays out committed dice: cosmetic ordering never samples a game result. */
export default function D20RollTray({roll, rolling, selecting = false, critical, animate = true}: {
  roll: RollLog; rolling: boolean; selecting?: boolean; critical?: 'success' | 'failure'; animate?: boolean;
}) {
  const {primary, bonus} = splitD20Dice(roll);
  // Old logs store the kept die first. Do not teach the player that left always wins.
  const [reverse] = useState(() => Math.random() < .5);
  const ordered = reverse ? [...primary].reverse() : primary;
  const paired = roll.advantage !== 'none' && primary.length > 1;
  const ready = !rolling && !selecting;
  const label = roll.advantage === 'advantage' ? 'Преимущество' : 'Помеха';
  return <div className={`d20-roll-tray${paired ? ` is-${roll.advantage}` : ''}${animate ? ' is-animated' : ''}${ready ? ' is-resolved' : rolling ? ' is-tumbling' : ' is-comparing'}`}>
    {paired && <div className="d20-pair-label">{label}<small>{ready ? (roll.advantage === 'advantage' ? 'Выбрана большая кость' : 'Выбрана меньшая кость') : 'Выбор после остановки обеих костей'}</small></div>}
    <div className="d20-primary-dice">{ordered.map(({die,index}) => <div className={`d20-primary-slot${ready && paired ? die.discarded ? ' is-rejected' : ' is-kept' : ''}`} key={index}>
      <CommittedDie sides={die.sides} value={die.result} discarded={die.discarded} rolling={rolling} selectionPending={selecting} critical={critical} animateEffects={animate}/>
    </div>)}</div>
    {bonus.length > 0 && <section className="d20-bonus-tray" aria-label="Дополнительные кубики">
      <h4>Дополнительные кубики</h4>
      <div className="d20-bonus-dice">{bonus.map(({die,index}) => <div className={`d20-bonus-slot${die.sign === -1 ? ' is-penalty' : ''}`} key={index}>
        <span>{die.source || 'Модификатор броска'}</span>
        <CommittedDie sides={die.sides} value={die.result} discarded={die.discarded} rolling={rolling} animateEffects={animate}/>
        <small>{die.sign === -1 ? '−' : '+'} к{die.sides}{!rolling && `: ${die.result}`}</small>
      </div>)}</div>
    </section>}
  </div>;
}
