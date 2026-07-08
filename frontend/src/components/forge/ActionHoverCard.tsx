import type { Action } from '../../types';
import { ACTION_RECHARGE_OPTIONS } from '../../types';
import type { WeaponAttackPreview } from '../../engine/weapon';
import { getDamageColorOnDark, getDamageLabel, getDamageIconPath } from '../../utils/damageTypes';
import { actionCostResourceIds, resourceCostIcon, resourceLabel, useResourceOptions } from '../../utils/resources';
import { FormattedText } from '../../utils/formattedText';

type ActionHoverCardProps = {
  action: Action;
  sourceLabel?: string;
  /** Числа оружейной атаки (из оружия в руке): «к20 +N» и строки урона. Парадигма №2. */
  weaponAttackPreview?: WeaponAttackPreview;
};

/** Описание, если оно информативно (не пустое и не повторяет имя). */
function usefulText(action: Action): string | null {
  for (const t of [action.description, action.detailed_description]) {
    const s = (t || '').trim();
    if (s && s !== action.name.trim()) return s;
  }
  return null;
}

const fmtBonus = (n: number) => (n >= 0 ? `+${n}` : String(n));
// «1d8» → «1к8» (русский тултип, как в превью заклинаний).
const diceRu = (s: string) => String(s).replace(/(\d)[dд](\d)/gi, '$1к$2');

const ActionHoverCard = ({ action, sourceLabel, weaponAttackPreview }: ActionHoverCardProps) => {
  const desc = usefulText(action);
  const wp = weaponAttackPreview;
  const resources = useResourceOptions();
  // Стоимость из mechanics.activation.cost (единый источник правды) — совпадает с движком.
  const resourceIds: string[] = actionCostResourceIds(action);
  const rechargeLabel = action.recharge
    ? (ACTION_RECHARGE_OPTIONS.find((o) => o.value === action.recharge)?.label || action.recharge)
      + (action.recharge === 'custom' && action.recharge_custom ? ` (${action.recharge_custom})` : '')
    : '';
  return (
    <div className="forge-effect-card">
      {action.image_url?.trim() && (
        <div className="forge-effect-card-art">
          <img src={action.image_url} alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        </div>
      )}
      <div className="forge-effect-card-body">
        <div className="forge-effect-card-title">{action.name}</div>
        <div className="forge-effect-card-type">{sourceLabel || 'Действие персонажа'}</div>

        {wp && (
          <div className="action-atk-stats">
            <div className="action-atk-row">
              <span className="action-atk-lbl">Атака:</span>
              <span className="action-atk-die">к20</span>
              <span className="action-atk-bonus">{fmtBonus(wp.attack)}</span>
            </div>
            {wp.damages.length > 0 && (
              <div className="action-atk-row action-atk-row--dmg">
                <span className="action-atk-lbl">Урон:</span>
                <span className="action-atk-dmg">
                  {wp.damages.map((d, i) => (
                    <span key={i} className="action-atk-dmgline">
                      {i > 0 && <span className="action-atk-sep">+</span>}
                      <span className="action-atk-dmgitem" style={{ color: getDamageColorOnDark(d.type) }}>
                        {diceRu(d.dice)}{d.bonus !== 0 ? ` ${fmtBonus(d.bonus)}` : ''}
                        <img className="action-atk-icon" src={getDamageIconPath(d.type)} alt="" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                        {getDamageLabel(d.type).toLowerCase()}
                      </span>
                    </span>
                  ))}
                </span>
              </div>
            )}
          </div>
        )}

        {desc && <p className="forge-effect-card-desc"><FormattedText text={desc} emptyText="" /></p>}

        {rechargeLabel && (
          <div className="action-hc-recharge"><span className="action-hc-recharge-i">⟳</span>{rechargeLabel}</div>
        )}
        {resourceIds.length > 0 && (
          <div className="action-hc-costbar">
            {resourceIds.map((id, i) => (
              <span className="action-hc-cost" key={i}>
                <img
                  className="action-hc-costicon"
                  src={resourceCostIcon(resources, id)}
                  alt={resourceLabel(resources, id)}
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                />
                {resourceLabel(resources, id)}
              </span>
            ))}
          </div>
        )}
      </div>
      <style>{ACTION_ATK_CSS}</style>
    </div>
  );
};

// Локальные стили статблока атаки (self-contained, чтобы не зависеть от загрузки SpellPreview).
const ACTION_ATK_CSS = `
.action-atk-stats { display: flex; flex-direction: column; gap: 3px; margin: 6px 0; }
.action-atk-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 13px; }
.action-atk-row--dmg { align-items: flex-start; }
.action-atk-lbl { color: #b7a98a; min-width: 48px; }
.action-atk-die { background: rgba(255,255,255,0.08); border-radius: 4px; padding: 0 6px; font-weight: 600; }
.action-atk-bonus { font-weight: 700; color: #e8dcc0; }
.action-atk-dmg { display: flex; flex-direction: column; gap: 2px; }
.action-atk-dmgline { display: inline-flex; align-items: center; }
.action-atk-dmgitem { display: inline-flex; align-items: center; gap: 3px; font-weight: 600; }
.action-atk-sep { color: #b7a98a; margin-right: 4px; }
.action-atk-icon { width: 14px; height: 14px; object-fit: contain; }
.action-hc-recharge { display: flex; align-items: center; gap: 5px; font-size: 12px; color: #b7a98a; margin-top: 6px; }
.action-hc-recharge-i { font-style: normal; opacity: 0.8; }
.action-hc-costbar { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.action-hc-cost { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: #e8dcc0; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 5px; padding: 2px 7px; }
.action-hc-costicon { width: 15px; height: 15px; object-fit: contain; }
`;

export default ActionHoverCard;
