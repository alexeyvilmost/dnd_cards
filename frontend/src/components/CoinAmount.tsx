import CurrencyPriceInline from './CurrencyPriceInline';
import {formatCopper} from '../utils/money';

/** A computed total, rendered with the same coin assets as entity prices. */
export default function CoinAmount({copper}:{copper:number}) {
 const value=Math.max(0,Math.round(copper));
 const parts=[{currency:'gold',amount:Math.floor(value/100)},{currency:'silver',amount:Math.floor(value%100/10)},{currency:'copper',amount:value%10}].filter(p=>p.amount>0);
 if(!parts.length)parts.push({currency:'copper',amount:0});
 return <span className="coin-amount" aria-label={formatCopper(value)} style={{display:'inline-flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
  {parts.map(p=><span key={p.currency} style={{display:'inline-flex',alignItems:'center',gap:3}}><CurrencyPriceInline price={p.amount} currency={p.currency} abbreviate={false} iconClassName="w-4 h-4"/></span>)}
 </span>;
}
