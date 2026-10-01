import React from 'react';
import type { ResourceDefinition } from '../types';
import type { ResourceRestRecovery, ValueBreakdown } from '../mvp/contracts';
import { FormattedText } from '../utils/formattedText';
import Bg3Card from './Bg3Card';
import {FREEUSE_SHOWCASE_KEY, isFreeusePoolKey} from '../engine/freeuse';
import {parseResourceRestRecovery} from '../engine/actionUses';

interface ResourcePreviewProps {
  resource: ResourceDefinition;
  className?: string;
  disableHover?: boolean;
  onClick?: () => void;
  maximum?: ValueBreakdown;
  availability?: {current: number; maximum: number};
  /** The current canonical actor's declared rest policy, when available. */
  recovery?: ResourceRestRecovery | null;
}

export function resourceHasAvailabilityPreview(resource: Pick<ResourceDefinition, 'category' | 'resource_id'>): boolean {
  return resource.category !== 'action_cost' && resource.resource_id !== FREEUSE_SHOWCASE_KEY
    && !isFreeusePoolKey(resource.resource_id);
}

// Ярлыки категорий/восстановления держим здесь, рядом с показом: раньше они жили
// приватными хелперами внутри CardLibrary и переиспользовать их было нельзя.
export const RESOURCE_CATEGORY_LABEL: Record<string, string> = {
  action_cost: 'Стоимость действия',
  class_resource: 'Ресурс класса',
  character_resource: 'Ресурс персонажа',
  item_resource: 'Ресурс предмета',
  species_resource: 'Ресурс вида',
  action_uses: 'Заряды способности',
  ability_resource: 'Заряды способности',
  currency: 'Материальные компоненты',
  spellcasting_resource: 'Заклинательный ресурс',
  hit_dice: 'Кости хитов',
};

export const RESOURCE_RECHARGE_LABEL: Record<string, string> = {
  per_turn: 'Каждый ход',
  per_round: 'Каждый раунд',
  short_rest: 'Короткий отдых',
  long_rest: 'Длинный отдых',
  custom: 'Произвольно',
  turn: 'Каждый ход',
  round: 'Каждый раунд',
  encounter: 'Каждый бой',
  day: 'Каждый день',
  never: 'Не восстанавливается',
};

export const resourceCategoryLabel = (v?: string | null) =>
  (v && RESOURCE_CATEGORY_LABEL[v]) || v || 'Ресурс персонажа';

export const resourceRechargeLabel = (v?: string | null) =>
  (v && RESOURCE_RECHARGE_LABEL[v]) || v || 'Не указано';

export function resourceRecoveryLabel(recovery: ResourceRestRecovery | null): string {
  const parsed = parseResourceRestRecovery(recovery);
  if (!parsed) return 'Восстановление не настроено';
  const short = parsed.short_rest.mode === 'fixed' ? `+${parsed.short_rest.amount}` : 'нет';
  const long = parsed.long_rest.mode === 'full' ? 'все' : `+${parsed.long_rest.dice.replace('d', 'к')}`;
  return `Короткий отдых: ${short}; долгий отдых: ${long}`;
}

const ResourcePreview: React.FC<ResourcePreviewProps> = ({
  resource,
  className = '',
  disableHover = false,
  onClick,
  maximum,
  availability,
  recovery,
}) => {
  const recoveryText = recovery !== undefined ? resourceRecoveryLabel(recovery)
    : resource.recharge ? resourceRechargeLabel(resource.recharge) : null;
  const footer = (
    <>
      <span className="bg3-chip">{resourceCategoryLabel(resource.category)}</span>
      {resource.recharge && recovery === undefined && <span className="bg3-chip">{resourceRechargeLabel(resource.recharge)}</span>}
    </>
  );

  return (
    <Bg3Card
      entityType="resource"
      entity={resource}
      title={resource.name || 'Название ресурса'}
      titleEn={resource.name_en}
      subtype={resourceCategoryLabel(resource.category)}
      imageUrl={resource.image_url}
      disableHover={disableHover}
      onClick={onClick}
      className={className}
      footer={footer}
    >
      <div className="bg3-stats">
        {availability && resourceHasAvailabilityPreview(resource) && (
          <div className="bg3-srow"><span className="bg3-lbl">Осталось:</span>
            <span className="bg3-val" aria-label={`Осталось: ${availability.current} из ${availability.maximum}`}>
              {availability.current} / {availability.maximum}
            </span></div>
        )}
        {maximum && (
          <div className="bg3-srow" style={{ alignItems: 'flex-start' }}>
            <span className="bg3-lbl">Максимум:</span>
            <span className="bg3-val">
              <strong>{maximum.value}</strong>
              {maximum.parts.map((part, index) => (
                <span key={`${part.source}-${index}`} style={{ display: 'block', fontSize: '.78rem', opacity: .78 }}>
                  {part.value >= 0 && index > 0 ? '+' : ''}{part.value} · {part.source}{part.reason ? ` — ${part.reason}` : ''}
                </span>
              ))}
            </span>
          </div>
        )}
        {recoveryText && <div className="bg3-srow">
          <span className="bg3-lbl">Восстановление:</span>
          <span className="bg3-val">{recoveryText}</span>
        </div>}
        {/* Вид потраченного заряда есть в данных, но раньше не показывался нигде. */}
        {resource.image_url_spent && (
          <div className="bg3-srow">
            <span className="bg3-lbl">Заряд:</span>
            <span className="bg3-val" style={{ display: 'inline-flex', gap: '.35rem', alignItems: 'center' }}>
              {resource.image_url && <img src={resource.image_url} alt="" style={{ width: 18, height: 18, objectFit: 'contain' }} />}
              <span style={{ opacity: 0.6 }}>→</span>
              <img src={resource.image_url_spent} alt="" style={{ width: 18, height: 18, objectFit: 'contain', opacity: 0.75 }} />
            </span>
          </div>
        )}
      </div>

      <div className="bg3-desc">
        <FormattedText text={resource.description || ''} emptyText="Описание ресурса" />
      </div>
    </Bg3Card>
  );
};

export default ResourcePreview;
