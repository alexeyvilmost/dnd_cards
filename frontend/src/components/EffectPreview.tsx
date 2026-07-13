import React from 'react';
import type { PassiveEffect } from '../types';
import { PASSIVE_EFFECT_TYPE_OPTIONS } from '../types';
import { getDamageColorOnDark, getDamageLabel, getDamageIconPath } from '../utils/damageTypes';
import { FormattedText } from '../utils/formattedText';
import { SPELL_CARD_CSS } from './spellCardStyle';
import { describeMechanics, parseMechanicsStats, abilityFullRu } from '../engine/describeMechanics';
import { actionCostResourceIds, resourceCostIcon, resourceLabel, useResourceOptions } from '../utils/resources';
import { useSiteSettings } from '../settings';

// Превью эффекта в едином стиле карточек заклинаний/действий/предметов (SPELL_CARD_CSS, классы .sp-*).
// Тип эффекта → sp-subtype (или sourceLabel в контексте листа/кузни), условие → sp-saveline,
// подробное описание → sp-upcast. Сохраняем пользовательские размер/выравнивание текста.

interface EffectPreviewProps {
  effect: PassiveEffect;
  className?: string;
  disableHover?: boolean;
  onClick?: () => void;
  /** Контекстная подпись источника (лист/кузня): «Вид · Эльф», «Черта · Ловкач». Замещает тип эффекта. */
  sourceLabel?: string;
}

// «2d8» → «2к8» (русский BG3-тултип, как в остальных превью).
const diceRu = (s: string) => String(s).replace(/(\d)[dд](\d)/gi, '$1к$2');

const effectTypeLabel = (effectType: string) =>
  PASSIVE_EFFECT_TYPE_OPTIONS.find((opt) => opt.value === effectType)?.label || effectType;

const EffectPreview = ({ effect, className = '', disableHover = false, onClick, sourceLabel }: EffectPreviewProps) => {
  const resources = useResourceOptions();
  const { playerMode } = useSiteSettings();

  const subtype = [sourceLabel || effectTypeLabel(effect.effect_type), effect.type]
    .filter(Boolean)
    .join(' · ');

  // Боевые статы из механики (сопротивления/урон/спас, если у эффекта они есть).
  const stats = parseMechanicsStats(effect.mechanics as Record<string, unknown> | null | undefined);
  const hasStats = stats.attack || stats.save || stats.damage.length > 0 || stats.heal.length > 0;

  // Парадигма №2: авто-описание МЕХАНИКИ (сырые id/стоимость/использования) — прячем в режиме игрока.
  const mechDesc = describeMechanics(effect.mechanics as Record<string, unknown> | null | undefined);

  // Стоимость активируемого эффекта (mechanics.activation.cost) — плашкой снизу, как у действий.
  const resourceIds: string[] = actionCostResourceIds(effect as { mechanics?: Record<string, unknown> | null });

  const descStyle: React.CSSProperties = {
    ...(effect.description_font_size ? { fontSize: `${effect.description_font_size}px` } : {}),
    ...(effect.text_alignment ? { textAlign: effect.text_alignment as 'left' | 'center' | 'right' } : {}),
  };
  const detailStyle: React.CSSProperties = {
    ...(effect.detailed_description_font_size ? { fontSize: `${effect.detailed_description_font_size}px` } : {}),
    ...(effect.detailed_description_alignment ? { textAlign: effect.detailed_description_alignment as 'left' | 'center' | 'right' } : {}),
  };

  return (
    <div
      className={`sp-tip ${disableHover ? '' : 'sp-hoverable'} ${className}`}
      onClick={onClick}
      style={onClick ? { cursor: 'pointer' } : undefined}
    >
      <style>{SPELL_CARD_CSS}</style>

      {effect.image_url && effect.image_url.trim() !== '' && (
        <img
          className="sp-bigicon"
          src={effect.image_url}
          alt={effect.name}
          onError={(e) => { (e.target as HTMLImageElement).src = '/default_image.png'; }}
        />
      )}

      <h3>{effect.name || 'Название эффекта'}</h3>
      <div className="sp-subtype">{subtype || 'Эффект'}</div>

      {hasStats && (
        <div className="sp-stats">
          {stats.attack && (
            <div className="sp-srow"><span className="sp-lbl">Атака:</span><div className="sp-die">к20</div></div>
          )}
          {stats.save && (
            <div className="sp-srow"><span className="sp-lbl">Спасбросок:</span><span className="sp-bonus">{abilityFullRu(stats.saveAbility) || 'спасбросок'}</span></div>
          )}
          {stats.damage.length > 0 && (
            <div className="sp-srow">
              <span className="sp-lbl">Урон:</span>
              <span className="sp-dmgval">
                {stats.damage.map((d, i) => (
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
          {stats.heal.length > 0 && (
            <div className="sp-srow">
              <span className="sp-lbl">Лечение:</span>
              <span className="sp-dmgval"><span className="sp-dmgitem" style={{ color: getDamageColorOnDark('healing') }}>{diceRu(stats.heal.join(' + '))} лечение</span></span>
            </div>
          )}
        </div>
      )}

      {/* Авто-описание механики (сырые id/стоимость/использования) — прячем в режиме игрока. */}
      {!playerMode && (mechDesc.summary || mechDesc.details.length > 0) && (
        <div className="sp-desc" style={{ marginBottom: 4 }}>
          {mechDesc.summary && <FormattedText text={mechDesc.summary} emptyText="" />}
          {mechDesc.details.map((d, i) => (
            <div key={i} style={{ fontSize: '0.85em', opacity: 0.75 }}>
              <FormattedText text={d} emptyText="" />
            </div>
          ))}
        </div>
      )}

      <div className="sp-desc" style={descStyle}>
        <FormattedText text={effect.description || 'Описание эффекта'} emptyText="Описание эффекта" />
      </div>

      {effect.show_detailed_description && effect.detailed_description && (
        <div className="sp-upcast" style={detailStyle}>
          <FormattedText text={effect.detailed_description} emptyText="" />
        </div>
      )}

      {effect.condition_description && (
        <div className="sp-saveline">Условие: {effect.condition_description}</div>
      )}

      {resourceIds.length > 0 ? (
        <div className="sp-costbar">
          {resourceIds.map((id, i) => (
            <span className="sp-cost" key={i}>
              <img
                className="sp-costicon"
                src={resourceCostIcon(resources, id)}
                alt={resourceLabel(resources, id)}
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              />
              {resourceLabel(resources, id)}
            </span>
          ))}
        </div>
      ) : (
        <div className="sp-spacer" />
      )}
    </div>
  );
};

export default EffectPreview;
