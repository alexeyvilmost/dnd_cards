import { Package, Sparkles, Zap, Wand2, Star, ScrollText, Users, Shield, Gem, Variable, Lightbulb } from 'lucide-react';
import type { NavRailItem } from '../NavRail';
import type { LibraryContentType } from '../../utils/libraryUrlParams';

export type LibrarySection = LibraryContentType | 'monsters';

// The existing library NavRail catalog, shared without a parallel monster menu.
export const LIBRARY_CATALOG: (NavRailItem & { id: LibrarySection })[] = [
  { id: 'cards', label: 'Предметы', icon: <Package size={18} /> },
  { id: 'monsters', label: 'Монстры', icon: <Shield size={18} /> },
  { id: 'effects', label: 'Эффекты', icon: <Sparkles size={18} /> },
  { id: 'passives', label: 'Переключаемые пассивы', icon: <Sparkles size={18} /> },
  { id: 'actions', label: 'Действия', icon: <Zap size={18} /> },
  { id: 'spells', label: 'Заклинания', icon: <Wand2 size={18} /> },
  { id: 'feats', label: 'Черты', icon: <Star size={18} /> },
  { id: 'backgrounds', label: 'Предыстории', icon: <ScrollText size={18} /> },
  { id: 'races', label: 'Виды', icon: <Users size={18} /> },
  { id: 'classes', label: 'Классы', icon: <Shield size={18} /> },
  { id: 'resources', label: 'Ресурсы', icon: <Gem size={18} /> },
  { id: 'variables', label: 'Переменные', icon: <Variable size={18} /> },
  { id: 'concepts', label: 'Понятия', icon: <Lightbulb size={18} /> },
];

export function librarySectionPath(section: LibrarySection): string {
  return section === 'monsters' ? '/monsters' : section === 'cards' ? '/library' : `/library?type=${section}`;
}
