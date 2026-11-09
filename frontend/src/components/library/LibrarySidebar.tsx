import { useEffect, useId, useState } from 'react';
import { ChevronDown, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import NavRail from '../NavRail';
import type { LibraryContentType } from '../../utils/libraryUrlParams';
import { LIBRARY_CATALOG, librarySectionPath, type LibrarySection } from './libraryCatalog';
import './LibraryChrome.css';

export const LIBRARY_SIDEBAR_STORAGE_KEY = 'library.sidebar.collapsed';

function readCollapsed() {
  try { return localStorage.getItem(LIBRARY_SIDEBAR_STORAGE_KEY) === 'true'; }
  catch { return false; }
}

export default function LibrarySidebar({ active, onSelectContent }: {
  active: LibrarySection;
  onSelectContent?: (type: LibraryContentType) => void;
}) {
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const sectionsID = useId();
  useEffect(() => {
    const update = (event: StorageEvent) => {
      if (event.key === LIBRARY_SIDEBAR_STORAGE_KEY || event.key === null) setCollapsed(readCollapsed());
    };
    window.addEventListener('storage', update);
    return () => window.removeEventListener('storage', update);
  }, []);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem(LIBRARY_SIDEBAR_STORAGE_KEY, String(next)); } catch { /* Navigation still works without storage. */ }
  };
  const selectSection = (id: string) => {
    const section = LIBRARY_CATALOG.find(item => item.id === id)?.id;
    if (!section || section === active) return;
    if (section !== 'monsters' && onSelectContent) onSelectContent(section);
    else navigate(librarySectionPath(section));
  };
  return <aside className="library-sidebar" data-collapsed={collapsed}>
    <div className="library-sidebar__mobile-selector">
      <label htmlFor={`${sectionsID}-mobile`}>Раздел библиотеки</label>
      <div className="library-sidebar__select-wrap">
        <select id={`${sectionsID}-mobile`} value={active} onChange={event => selectSection(event.target.value)}>
          {LIBRARY_CATALOG.map(section => <option key={section.id} value={section.id}>{section.label}</option>)}
        </select>
        <ChevronDown size={18} aria-hidden />
      </div>
    </div>
    <button type="button" className="library-sidebar__toggle" onClick={toggle}
      aria-label={collapsed ? 'Развернуть разделы библиотеки' : 'Свернуть разделы библиотеки'}
      aria-expanded={!collapsed} aria-controls={sectionsID}>
      {collapsed ? <PanelLeftOpen size={20} aria-hidden /> : <PanelLeftClose size={20} aria-hidden />}
      <span className="library-sidebar__toggle-label" aria-hidden>Свернуть</span>
    </button>
    <div id={sectionsID} className="library-sidebar__sections">
      <NavRail items={LIBRARY_CATALOG} active={active} layout="wide" variant="dark" mobileDock="top"
        ariaLabel="Тип содержимого" className="library-sidebar__nav"
        onSelect={selectSection} />
    </div>
  </aside>;
}
