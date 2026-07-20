import React from 'react';
import type { Action } from '../types';
import { ACTION_RECHARGE_OPTIONS, ACTION_TYPE_OPTIONS } from '../types';
import type { WeaponAttackPreview } from '../engine/weapon';
import { getDamageColorOnDark, getDamageLabel, getDamageIconPath } from '../utils/damageTypes';
import { FormattedText } from '../utils/formattedText';
import { describeMechanics, parseMechanicsStats, abilityFullRu } from '../engine/describeMechanics';
import { actionCostResourceIds, resourceCostIcon, resourceLabel, type ResourceOption, useResourceOptions } from '../utils/resources';
import { SPELL_CARD_CSS } from './spellCardStyle';
import { useSiteSettings } from '../settings';
import OriginalName from './OriginalName';

interface ActionPreviewProps {
  action: Action;
  className?: string;
  disableHover?: boolean;
  onClick?: () => void;
  resources?: ResourceOption[];
  /** Контекстная подпись источника (лист/кузня): «Вид · Голиаф» и т.п. Замещает тип действия. */
  sourceLabel?: string;
  /** Числа оружейной атаки (из оружия в руке): «к20 +N» и строки урона. Парадигма №2. */
  weaponAttackPreview?: WeaponAttackPreview;
}

// "2d8" → "2к8" (русский BG3-тултип, как в design_preview)
const diceRu = (s: string) => String(s).replace(/(\d)[dд](\d)/gi, '$1к$2');
const fmtBonus = (n: number) => (n >= 0 ? `+${n}` : String(n));

const ActionPreview = ({ action, className = '', disableHover = false, onClick, resources: providedResources, sourceLabel, weaponAttackPreview: wp }: ActionPreviewProps) => {
  const loadedResources = useResourceOptions();
  const resources = providedResources || loadedResources;
  const { playerMode } = useSiteSettings();

  const actionTypeLabel = ACTION_TYPE_OPTIONS.find((o) => o.value === action.action_type)?.label || action.action_type || '';
  const rechargeLabel = action.recharge
    ? (ACTION_RECHARGE_OPTIONS.find((o) => o.value === action.recharge)?.label || action.recharge)
    : '';

  const subtype = sourceLabel || [actionTypeLabel, action.distance].filter(Boolean).join(' · ');

  const stats = parseMechanicsStats(action.mechanics as Record<string, unknown> | null | undefined);
  // Контекстные оружейные числа (wp) имеют приоритет над обобщённой механикой для атаки/урона.
  const showAttack = wp ? true : stats.attack;
  const dmgEntries = wp && wp.damages.length
    ? wp.damages.map((d) => ({ value: `${d.dice}${d.bonus !== 0 ? ` ${fmtBonus(d.bonus)}` : ''}`, type: d.type }))
    : stats.damage;
  const hasStats = showAttack || stats.save || dmgEntries.length > 0 || stats.heal.length > 0;

  // Парадигма №2: описание МЕХАНИКИ из данных (единый describeMechanics), не свободный текст.
  const mechDesc = describeMechanics(action.mechanics as Record<string, unknown> | null | undefined);

  // Стоимость: единый источник — mechanics.activation.cost (что списывает движок),
  // откат на устаревшие resources/resource, если стоимости в механике нет.
  const resourceIds: string[] = actionCostResourceIds(action);

  // Мета-строка
  const meta: Array<[string, string]> = [];
  if (rechargeLabel) {
    meta.push(['⟳', rechargeLabel + (action.recharge === 'custom' && action.recharge_custom ? ` (${action.recharge_custom})` : '')]);
  }

  return (
    <div
      className={`sp-tip ${disableHover ? '' : 'sp-hoverable'} ${className}`}
      onClick={onClick}
      style={onClick ? { cursor: 'pointer' } : undefined}
    >
      <style>{SPELL_CARD_CSS}</style>

      {action.image_url && action.image_url.trim() !== '' && (
        <img
          className="sp-bigicon"
          src={action.image_url}
          alt={action.name}
          onError={(e) => { (e.target as HTMLImageElement).src = '/default_image.png'; }}
        />
      )}

      <h3>{action.name || 'Название действия'}</h3>
      <div className="sp-subtype"><OriginalName nameEn={action.name_en} suffix={subtype || 'Действие'} /></div>

      {hasStats && (
        <div className="sp-stats">
          {showAttack && (
            <div className="sp-srow">
              <span className="sp-lbl">Атака:</span>
              <div className="sp-die">к20</div>
              {wp && <span className="sp-bonus">{fmtBonus(wp.attack)}</span>}
            </div>
          )}
          {stats.save && (
            <div className="sp-srow">
              <span className="sp-lbl">Спасбросок:</span>
              <span className="sp-bonus">{abilityFullRu(stats.saveAbility) || 'спасбросок'}</span>
            </div>
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
          {stats.heal.length > 0 && (
            <div className="sp-srow">
              <span className="sp-lbl">Лечение:</span>
              <span className="sp-dmgval">
                <span className="sp-dmgitem" style={{ color: getDamageColorOnDark('healing') }}>
                  {diceRu(stats.heal.join(' + '))}
                  <img className="sp-dmgicon" src={getDamageIconPath('healing')} alt="" />
                  лечение
                </span>
              </span>
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

      <div className="sp-desc">
        <FormattedText text={action.description || 'Описание действия'} emptyText="Описание действия" />
      </div>

      {action.show_detailed_description && action.detailed_description && (
        <div className="sp-upcast">
          <FormattedText text={action.detailed_description} emptyText="" />
        </div>
      )}

      {meta.length > 0 && (
        <div className="sp-meta">
          {meta.map(([icon, label], i) => (
            <span key={i}><i>{icon}</i>{label}</span>
          ))}
        </div>
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

export default ActionPreview;
