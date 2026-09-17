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
export type CombatRollMode = 'standard' | 'fast' | 'skip';

export interface SiteSettings {
  audioEnabled: boolean;
  audioMaster: number;
  audioMusic: number;
  audioEffects: number;
  audioUI: number;
  combatRollMode: CombatRollMode;
  enemyCombatRollMode: CombatRollMode;
  /** Диалог броска кубов перед действиями (авто или ввод физических кубов). */
  diceDialog: boolean;
  /** Физическая 3D-сцена броска. Если выключена, остаётся обычный диалог и ручной ввод. */
  dice3d: boolean;
  /** Автоматически запускать 3D-кубики с небольшой силой после загрузки сцены. */
  dice3dAutoThrow: boolean;
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
  /** Разрешить вручную добавлять предметы, действия, эффекты, заклинания и черты из листа. */
  allowSheetEntityAdditions: boolean;
}

const KEY = 'site-settings';
export function combatRollModeFor(settings: Pick<SiteSettings, 'combatRollMode' | 'enemyCombatRollMode'>, audience?: 'own' | 'enemy'): CombatRollMode {
  return audience === 'enemy' ? settings.enemyCombatRollMode : settings.combatRollMode;
}
const EVENT = 'site-settings-changed';

const DEFAULTS: SiteSettings = {
  audioEnabled: true,
  audioMaster: .65,
  audioMusic: .3,
  audioEffects: .8,
  audioUI: .35,
  combatRollMode: 'standard',
  enemyCombatRollMode: 'standard',
  diceDialog: true,
  dice3d: true,
  dice3dAutoThrow: false,
  entityDisplay: {
    spells: 'icon',
    actions: 'icon',
    effects: 'icon',
    items: 'icon',
  },
  itemPreview: 'interface',
  playerMode: true,
  showOriginalNames: false,
  allowSheetEntityAdditions: true,
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
    if (!['standard', 'fast', 'skip'].includes(merged.combatRollMode)) merged.combatRollMode = 'standard';
    for (const key of ['audioMaster','audioMusic','audioEffects','audioUI'] as const) {
      merged[key] = typeof merged[key] === 'number' && Number.isFinite(merged[key]) ? Math.max(0,Math.min(1,merged[key])) : DEFAULTS[key];
    }
    if (typeof merged.audioEnabled !== 'boolean') merged.audioEnabled = DEFAULTS.audioEnabled;
    // Keep the former global preference for both sides when migrating.
    if (!['standard', 'fast', 'skip'].includes(parsed.enemyCombatRollMode ?? '')) {
      merged.enemyCombatRollMode = merged.combatRollMode;
    }
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
