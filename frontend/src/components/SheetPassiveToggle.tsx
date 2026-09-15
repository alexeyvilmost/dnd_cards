import SheetActionLine from './SheetActionLine';
import type {PassiveEffect} from '../types';
import {usePassiveCatalog} from '../character/passiveCatalog';
import './SheetPassiveToggle.css';

export interface PassiveTogglePresentation {
  id: string;
  presentationKey?: string;
  name: string;
  description: string;
  imageUrl?: string;
  sourceName?: string;
  enabledDescription?: string;
  disabledDescription?: string;
}

/** A display skin for a data-owned preference, not an executable action. */
export default function SheetPassiveToggle({toggle, enabled, onChange}: {
  toggle: PassiveTogglePresentation; enabled: boolean; onChange: (id: string, enabled: boolean) => void;
}) {
  const {passives} = usePassiveCatalog();
  const presentation = passives.find(row => row.key === toggle.presentationKey);
  toggle = presentation ? {...toggle,name:presentation.name,description:presentation.description,
    imageUrl:presentation.image_url || toggle.imageUrl, enabledDescription:presentation.enabled_description,
    disabledDescription:presentation.disabled_description} : toggle;
  const effect: PassiveEffect = {
    id: toggle.id, name: toggle.name, description: toggle.description, image_url: toggle.imageUrl,
    rarity: 'common', card_number: '', effect_type: 'passive', created_at: '', updated_at: '',
    type: enabled ? 'Включено' : 'Выключено',
    show_detailed_description: true,
    detailed_description: [toggle.enabledDescription && `Включено: ${toggle.enabledDescription}`,
      toggle.disabledDescription && `Выключено: ${toggle.disabledDescription}`,
      'Нажмите, чтобы переключить. Настройка сохраняется автоматически; само переключение не тратит ресурсы.'].filter(Boolean).join('\n\n'),
  };
  return <SheetActionLine name={toggle.name} imageUrl={toggle.imageUrl} effectRef={effect}
    sourceLabel={toggle.sourceName ? `Пассив · ${toggle.sourceName}` : 'Пассив · Настройка боя'}
    variant="icon" iconShape="round" selected={enabled} onActivate={() => onChange(toggle.id, !enabled)}/>;
}
