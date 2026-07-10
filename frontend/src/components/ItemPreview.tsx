import React from 'react';
import type { Card } from '../types';
import { RARITY_OPTIONS, getEquipmentSlotLabel } from '../types';
import { getItemTypeLabel } from '../constants/itemTypes';
import { getPropertyLabel } from '../utils/propertyLabels';
import { getDamageLabel, getDamageColorOnDark, getDamageIconPath } from '../utils/damageTypes';
import { getCurrencyIconPath, currencyIconStyle, formatPriceAmount } from '../utils/currencies';
import { hasElementalDamage } from '../utils/elementalDamage';
import { FormattedText } from '../utils/formattedText';
import { SPELL_CARD_CSS } from './spellCardStyle';
import { parseMechanicsStats, abilityFullRu } from '../engine/describeMechanics';
import { useContainerTotals, useResolvedRefs } from './RelatedItems';

// Третий режим отображения предмета (entityDisplay.items='interface'): стат-блок в стиле превью
// ЗАКЛИНАНИЯ (тёмный BG3, классы .sp-*, общий SPELL_CARD_CSS), но с полями ПРЕДМЕТА. Порядок полей —
// как в правой панели CardDetailModal; форматтеры — ОБЩИЕ (не локальные копии модалки).

interface ItemPreviewProps {
  card: Card;
  className?: string;
  disableHover?: boolean;
  onClick?: () => void;
}

const rarityLabel = (r?: string | null): string => RARITY_OPTIONS.find((o) => o.value === r)?.label || r || '';
const rarityColor = (card: Card): string | undefined =>
  (card.rarity === 'custom' && card.custom_rarity_color)
    ? card.custom_rarity_color
    : (RARITY_OPTIONS.find((o) => o.value === card.rarity)?.color || undefined);
const diceRu = (v: string) => String(v).replace(/(\d)[dд](\d)/gi, '$1к$2');
const fmtWeight = (w: number) => `${Math.round(w * 100) / 100} фунт.`;
const round2 = (n: number) => Math.round(n * 100) / 100;
// Чёрная PNG-иконка веса плохо читается на тёмном фоне — тонируем в пергаментный цвет.
const WEIGHT_ICON_STYLE: React.CSSProperties = { filter: 'brightness(0) invert(0.84) sepia(0.35) saturate(1.6) hue-rotate(-6deg)' };

// Вертикальный градиент цвета редкости поверх тёмного фона стат-блока (как в BG3). Обычные
// (common) — без градиента; невалидный/именованный цвет — тоже без (нужен #rrggbb для rgba).
const rarityGradient = (accent: string | undefined, rarity?: string | null): string | undefined => {
  if (!accent || rarity === 'common') return undefined;
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(accent);
  if (!m) return undefined;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16));
  const rgba = (a: number) => `rgba(${r},${g},${b},${a})`;
  return `linear-gradient(to bottom, ${rgba(0.3)}, ${rgba(0)} 55%), linear-gradient(160deg,#2b2520,#191410)`;
};

type MetaEntry = { img?: string; imgStyle?: React.CSSProperties; emoji?: string; label: string };

