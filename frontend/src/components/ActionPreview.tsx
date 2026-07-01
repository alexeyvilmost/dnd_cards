import type { Action } from '../types';
import { ACTION_RECHARGE_OPTIONS, ACTION_TYPE_OPTIONS } from '../types';
import { resourceIcon, resourceLabel, type ResourceOption, useResourceOptions } from '../utils/resources';

interface ActionPreviewProps {
  action: Action;
  className?: string;
  disableHover?: boolean;
  onClick?: () => void;
  resources?: ResourceOption[];
}

const ActionPreview = ({ action, className = '', disableHover = false, onClick, resources: providedResources }: ActionPreviewProps) => {
  const loadedResources = useResourceOptions();
  const resources = providedResources || loadedResources;
  const getRechargeLabel = (recharge?: string | null) => {
    if (!recharge) return '';
    return ACTION_RECHARGE_OPTIONS.find(opt => opt.value === recharge)?.label || recharge;
  };

  const getActionTypeLabel = (actionType: string) => {
    return ACTION_TYPE_OPTIONS.find(opt => opt.value === actionType)?.label || actionType;
  };

  // Получаем ресурсы для отображения (используем resources если есть, иначе resource)
  const getResourcesToDisplay = (): string[] => {
    if (action.resources && action.resources.length > 0) {
      return action.resources;
    }
    // Для обратной совместимости используем resource
    if (action.resource) {
      return [action.resource];
    }
    return [];
  };

  const getMechanicChips = () => {
    const chips: Array<{ id: string; label: string; icon?: string }> = [];
    const mechanics = action.mechanics as Record<string, unknown> | null | undefined;
    const interactions = Array.isArray(mechanics?.effects) ? mechanics.effects as Record<string, unknown>[] : [];
    interactions.forEach((interaction, index) => {
      const payloads = Array.isArray(interaction.result) ? interaction.result as Record<string, unknown>[] : [interaction];
      if (interaction.resolution === 'save') {
        const onFail = interaction.on_fail as Record<string, unknown> | undefined;
        const damage = onFail?.damage as Record<string, unknown> | undefined;
        if (damage) {
          const type = String(damage.type || 'damage');
          chips.push({ id: `save-damage-${index}`, label: `${damage.dice || ''} ${type}`.trim(), icon: `/icons/damage_types/${type}.png` });
        }
      }
      payloads.forEach((effect, payloadIndex) => {
        if (effect.kind === 'damage') {
          const type = String(effect.damage_type || effect.type || 'damage');
          chips.push({ id: `damage-${index}-${payloadIndex}`, label: `${effect.amount || effect.formula || ''} ${type}`.trim(), icon: `/icons/damage_types/${type}.png` });
        }
        if (effect.kind === 'healing') {
          chips.push({ id: `healing-${index}-${payloadIndex}`, label: `${effect.amount || ''} лечение`.trim(), icon: '/icons/damage_types/healing.png' });
        }
      });
    });
    return chips;
  };

  const mechanicChips = getMechanicChips();

  return (
    <div 
      className={`relative bg-[#2a1710] rounded-2xl shadow-lg overflow-hidden border border-amber-900/70 ${className} transition-all duration-300 ease-out group ${!disableHover ? 'hover:scale-105 hover:-translate-y-2 hover:shadow-2xl' : ''} flex flex-col w-[300px] ${onClick ? 'cursor-pointer' : ''}`}
      onClick={onClick}
    >
      <div className="relative h-36 bg-gradient-to-br from-amber-950 via-stone-900 to-black overflow-hidden">
        {action.image_url && action.image_url.trim() !== '' ? (
          <img
            src={action.image_url}
            alt={action.name}
            className="w-full h-full object-cover opacity-90 group-hover:scale-105 transition-transform duration-300"
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              target.src = '/default_image.png';
            }}
          />
        ) : (
          <div className="h-full flex items-center justify-center text-5xl text-amber-200/60">?</div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#2a1710] via-transparent to-transparent" />
        <div className="absolute top-3 left-3 rounded-full bg-black/55 px-3 py-1 text-xs text-amber-100 border border-amber-300/20">
          {getActionTypeLabel(action.action_type)}
        </div>
      </div>

      <div className="flex flex-col p-4 text-amber-50 relative z-0">
        <div className="mb-2">
          <h3 className="text-xl font-bold text-amber-50 font-fantasy leading-tight">
            {action.name || 'Название действия'}
          </h3>
        </div>

        <div className="flex flex-wrap gap-1.5 mb-3">
          {getResourcesToDisplay().map((resourceId) => (
            <span key={resourceId} className="inline-flex items-center gap-1.5 rounded-full bg-amber-100/10 border border-amber-200/20 px-2 py-1 text-xs text-amber-100">
              <img
                src={resourceIcon(resources, resourceId)}
                alt={resourceLabel(resources, resourceId)}
                className="w-4 h-4 object-contain"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              />
              {resourceLabel(resources, resourceId)}
            </span>
          ))}
          {action.distance && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-100/10 border border-sky-200/20 px-2 py-1 text-xs text-sky-100">
              <img src="/charges/distance.png" alt="" className="w-4 h-4 object-contain" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
              {action.distance}
            </span>
          )}
          {action.recharge && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-purple-100/10 border border-purple-200/20 px-2 py-1 text-xs text-purple-100">
              <img src="/charges/reload.png" alt="" className="w-4 h-4 object-contain" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
              {getRechargeLabel(action.recharge)}
              {action.recharge === 'custom' && action.recharge_custom ? ` (${action.recharge_custom})` : ''}
            </span>
          )}
          {mechanicChips.map((chip) => (
            <span key={chip.id} className="inline-flex items-center gap-1.5 rounded-full bg-red-100/10 border border-red-200/20 px-2 py-1 text-xs text-red-100">
              {chip.icon && <img src={chip.icon} alt="" className="w-4 h-4 object-contain" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />}
              {chip.label}
            </span>
          ))}
        </div>

        <div className="mb-4 flex-1">
          <p 
            className="text-amber-50/90 font-fantasy whitespace-pre-wrap leading-relaxed"
            style={{
              fontSize: action.description_font_size ? `${action.description_font_size}px` : '14px',
              textAlign: (action.text_alignment || 'left') as 'left' | 'center' | 'right'
            }}
          >
            {action.description || 'Нет описания'}
          </p>
        </div>

        {action.show_detailed_description && action.detailed_description && (
          <div className="pt-3 border-t border-amber-100/15">
            <p 
              className="text-amber-100/80 font-fantasy whitespace-pre-wrap leading-relaxed"
              style={{
                fontSize: action.detailed_description_font_size ? `${action.detailed_description_font_size}px` : '12px',
                textAlign: (action.detailed_description_alignment || 'left') as 'left' | 'center' | 'right'
              }}
            >
              {action.detailed_description}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ActionPreview;
