import type { ReactNode } from 'react';
import type { Card } from '../types';
import { getRaritySymbol, getRaritySymbolDescription } from '../utils/raritySymbols';
import { getDamageIconPath, type DamageType } from '../utils/damageTypes';
import { getCurrencyIconPath } from '../utils/currencies';
import SheetEntityRow from './SheetEntityRow';

// Ряд-предмет: библиотечный вид (изображение, имя, чипы характеристик) в тёмной
// теме листа. Вторая строка — вес/урон/защита/цена. Без CARD_NUMBER.

const RARITY_HEX: Record<string, string> = {
  common: '#cbc3b1',
  uncommon: '#34d399',
  rare: '#60a5fa',
  very_rare: '#c084fc',
  epic: '#c084fc',
  legendary: '#fbbf24',
  artifact: '#fbbf24',
  relic: '#f87171',
};

const rarityColor = (card: Card): string =>
  card.rarity === 'custom' && card.custom_rarity_color
    ? card.custom_rarity_color
    : RARITY_HEX[card.rarity] || '#e7ddc7';

const hideImg = (e: React.SyntheticEvent<HTMLImageElement>) => {
  (e.currentTarget as HTMLImageElement).style.display = 'none';
};

function itemChips(card: Card): ReactNode {
  const chips: ReactNode[] = [];
  if (card.weight != null) {
    chips.push(<span key="w" className="sheet-item-chip">{card.weight}<img className="sheet-chip-mono" src="/icons/weight.png" alt="вес" onError={hideImg} /></span>);
  }
  if (card.bonus_type === 'damage' && card.bonus_value) {
    chips.push(
      <span key="d" className="sheet-item-chip">
        {card.bonus_value}
        {card.damage_type && <img src={getDamageIconPath(card.damage_type as DamageType)} alt="" onError={hideImg} />}
      </span>,
    );
  }
  if (card.bonus_type === 'defense') {
    chips.push(<span key="def" className="sheet-item-chip">{card.bonus_value || 'КД'}<img className="sheet-chip-mono" src="/icons/defense.png" alt="защита" onError={hideImg} /></span>);
  }
  if (card.price != null && card.price > 0) {
    chips.push(<span key="p" className="sheet-item-chip">{card.price}<img src={getCurrencyIconPath(card.price_currency)} alt="цена" onError={hideImg} /></span>);
  }
  if (!chips.length) return null;
  return <span className="sheet-item-chips">{chips}</span>;
}

interface Props {
  card: Card;
  qty?: number;
  dimmed?: boolean;
  selected?: boolean;
  onClick?: () => void;
  right?: ReactNode;
  stamp?: string | null;
}

export default function SheetItemRow({ card, qty, dimmed, selected, onClick, right, stamp }: Props) {
  return (
    <SheetEntityRow
      imageUrl={card.image_url}
      name={card.name}
      accent={rarityColor(card)}
      qty={qty}
      dimmed={dimmed}
      selected={selected}
      onClick={onClick}
      right={right}
      stamp={stamp}
      detail={itemChips(card)}
      namePrefix={
        <span className="sheet-item-rarity" title={getRaritySymbolDescription(card.rarity)}>{getRaritySymbol(card.rarity)}</span>
      }
      nameSuffix={
        card.requires_attunement
          ? <img className="sheet-item-attune" src="/icons/attunement.png" alt="настройка" title="Требуется настройка" />
          : undefined
      }
    />
  );
}