const ItemPreview: React.FC<ItemPreviewProps> = ({ card, className = '', disableHover = false, onClick }) => {
  const containerSum = useContainerTotals(card);
  // Содержимое контейнера рисуем ИНЛАЙН в тёмной теме стат-блока (не через RelatedCardsList —
  // тот несёт свой светлый заголовок «Связанные карты» и светлое CardPreview-превью, чужеродные тут).
  const contents = useResolvedRefs(card.type === 'container' ? (card.contents ?? []) : []);

  const subtype = [card.type ? getItemTypeLabel(card.type) : '', rarityLabel(card.rarity)].filter(Boolean).join(' · ');

  // Боевые статы: механика активного предмета (зелье/свиток) + оружейный/стихийный урон из полей карты.
  const mstats = parseMechanicsStats((card as { mechanics?: Record<string, unknown> | null }).mechanics);
  const weaponDmg = (card.bonus_type === 'damage' && card.bonus_value)
    ? [{ value: String(card.bonus_value), type: card.damage_type || 'bludgeoning' }] : [];
  const elementalDmg = (hasElementalDamage(card) && card.elemental_damage_value && card.elemental_damage_type)
    ? [{ value: String(card.elemental_damage_value), type: card.elemental_damage_type }] : [];
  const dmgEntries = [...weaponDmg, ...elementalDmg, ...mstats.damage];
  const healEntries = mstats.heal;
  const defenseBonus = (card.bonus_type === 'defense' && card.bonus_value) ? String(card.bonus_value) : null;
  const hasStats = mstats.attack || mstats.save || dmgEntries.length > 0 || healEntries.length > 0 || !!defenseBonus;

  // Мета-строки (только релевантные). Цена/вес — реальными иконками; остальное — эмодзи.
  const meta: MetaEntry[] = [];
  if (card.price != null && card.price > 0) {
    meta.push({ img: getCurrencyIconPath(card.price_currency), imgStyle: currencyIconStyle, label: formatPriceAmount(card.price, card.price_abbreviated !== false) });
  }
  if (card.weight != null) meta.push({ img: '/icons/weight.png', imgStyle: WEIGHT_ICON_STYLE, label: fmtWeight(card.weight) });
  if (card.slot) meta.push({ emoji: '🎽', label: getEquipmentSlotLabel(card.slot) });
  if (card.range) meta.push({ emoji: '🎯', label: card.range });
  if (card.properties && card.properties.length) meta.push({ emoji: '✦', label: card.properties.map((p) => getPropertyLabel(p)).join(', ') });

  const accent = rarityColor(card);
  const bgGradient = rarityGradient(accent, card.rarity);

  return (
    <div
      className={`sp-tip ${disableHover ? '' : 'sp-hoverable'} ${className}`}
      onClick={onClick}
      style={{ ...(onClick ? { cursor: 'pointer' } : {}), ...(bgGradient ? { background: bgGradient } : {}) }}
    >
      <style>{SPELL_CARD_CSS}</style>

      {card.image_url && card.image_url.trim() !== '' && (
        <img
          className="sp-bigicon"
          src={card.image_url}
          alt={card.name}
          onError={(e) => { (e.target as HTMLImageElement).src = '/default_image.png'; }}
        />
      )}

      <h3>{card.name || 'Название предмета'}</h3>
      <div className="sp-subtype">{subtype || 'Предмет'}</div>

      {hasStats && (
        <div className="sp-stats">
          {mstats.attack && (
            <div className="sp-srow"><span className="sp-lbl">Атака:</span><div className="sp-die">к20</div></div>
          )}
          {mstats.save && (
            <div className="sp-srow"><span className="sp-lbl">Спасбросок:</span><span className="sp-bonus">{abilityFullRu(mstats.saveAbility) || 'спасбросок'}</span></div>
          )}
          {defenseBonus && (
            <div className="sp-srow"><span className="sp-lbl">Защита:</span><span className="sp-bonus">{defenseBonus}</span></div>
          )}
          {dmgEntries.length > 0 && (
            <div className="sp-srow">
              <span className="sp-lbl">Урон:</span>
              <span className="sp-dmgval">
                {dmgEntries.map((d, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && <span className="sp-dmgsep">+</span>}
                    <span className="sp-dmgitem" style={{ color: getDamageColorOnDark(d.type) }}>
                      {diceRu(d.value)}
                      <img className="sp-dmgicon" src={getDamageIconPath(d.type)} alt="" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                      {getDamageLabel(d.type).toLowerCase()}
                    </span>
                  </React.Fragment>
                ))}
              </span>
            </div>
          )}
          {healEntries.length > 0 && (
            <div className="sp-srow">
              <span className="sp-lbl">Лечение:</span>
              <span className="sp-dmgval"><span className="sp-dmgitem" style={{ color: getDamageColorOnDark('healing') }}>{diceRu(healEntries.join(' + '))} лечение</span></span>
            </div>
          )}
        </div>
      )}

      <div className="sp-desc">
        <FormattedText text={card.description || 'Описание предмета'} emptyText="Описание предмета" />
      </div>

      {contents.length > 0 && (
        <div className="sp-classes">
          <b>{card.container_mode === 'choice' ? 'Один на выбор:' : 'Содержимое:'}</b>{' '}
          {contents.map(({ ref, card: c }, i) => (
            <span key={ref.card_id}>{i > 0 ? ', ' : ''}{c.name}{ref.quantity > 1 ? ` ×${ref.quantity}` : ''}</span>
          ))}
          {containerSum && (containerSum.weight > 0 || containerSum.gold > 0) && (
            <div className="sp-meta" style={{ marginTop: 4 }}>
              <span>
                <i style={{ fontStyle: 'normal' }}>Сумма содержимого:</i>
                <img className="sp-metaicon" src="/icons/weight.png" alt="" style={WEIGHT_ICON_STYLE} />{round2(containerSum.weight)}
                <span className="sp-dmgsep">·</span>
                <img className="sp-metaicon" src={getCurrencyIconPath('gold')} alt="" style={currencyIconStyle} />{round2(containerSum.gold)}
              </span>
            </div>
          )}
        </div>
      )}

      {card.requires_attunement && (
        <div className="sp-saveline">Требуется настройка{card.attunement ? `: ${card.attunement}` : ''}</div>
      )}

      {meta.length > 0 ? (
        <div className="sp-meta">
          {meta.map((m, i) => (
            <span key={i}>
              {m.img
                ? <img className="sp-metaicon" src={m.img} alt="" style={m.imgStyle} />
                : <i>{m.emoji}</i>}
              {m.label}
            </span>
          ))}
        </div>
      ) : (
        <div className="sp-spacer" />
      )}
    </div>
  );
};

export default ItemPreview;
