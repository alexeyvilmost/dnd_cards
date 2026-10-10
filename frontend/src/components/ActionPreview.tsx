import ReviewStatusCorner from './ReviewStatusCorner';
import React from 'react';
import type { Action } from '../types';
import { ACTION_TYPE_OPTIONS } from '../types';
import type { WeaponAttackPreview } from '../engine/weapon';
import { getDamageColorOnDark, getDamageLabel, getDamageIconPath } from '../utils/damageTypes';
import { FormattedText } from '../utils/formattedText';
import { describeMechanics, parseMechanicsStats } from '../engine/describeMechanics';
import { formatFormulaDisplay } from '../engine/formula';
import { actionCostResourceIds, resourceCostIcon, resourceLabel, type ResourceOption, useResourceOptions } from '../utils/resources';
import { SPELL_CARD_CSS } from './spellCardStyle';
import { useSiteSettings } from '../settings';
import { useCharacterFormulaCtx } from '../contexts/CharacterFormulaContext';
import OriginalName from './OriginalName';
import { findMastery, useMasteryEffects } from '../utils/mastery';
import { getPropertyLabel } from '../utils/propertyLabels';
import {actionUsagePreview} from '../engine/actionUsagePreview';
import type {RuntimeState} from '../mvp/contracts';
import UiIcon from './UiIcon';
import SaveDamagePreview from './SaveDamagePreview';
import RollPreviewMeta from './RollPreviewMeta';
import { recoveryPreview } from '../engine/recoveryPreview';

interface ActionPreviewProps {
  action: Action;
  runtime?: Pick<RuntimeState,'resources'|'maxResources'>;
  className?: string;
  disableHover?: boolean;
  onClick?: () => void;
  resources?: ResourceOption[];
  /** Контекстная подпись источника (лист/кузня): «Вид · Голиаф» и т.п. Замещает тип действия. */
  sourceLabel?: string;
  /** Числа оружейной атаки (из оружия в руке): «к20 +N» и строки урона. Парадигма №2. */
  weaponAttackPreview?: WeaponAttackPreview;
}

const fmtBonus = (n: number) => (n >= 0 ? `+${n}` : String(n));

