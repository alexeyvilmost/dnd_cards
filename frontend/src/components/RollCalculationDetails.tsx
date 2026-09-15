import type {RollLog} from '../mvp/contracts';
import {armorClassTerminology} from '../utils/armorClassTerminology';

export default function RollCalculationDetails({roll, provisional = false}: {roll: RollLog; provisional?: boolean}) {
  const natural = roll.dice.find(die => die.sides === 20 && !die.discarded)?.result;
  return <details className="combat-roll-details"><summary>Подробный расчёт</summary>
    <div className="combat-roll-detail-columns">
      <section aria-label="Модификаторы броска"><h4>Бонусы к броску</h4>{!provisional && <p>{armorClassTerminology(roll.text)}</p>}
        <ul className="combat-roll-modifiers">{roll.modifiers.map((modifier,i)=><li key={i}><span>{modifier.source}</span><b>{modifier.value>=0?'+':''}{modifier.value}</b></li>)}</ul>
        <p>Итого модификаторы: {roll.total - (natural ?? roll.total)}</p>
      </section>
      {roll.target?.type === 'ac' && <section aria-label="Расчёт КД цели"><h4>КД цели · {roll.target.value}</h4>
        {roll.target.breakdown ? <><p>{roll.target.breakdown.selectedMethod?.name}</p><ul className="combat-roll-modifiers">{roll.target.breakdown.parts.map((part,i)=><li key={i}><span>{part.source}{part.reason && <small> · {part.reason}</small>}</span><b>{part.value>=0?'+':''}{part.value}</b></li>)}</ul></> : <p>Детализация КД не сохранена для этого броска.</p>}
      </section>}
    </div>
  </details>;
}
