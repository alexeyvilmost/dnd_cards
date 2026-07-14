/**
 * Общие настройки сайта (localStorage). Страница управления — /settings.
 */
import { useEffect, useState } from 'react';

/** Режим отображения карточных сущностей: плитка-иконка или строка с мелкой иконкой. */
export type EntityDisplayMode = 'icon' | 'row';

export type EntityDisplayKind = 'spells' | 'actions' | 'effects' | 'items';

export type EntityDisplaySettings = Record<EntityDisplayKind, EntityDisplayMode>;

/** Вид превью предмета при наведении: обычная карточка или «интерфейс» — тёмный стат-блок
 *  в стиле превью заклинания. Отдельная настройка (не путать с раскладкой строка/иконка). */
export type ItemPreviewStyle = 'card' | 'interface';

export interface SiteSettings {
  /** Диалог броска кубов перед действиями (авто или ввод физических кубов). */
  diceDialog: boolean;
  /** Как отображать заклинания/действия/эффекты/предметы в меню и на листе (раскладка). */
  entityDisplay: EntityDisplaySettings;
  /** Вид превью предмета при наведении (инвентарь листа, библиотека): карточка или интерфейс. */
  itemPreview: ItemPreviewStyle;
  /** Режим игрока: превью/лист прячут авто-описание механики и сырые id, оставляя
   *  человеческое описание, чипы стоимости и боевые статы. Мастер выключает — видит всё. */
  playerMode: boolean;
  /** Показывать оригинальное (английское) название под основным — в интерфейсных
   *  отображениях, детальных окнах и превью при наведении. На печатных карточках не показывается. */
  showOriginalNames: boolean;
}

const KEY = 'site-settings';
const EVENT = 'site-settings-changed';

const DEFAULTS: SiteSettings = {
  diceDialog: true,
  entityDisplay: {
    spells: 'icon',
    actions: 'row',
    effects: 'row',
    items: 'row',
  },
  itemPreview: 'card',
  playerMode: false,
  showOriginalNames: false,
};

export function getSettings(): SiteSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS, entityDisplay: { ...DEFAULTS.entityDisplay } };
    const parsed = JSON.parse(raw) as Partial<SiteSettings>;
    // Мердж с дефолтами: вложенный entityDisplay тоже мерджим по ключам,
    // чтобы старый localStorage без новых полей не ломал настройки.
    const merged: SiteSettings = {
      ...DEFAULTS,
      ...parsed,
      entityDisplay: { ...DEFAULTS.entityDisplay, ...(parsed.entityDisplay ?? {}) },
    };
    // Миграция: раньше 'interface' было третьим значением entityDisplay.items (раскладка);
    // теперь это отдельная настройка itemPreview. Переносим старое значение.
    if ((merged.entityDisplay.items as string) === 'interface') {
      merged.entityDisplay = { ...merged.entityDisplay, items: 'row' };
      if (!parsed.itemPreview) merged.itemPreview = 'interface';
    }
    return merged;
  } catch {
    return { ...DEFAULTS, entityDisplay: { ...DEFAULTS.entityDisplay } };
  }
}

export function setSetting<K extends keyof SiteSettings>(key: K, value: SiteSettings[K]): void {
  const next = { ...getSettings(), [key]: value };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** Переключить режим отображения одного типа сущностей. */
export function setEntityDisplay(kind: EntityDisplayKind, mode: EntityDisplayMode): void {
  const cur = getSettings();
  setSetting('entityDisplay', { ...cur.entityDisplay, [kind]: mode });
}

/** Реактивные настройки: обновляются при изменении в этой и других вкладках. */
export function useSiteSettings(): SiteSettings {
  const [settings, setSettings] = useState<SiteSettings>(getSettings);
  useEffect(() => {
    const refresh = () => setSettings(getSettings());
    window.addEventListener(EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);
  return settings;
}
