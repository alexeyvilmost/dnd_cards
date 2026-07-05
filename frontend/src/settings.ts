/**
 * Общие настройки сайта (localStorage). Страница управления — /settings.
 */
import { useEffect, useState } from 'react';

export interface SiteSettings {
  /** Диалог броска кубов перед действиями (авто или ввод физических кубов). */
  diceDialog: boolean;
}

const KEY = 'site-settings';
const EVENT = 'site-settings-changed';

const DEFAULTS: SiteSettings = {
  diceDialog: true,
};

export function getSettings(): SiteSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<SiteSettings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setSetting<K extends keyof SiteSettings>(key: K, value: SiteSettings[K]): void {
  const next = { ...getSettings(), [key]: value };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(EVENT));
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
