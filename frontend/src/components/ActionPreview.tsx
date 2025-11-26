import type { Action } from '../types';
import { ACTION_RESOURCE_OPTIONS, ACTION_RECHARGE_OPTIONS, ACTION_TYPE_OPTIONS } from '../types';

interface ActionPreviewProps {
  action: Action;
  className?: string;
  disableHover?: boolean;
  onClick?: () => void;
}

const ActionPreview = ({ action, className = '', disableHover = false, onClick }: ActionPreviewProps) => {
  const getResourceLabel = (resource: string) => {
    return ACTION_RESOURCE_OPTIONS.find(opt => opt.value === resource)?.label || resource;
  };

  const getRechargeLabel = (recharge?: string | null) => {
    if (!recharge) return '';
    return ACTION_RECHARGE_OPTIONS.find(opt => opt.value === recharge)?.label || recharge;
  };

  const getActionTypeLabel = (actionType: string) => {
    return ACTION_TYPE_OPTIONS.find(opt => opt.value === actionType)?.label || actionType;
  };

  return (
    <div 
      className={`relative bg-amber-900 rounded-lg shadow-md overflow-visible border-black border-2 ${className} transition-all duration-300 ease-out group ${!disableHover ? 'hover:scale-105 hover:-translate-y-2 hover:shadow-2xl' : ''} flex flex-col w-[350px] ${onClick ? 'cursor-pointer' : ''}`}
      onClick={onClick}
    >
      {/* Изображение в правом верхнем углу, вылезает за пределы */}
      {action.image_url && action.image_url.trim() !== '' && (
        <div className="absolute -top-6 -right-6 w-32 h-32 z-10 pointer-events-none">
          <img
            src={action.image_url}
            alt={action.name}
            className="w-full h-full object-contain"
            style={{
              filter: 'drop-shadow(0 0 12px rgba(217, 119, 6, 0.6))',
            }}
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              target.src = '/default_image.png';
            }}
          />
        </div>
      )}

      {/* Контент карточки */}
      <div className="flex flex-col p-5 text-white relative z-0">
        {/* Название */}
        <div className="mb-2">
          <h3 className="text-xl font-bold text-white font-fantasy">
            {action.name || 'Название действия'}
          </h3>
        </div>

        {/* Тип действия и ресурс */}
        <div className="mb-3">
          <span className="text-sm text-amber-200">
            {getActionTypeLabel(action.action_type)}
            {action.resource && ` • ${getResourceLabel(action.resource)}`}
            {action.recharge && ` • ${getRechargeLabel(action.recharge)}${action.recharge === 'custom' && action.recharge_custom ? ` (${action.recharge_custom})` : ''}`}
          </span>
        </div>

        {/* Описание */}
        <div className="mb-4 flex-1">
          <p 
            className="text-white font-fantasy whitespace-pre-wrap leading-relaxed"
            style={{
              fontSize: action.description_font_size ? `${action.description_font_size}px` : '14px',
              textAlign: (action.text_alignment || 'left') as 'left' | 'center' | 'right'
            }}
          >
            {action.description || 'Нет описания'}
          </p>
        </div>

        {/* Дополнительное описание, если включено */}
        {action.show_detailed_description && action.detailed_description && (
          <div className="mb-4">
            <p 
              className="text-white font-fantasy whitespace-pre-wrap leading-relaxed"
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
