import React from 'react';
import type { Card } from '../types';
import { RARITY_OPTIONS, getEquipmentSlotLabel } from '../types';
import { getItemTypeLabel } from '../constants/itemTypes';
import { getPropertyLabel } from '../utils/propertyLabels';
import { getDamageLabel, getDamageColorOnDark, getDamageIconPath } from '../utils/damageTypes';
import { getCurrencyInfo, formatPriceAmount } from '../utils/currencies';
import { getRaritySymbol } from '../utils/raritySymbols';
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

  // Мета-строки (только релевантные).
  const meta: Array<[string, string]> = [];
  if (card.price != null && card.price > 0) {
    const cur = getCurrencyInfo(card.price_currency);
    meta.push(['💰', `${formatPriceAmount(card.price, card.price_abbreviated !== false)} ${cur.short}`]);
  }
  if (card.weight != null) meta.push(['⚖', fmtWeight(card.weight)]);
  if (card.slot) meta.push(['🎽', getEquipmentSlotLabel(card.slot)]);
  if (card.range) meta.push(['🎯', card.range]);
  if (card.properties && card.properties.length) meta.push(['✦', card.properties.map((p) => getPropertyLabel(p)).join(', ')]);

  const accent = rarityColor(card);

  return (
    <div
      className={`sp-tip ${disableHover ? '' : 'sp-hoverable'} ${className}`}
      onClick={onClick}
      style={{ ...(onClick ? { cursor: 'pointer' } : {}), ...(accent ? ({ '--sp-accent': accent } as React.CSSProperties) : {}) }}
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

      <h3>
        <span className="sp-rarity-glyph" title={rarityLabel(card.rarity)} style={accent ? { color: accent } : undefined}>{getRaritySymbol(card.rarity)}</span>
        {' '}{card.name || 'Название предмета'}
      </h3>
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
              <span><i>Σ</i>{Math.round(containerSum.weight * 100) / 100} фунт. · {Math.round(containerSum.gold * 100) / 100} ЗМ</span>
            </div>
          )}
        </div>
      )}

      {card.requires_attunement && (
        <div className="sp-saveline">Требуется настройка{card.attunement ? `: ${card.attunement}` : ''}</div>
      )}

      {meta.length > 0 ? (
        <div className="sp-meta">
          {meta.map(([icon, label], i) => (<span key={i}><i>{icon}</i>{label}</span>))}
        </div>
      ) : (
        <div className="sp-spacer" />
      )}
    </div>
  );
};

export default ItemPreview;