const ActionPreview = ({ action, runtime, className = '', disableHover = false, onClick, resources: providedResources, sourceLabel, weaponAttackPreview: wp }: ActionPreviewProps) => {
  const loadedResources = useResourceOptions();
  const resources = providedResources || loadedResources;
  const { playerMode, showDetailedPreview } = useSiteSettings();
  const formulaCtx = useCharacterFormulaCtx();
  const mastery = findMastery(useMasteryEffects(), wp?.masteryId);
  const fmt = (s: string) => formatFormulaDisplay(s, formulaCtx);

  const actionTypeLabel = ACTION_TYPE_OPTIONS.find((o) => o.value === action.action_type)?.label || action.action_type || '';
  const rechargeLabel = recoveryPreview(action);

  const subtype = sourceLabel || actionTypeLabel;

  const stats = parseMechanicsStats(action.mechanics as Record<string, unknown> | null | undefined);
  // Контекстные оружейные числа (wp) имеют приоритет над обобщённой механикой для атаки/урона.
  const showAttack = wp ? true : stats.attack;
  const dmgEntries = wp && wp.damages.length
    ? wp.damages.map((d) => ({ value: `${d.dice}${d.bonus !== 0 ? ` ${fmtBonus(d.bonus)}` : ''}`, type: d.type }))
    : stats.damage;
  const hasStats = dmgEntries.length > 0 || stats.heal.length > 0 || !!stats.damageOnSaveSuccess?.length;

  // Парадигма №2: описание МЕХАНИКИ из данных (единый describeMechanics), не свободный текст.
  const mechDesc = describeMechanics(action.mechanics as Record<string, unknown> | null | undefined, formulaCtx);

  // Стоимость: единый источник — mechanics.activation.cost (что списывает движок),
  // откат на устаревшие resources/resource, если стоимости в механике нет.
  const resourceIds: string[] = actionCostResourceIds(action);
  const usages = actionUsagePreview(action, runtime);

  // Мета-строка
  const meta: Array<[string, string]> = [];
  if (action.distance) meta.push(['range', action.distance]);
  if (rechargeLabel) {
    meta.push(['⟳', rechargeLabel]);
  }

  return (
    <div
      className={`sp-tip ${disableHover ? '' : 'sp-hoverable'} ${className}`}
      onClick={onClick}
      style={onClick ? { cursor: 'pointer' } : undefined}
    >
      <style>{SPELL_CARD_CSS}</style>
      <ReviewStatusCorner entity={action} entityType="action" />

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
          {dmgEntries.length > 0 && (
            <div className="sp-srow">
              <span className="sp-lbl">Урон:</span>
              <span className="sp-dmgval">
                {dmgEntries.map((d, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && <span className="sp-dmgsep">+</span>}
                    <span className="sp-dmgitem" style={{ color: getDamageColorOnDark(d.type) }}>
                      {fmt(d.value)}
                      {d.type === 'triggering_attack' ? ' к урону исходной атаки' : <>
                        <img className="sp-dmgicon" src={getDamageIconPath(d.type)} alt="" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                        {getDamageLabel(d.type).toLowerCase()}
                      </>}
                    </span>
                  </React.Fragment>
                ))}
              </span>
            </div>
          )}
          {!wp && <SaveDamagePreview stats={stats} />}
          {stats.heal.length > 0 && (
            <div className="sp-srow">
              <span className="sp-lbl">Лечение:</span>
              <span className="sp-dmgval">
                <span className="sp-dmgitem" style={{ color: getDamageColorOnDark('healing') }}>
                  {fmt(stats.heal.join(' + '))}
                  <img className="sp-dmgicon" src={getDamageIconPath('healing')} alt="" />
                  лечение
                </span>
              </span>
            </div>
          )}
        </div>
      )}

      {wp?.weaponName && (
        <div className="sp-desc" style={{ marginBottom: 4 }}>
          <div><strong>Оружие:</strong> {wp.weaponName}</div>
          <div><strong>Режим:</strong> {wp.mode === 'ranged'
            ? `дальний ${wp.normalRangeFt ?? '?'} / ${wp.longRangeFt ?? '?'} фт`
            : `рукопашный · досягаемость ${wp.reachFt ?? 5} фт`}</div>
          {!!wp.properties?.length && <div><strong>Свойства:</strong> {wp.properties.map(getPropertyLabel).join(', ')}</div>}
          {mastery && <div><strong>Мастерство:</strong> <FormattedText onDark text={`[[${mastery.name}|effect:${mastery.id}]]`} /></div>}
        </div>
      )}

      {/* Авто-описание механики (сырые id/стоимость/использования) — прячем в режиме игрока. */}
      {!playerMode && (mechDesc.summary || mechDesc.details.length > 0) && (
        <div className="sp-desc" style={{ marginBottom: 4 }}>
          {mechDesc.summary && <FormattedText onDark text={mechDesc.summary} emptyText="" />}
          {mechDesc.details.map((d, i) => (
            <div key={i} style={{ fontSize: '0.85em', opacity: 0.75 }}>
              <FormattedText onDark text={d} emptyText="" />
            </div>
          ))}
        </div>
      )}

      <div className="sp-desc">
        <FormattedText onDark text={action.description || 'Описание действия'} emptyText="Описание действия" />
      </div>

      {showDetailedPreview && action.show_detailed_description && action.detailed_description && (
        <div className="sp-upcast">
          <FormattedText onDark text={action.detailed_description} emptyText="" />
        </div>
      )}

      {(meta.length > 0 || usages.length > 0 || showAttack || stats.save) && (
        <div className="sp-meta">
          <RollPreviewMeta stats={{ ...stats, attack: showAttack }} attackBonus={wp?.attack} />
          {meta.map(([icon, label], i) => (
            <span key={i}><UiIcon symbol={icon} />{label}</span>
          ))}
          {usages.map(usage => (
            <span className="sp-usage" role="status" key={usage.key}>
              <UiIcon symbol="uses" />
              {usage.key.startsWith('uses_') ? 'Использования' : resourceLabel(resources, usage.key)}: {usage.remaining}/{usage.maximum}
            </span>
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
