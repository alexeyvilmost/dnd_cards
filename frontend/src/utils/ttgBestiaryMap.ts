/**
 * Мапа «название монстра → страница new.ttg.club».
 * Данные собраны из официального API бестиария (see ttgBestiaryData.ts, 639 существ).
 * GET https://new.ttg.club/api/v2/bestiary/search?page=N&size=60&source=MM,PHB,...
 */
import { TTG_BESTIARY_DATA } from './ttgBestiaryData';

/** Сырая запись из сгенерированных данных. */
export interface TtgBestiaryRaw {
  name: string;
  eng: string;
  slug: string;
  type: string;
  cr: string;
}

export interface TtgBestiaryEntry {
  /** Отображаемое (русское) имя. */
  name: string;
  /** Slug страницы на new.ttg.club/bestiary/<slug>. */
  slug: string;
  /** Английское имя — для поиска латиницей. */
  alias?: string;
  /** Тип существа (например «Нежить»). */
  type?: string;
  /** Показатель опасности (CR), например «1/4» или «5». */
  cr?: string;
}

export function ttgEntryUrl(entry: TtgBestiaryEntry): string {
  return `https://new.ttg.club/bestiary/${entry.slug}`;
}

export const TTG_BESTIARY: TtgBestiaryEntry[] = TTG_BESTIARY_DATA.map((d) => ({
  name: d.name,
  slug: d.slug,
  alias: d.eng || undefined,
  type: d.type || undefined,
  cr: d.cr || undefined,
})).sort((a, b) => a.name.localeCompare(b.name, 'ru'));

/** Поиск по русскому названию, английскому алиасу или типу (регистронезависимо). */
export function searchTtgBestiary(query: string, limit = 100): TtgBestiaryEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return TTG_BESTIARY.slice(0, limit);
  const scored: { entry: TtgBestiaryEntry; score: number }[] = [];
  for (const entry of TTG_BESTIARY) {
    const name = entry.name.toLowerCase();
    const alias = entry.alias?.toLowerCase() ?? '';
    let score = -1;
    if (name === q || alias === q) score = 0;
    else if (name.startsWith(q) || alias.startsWith(q)) score = 1;
    else if (name.includes(q) || alias.includes(q)) score = 2;
    else if (entry.type?.toLowerCase().includes(q)) score = 3;
    if (score >= 0) scored.push({ entry, score });
  }
  scored.sort((a, b) => a.score - b.score || a.entry.name.localeCompare(b.entry.name, 'ru'));
  return scored.slice(0, limit).map((s) => s.entry);
}
