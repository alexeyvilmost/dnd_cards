import type { ReactNode, CSSProperties, SyntheticEvent } from 'react';
import type { EngineEvent } from '../mvp/contracts';
import { RESOURCE_ICONS, getResourceIconPath } from './damageTypes';
import { findResource, useResourceOptions } from './resources';

// Единое отображение событий ресурсов (журнал И всплывающие подсказки): русское
// название + иконка вместо английского ключа. Чтобы правки не расходились.

type ResourceOptions = ReturnType<typeof useResourceOptions>;

const RES_LABEL: Record<string, string> = Object.fromEntries(RESOURCE_ICONS.map((r) => [r.value, r.label]));

/** Ключ иконки: spell_slot_N → spell_slot, warlock_spell_slot_N → warlock_spell_slot. */
function resourceIconKey(key: string): string {
  if (/^spell_slot_\d+$/.test(key)) return 'spell_slot';
  if (/^warlock_spell_slot/.test(key)) return 'warlock_spell_slot';
  return key;
}

export function resourceView(options: ResourceOptions, key: string): { label: string; icon: string } {
  const def = findResource(options, key);
  const slot = /^spell_slot_(\d+)$/.exec(key);
  const label = def?.label
    || RES_LABEL[key]
    || (slot ? `Ячейка ${slot[1]}-го круга` : /^warlock_spell_slot/.test(key) ? 'Ячейка колдуна' : key);
  const icon = def?.imageUrl && !def.imageUrl.startsWith('/charges/')
    ? def.imageUrl
    : getResourceIconPath(resourceIconKey(key));
  return { label, icon };
}

const hideImg = (e: SyntheticEvent<HTMLImageElement>) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; };
const RES_ICON_STYLE: CSSProperties = { height: '1.05em', verticalAlign: '-2px', margin: '0 3px', objectFit: 'contain', display: 'inline-block' };

/** JSX для события траты/восстановления ресурса (русское имя + иконка), либо null. */
export function resourceEventNode(e: EngineEvent, options: ResourceOptions): ReactNode | null {
  if (e.type === 'resource_spent') {
    const { label, icon } = resourceView(options, e.resource);
    return <>Потрачено {label}<img src={icon} alt="" onError={hideImg} style={RES_ICON_STYLE} /> {e.amount} (осталось {e.remaining})</>;
  }
  if (e.type === 'resource_restored') {
    const { label, icon } = resourceView(options, e.resource);
    return <>Восстановлено {label}<img src={icon} alt="" onError={hideImg} style={RES_ICON_STYLE} /> +{e.amount} (сейчас {e.current})</>;
  }
  return null;
}
