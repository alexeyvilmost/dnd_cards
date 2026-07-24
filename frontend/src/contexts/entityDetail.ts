import { createContext, useContext } from 'react';
import type { EntityRefType } from '../components/EntityRefRegistry';

// Открытие детального окна сущности по клику на ссылку [[label|type:id]].
// Минимальный файл БЕЗ импорта модалок — чтобы FormattedText мог читать хук без
// вытягивания всех *DetailModal (провайдер живёт отдельно).
export interface EntityDetailApi {
  openEntity: (type: EntityRefType, id: string) => void;
  /** Мобильный интерфейс открывает сущности отдельной страницей и не показывает hover-превью. */
  disableHoverPreviews?: boolean;
}

export const EntityDetailContext = createContext<EntityDetailApi>({ openEntity: () => {} });

export function useEntityDetail(): EntityDetailApi {
  return useContext(EntityDetailContext);
}
