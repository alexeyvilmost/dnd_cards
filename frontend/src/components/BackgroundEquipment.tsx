import { useEffect, useState } from 'react';
import type { Card, EquipmentOption } from '../types';
import { getCardsIndex } from '../utils/cardsIndex';
import { getCurrencyIconPath, currencyIconStyle } from '../utils/currencies';
import CardPreview from './CardPreview';

// Совместим и с предысторией ({a,b}), и с классом ({a,b,c}).
type EquipOptions = {
  option_a?: EquipmentOption | null;
  option_b?: EquipmentOption | null;
  option_c?: EquipmentOption | null;
};
type OptKey = 'a' | 'b' | 'c';

const hasContent = (o?: EquipmentOption | null) => !!o && ((o.items?.length || 0) > 0 || (o.gold || 0) > 0);

// Иконка предмета с карточкой-превью (как в библиотеке) при наведении.
const ItemIcon: React.FC<{ card: Card; quantity: number }> = ({ card, quantity }) => {
  const [hover, setHover] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  return (
    <div
      className="bgeq-item"
      onMouseEnter={(e) => { setHover(true); setPos({ x: e.clientX, y: e.clientY }); }}
      onMouseLeave={() => setHover(false)}
      onMouseMove={(e) => setPos({ x: e.clientX, y: e.clientY })}
    >
      <img
        src={card.image_url || '/default_image.png'}
        alt={card.name}
        onError={(e) => ((e.target as HTMLImageElement).src = '/default_image.png')}
      />
      {quantity > 1 && <span className="bgeq-qty">{quantity}</span>}
      {hover && (
        <div
          style={{
            position: 'fixed', zIndex: 100, pointerEvents: 'none',
            left: Math.min(pos.x + 14, window.innerWidth - 210),
            top: Math.min(Math.max(pos.y - 40, 8), window.innerHeight - 290),
          }}
        >
          <CardPreview card={card} disableHover />
        </div>
      )}
    </div>
  );
};

const Variant: React.FC<{
  label: string; option?: EquipmentOption | null; index: Map<string, Card>;
  selectable?: boolean; selected?: boolean; onSelect?: () => void;
}> = ({ label, option, index, selectable, selected, onSelect }) => {
  if (!hasContent(option)) return null;
  const items = (option!.items || [])
    .map((r) => ({ r, card: index.get(r.card_id) }))
    .filter((x): x is { r: { card_id: string; quantity: number }; card: Card } => !!x.card);
  const gold = option!.gold || 0;

  const inner = (
    <>
      <div className="bgeq-divider"><span className="bgeq-letter">{label}</span></div>
      <div className="bgeq-row">
        <div className="bgeq-items">
          {items.map(({ r, card }) => (
            <ItemIcon key={r.card_id} card={card} quantity={r.quantity} />
          ))}
          {items.length === 0 && <span className="bgeq-only-gold">только золото</span>}
        </div>
        {gold > 0 && (
          <div className="bgeq-gold" title={`${gold} золота`}>
            <img src={getCurrencyIconPath('gold')} alt="золото" style={currencyIconStyle} />
            <span className="bgeq-gold-amount">{gold}</span>
          </div>
        )}
      </div>
    </>
  );

  if (selectable) {
    return (
      <button type="button" className={`bgeq-variant bgeq-variant--btn${selected ? ' bgeq-variant--selected' : ''}`} onClick={onSelect}>
        {inner}
      </button>
    );
  }
  return <div className="bgeq-variant">{inner}</div>;
};

export const BackgroundEquipment: React.FC<{
  options?: EquipOptions | null;
  selectable?: boolean;
  selected?: OptKey;
  onSelect?: (key: OptKey) => void;
}> = ({ options, selectable, selected, onSelect }) => {
  const [index, setIndex] = useState<Map<string, Card>>(new Map());
  useEffect(() => {
    let alive = true;
    getCardsIndex().then((m) => alive && setIndex(m));
    return () => { alive = false; };
  }, []);

  if (!options) return null;
  if (!hasContent(options.option_a) && !hasContent(options.option_b) && !hasContent(options.option_c)) return null;

  return (
    <div className="bgeq">
      <style>{`
        .bgeq{ margin-top:auto; padding-top:10px; }
        .bgeq-title{ text-align:center; color:#e7cf9a; font-weight:700; font-size:.95rem; margin-bottom:2px; }
        .bgeq-variant{ margin-top:4px; }
        .bgeq-variant--btn{ display:block; width:100%; text-align:left; background:transparent; border:1px solid transparent; border-radius:8px; padding:2px 8px; cursor:pointer; transition:border-color .15s, background .15s; }
        .bgeq-variant--btn:hover{ border-color:#8a7320; }
        .bgeq-variant--selected{ border-color:#c9a227; background:rgba(201,162,39,.12); }
        .bgeq-divider{ display:flex; align-items:center; gap:10px; margin:6px 0 8px; }
        .bgeq-divider::before, .bgeq-divider::after{
          content:""; flex:1; height:1px;
          background:linear-gradient(90deg, transparent, #8a7320 35%, #c9a227 50%, #8a7320 65%, transparent);
        }
        .bgeq-letter{ color:#c9a227; font-family:"Georgia",serif; font-size:1rem; line-height:1; }
        .bgeq-row{ display:flex; align-items:center; justify-content:space-between; gap:12px; }
        .bgeq-items{ display:flex; gap:8px; flex-wrap:wrap; align-items:center; min-height:46px; }
        .bgeq-item{ position:relative; width:46px; height:46px; flex:0 0 auto;
          border-radius:6px; background:rgba(0,0,0,.25); border:1px solid #4a3f35;
          display:flex; align-items:center; justify-content:center; }
        .bgeq-item > img{ width:40px; height:40px; object-fit:contain; }
        .bgeq-qty{ position:absolute; bottom:-4px; right:-4px; min-width:15px; height:15px; padding:0 3px;
          border-radius:8px; background:#1a1410; border:1px solid #8a7320; color:#e7cf9a;
          font-size:.62rem; font-weight:700; line-height:13px; text-align:center; }
        .bgeq-only-gold{ color:#a59886; font-size:.8rem; font-style:italic; }
        .bgeq-gold{ display:flex; flex-direction:column; align-items:center; flex:0 0 auto; }
        .bgeq-gold img{ width:34px; height:34px; object-fit:contain; }
        .bgeq-gold-amount{ color:#e7cf9a; font-weight:700; font-size:.95rem; line-height:1; margin-top:1px; }
      `}</style>
      <div className="bgeq-title">Снаряжение.</div>
      <Variant label="А" option={options.option_a} index={index} selectable={selectable} selected={selected === 'a'} onSelect={() => onSelect?.('a')} />
      <Variant label="Б" option={options.option_b} index={index} selectable={selectable} selected={selected === 'b'} onSelect={() => onSelect?.('b')} />
      <Variant label="В" option={options.option_c} index={index} selectable={selectable} selected={selected === 'c'} onSelect={() => onSelect?.('c')} />
    </div>
  );
};

export default BackgroundEquipment;
