import React from 'react';
import type { Action } from '../types';
import { ACTION_RECHARGE_OPTIONS, ACTION_TYPE_OPTIONS } from '../types';
import { getDamageColor, getDamageLabel, getDamageIconPath } from '../utils/damageTypes';
import { FormattedText } from '../utils/formattedText';
import { describeMechanics } from '../engine/describeMechanics';
import { resourceCostIcon, resourceLabel, type ResourceOption, useResourceOptions } from '../utils/resources';
import { SPELL_CARD_CSS } from './spellCardStyle';

interface ActionPreviewProps {
  action: Action;
  className?: string;
  disableHover?: boolean;
  onClick?: () => void;
  resources?: ResourceOption[];
}

// "2d8" → "2к8" (русский BG3-тултип, как в design_preview)
const diceRu = (s: string) => String(s).replace(/(\d)[dд](\d)/gi, '$1к$2');

type DamageEntry = { value: string; type: string };

// Разбор унифицированной механики: атака/спасбросок/урон/лечение.
function parseMechanics(mechanics: Record<string, unknown> | null | undefined) {
  const result = {
    attack: false,
    save: null as string | null,
    damage: [] as DamageEntry[],
    heal: [] as string[],
  };
  const effects = Array.isArray(mechanics?.effects) ? (mechanics!.effects as Record<string, unknown>[]) : [];

  const readDamage = (p: Record<string, unknown>) => {
    const val = p.dice ?? p.formula ?? p.amount;
    if (val === undefined || val === null || val === '') return;
    result.damage.push({ value: String(val), type: String(p.damage_type || p.type || 'damage') });
  };
  const readHeal = (p: Record<string, unknown>) => {
    const val = p.dice ?? p.formula ?? p.amount;
    if (val !== undefined && val !== null && val !== '') result.heal.push(String(val));
  };
  const scanPayloads = (arr: unknown) => {
    (Array.isArray(arr) ? (arr as Record<string, unknown>[]) : []).forEach((p) => {
      if (p?.kind === 'damage') readDamage(p);
      else if (p?.kind === 'healing') readHeal(p);
    });
  };

  effects.forEach((interaction) => {
    const resolution = interaction.resolution;
    if (resolution === 'attack_roll') result.attack = true;
    if (resolution === 'save') {
      result.save = String(interaction.ability || '').toUpperCase() || 'СБ';
      // урон/лечение при провале/успехе
      scanPayloads(interaction.on_fail);
      scanPayloads(interaction.on_success);
      const onFail = interaction.on_fail as Record<string, unknown> | undefined;
      const dmg = onFail?.damage as Record<string, unknown> | undefined;
      if (dmg) readDamage(dmg);
    }
    scanPayloads(interaction.on_hit);
    scanPayloads(interaction.on_crit);
    scanPayloads(interaction.on_success);
    scanPayloads(interaction.result);
    if (interaction.kind === 'damage') readDamage(interaction);
    if (interaction.kind === 'healing') readHeal(interaction);
  });
  return result;
}

const ActionPreview = ({ action, className = '', disableHover = false, onClick, resources: providedResources }: ActionPreviewProps) => {
  const loadedResources = useResourceOptions();
  const resources = providedResources || loadedResources;

  const actionTypeLabel = ACTION_TYPE_OPTIONS.find((o) => o.value === action.action_type)?.label || action.action_type || '';
  const rechargeLabel = action.recharge
    ? (ACTION_RECHARGE_OPTIONS.find((o) => o.value === action.recharge)?.label || action.recharge)
    : '';

  const subtype = [actionTypeLabel, action.distance].filter(Boolean).join(' · ');

  const stats = parseMechanics(action.mechanics as Record<string, unknown> | null | undefined);
  const hasStats = stats.attack || stats.save || stats.damage.length > 0 || stats.heal.length > 0;

  // Парадигма №2: описание МЕХАНИКИ из данных (единый describeMechanics), не свободный текст.
  const mechDesc = describeMechanics(action.mechanics as Record<string, unknown> | null | undefined);

  // Ресурсы (несколько): resources[] с фолбэком на устаревший resource
  const resourceIds: string[] = Array.isArray(action.resources) && action.resources.length > 0
    ? action.resources
    : (action.resource ? [String(action.resource)] : []);

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
      <div className="sp-subtype">{subtype || 'Действие'}</div>

      {hasStats && (
        <div className="sp-stats">
          {stats.attack && (
            <div className="sp-srow">
              <span className="sp-lbl">Атака:</span>
              <div className="sp-die">к20</div>
            </div>
          )}
          {stats.save && (
            <div className="sp-srow">
              <span className="sp-lbl">Спасбросок:</span>
              <div className="sp-die sp-save">СБ</div>
              <span className="sp-bonus">{stats.save}</span>
            </div>
          )}
          {stats.damage.length > 0 && (
            <div className="sp-srow">
              <span className="sp-lbl">Урон:</span>
              <span className="sp-dmgval">
                {stats.damage.map((d, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && <span className="sp-dmgsep">+</span>}
                    <span className="sp-dmgitem" style={{ color: getDamageColor(d.type) }}>
                      {diceRu(d.value)}
                      <img className="sp-dmgicon" src={getDamageIconPath(d.type)} alt="" />
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
                <span className="sp-dmgitem" style={{ color: getDamageColor('healing') }}>
                  {diceRu(stats.heal.join(' + '))}
                  <img className="sp-dmgicon" src={getDamageIconPath('healing')} alt="" />
                  лечение
                </span>
              </span>
            </div>
          )}
        </div>
      )}

      {(mechDesc.summary || mechDesc.details.length > 0) && (
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
