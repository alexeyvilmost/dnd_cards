import { createContext, useContext } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';

export const WORKSPACE_EXPANDED_KEY = 'bagofholding.workspace.expanded';
export const WorkspaceNavigationContext = createContext<{ expanded: boolean; toggle: () => void } | null>(null);

/** Hides only site navigation; never remounts a character or changes combat state. */
export function WorkspaceExpandButton({ className = 'sheet-header-btn' }: { className?: string }) {
  const navigation = useContext(WorkspaceNavigationContext);
  if (!navigation) return null;
  const { expanded, toggle } = navigation;
  return <button type="button" className={className} onClick={toggle} aria-pressed={expanded}
    aria-controls="site-navigation" aria-label={expanded ? 'Свернуть' : 'Развернуть'}
    aria-description={expanded ? 'Показать верхнюю навигацию сайта' : 'Скрыть верхнюю навигацию сайта'}>
    {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}<span className="sheet-header-btn-label">{expanded ? 'Свернуть' : 'Развернуть'}</span>
  </button>;
}
